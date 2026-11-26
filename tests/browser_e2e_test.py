#-*- coding: utf-8 -*-

"""
Browser end-to-end tests: MIND's real web server (waitress) runs in a
background thread and the web-UI is driven in a headless Chromium with
Playwright.

These tests are skipped when Playwright (or its Chromium) isn't installed,
which is the case in CI. To run them locally:

	pip install playwright && python3 -m playwright install chromium
	python3 -m unittest discover -s ./tests -p 'browser_e2e_test.py'
"""

import json
import logging
import os
import threading
import unittest
from datetime import datetime, timezone

from _harness import DEFAULT_URL, OTHER_URL, RECORDER, MindTestCase, future

try:
	from playwright.sync_api import sync_playwright
	HAS_PLAYWRIGHT = True
except ImportError:
	HAS_PLAYWRIGHT = False

#: Set MIND_SKIP_BROWSER_TESTS=1 to skip these (slower) tests
SKIP = os.environ.get('MIND_SKIP_BROWSER_TESTS', '') not in ('', '0')

# waitress warns about its task queue when the browser fires parallel requests
logging.getLogger('waitress').addHandler(logging.NullHandler())
logging.getLogger('waitress').propagate = False


def utc_epoch(text: str) -> int:
	"""Epoch of an ISO date-time string interpreted as UTC."""
	return int(datetime.fromisoformat(text).replace(tzinfo=timezone.utc).timestamp())


@unittest.skipUnless(HAS_PLAYWRIGHT, 'Playwright is not installed')
@unittest.skipIf(SKIP, 'MIND_SKIP_BROWSER_TESTS is set')
class BrowserTestCase(MindTestCase):
	#: The browser's timezone. The test process (the "server") runs in UTC.
	TIMEZONE = 'UTC'

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.playwright = sync_playwright().start()
		try:
			cls.browser = cls.playwright.chromium.launch()
		except Exception as e:
			cls.playwright.stop()
			raise unittest.SkipTest(f'Chromium is not available: {e}')

	@classmethod
	def tearDownClass(cls):
		cls.browser.close()
		cls.playwright.stop()
		super().tearDownClass()

	def setUp(self):
		super().setUp()
		from waitress import create_server

		from backend.server import ThreadedTaskDispatcher

		# MIND's own dispatcher: it closes each worker's DB connection
		dispatcher = ThreadedTaskDispatcher()
		dispatcher.set_thread_count(4)
		self.server = create_server(
			self.app, _dispatcher=dispatcher,
			host='127.0.0.1', port=0, threads=4,
			clear_untrusted_proxy_headers=True
		)
		self.base = f'http://127.0.0.1:{self.server.effective_port}'
		self.server_thread = threading.Thread(
			target=self.server.run, name='TestWaitress', daemon=True
		)
		self.server_thread.start()
		self.addCleanup(self._stop_server)

		self.context = self.browser.new_context(
			timezone_id=self.TIMEZONE, locale='en-GB'
		)
		self.addCleanup(self.context.close)
		self.page = self.context.new_page()
		self.page.set_default_timeout(10_000)
		self.page_errors = []
		self.page.on('pageerror', lambda e: self.page_errors.append(str(e)))

	def _stop_server(self):
		from waitress.task import ThreadedTaskDispatcher as WaitressDispatcher
		self.server.close()
		# Skip MIND's shutdown(), which prints and logs "Shutting down MIND"
		WaitressDispatcher.shutdown(self.server.task_dispatcher)
		self.server._map.clear()
		self.server_thread.join(timeout=5)

	#---------------------
	# Helpers
	#---------------------
	def open_as(self, key: str, path: str = '/reminders') -> None:
		"""Open a page as if logged in with `key` (via localStorage)."""
		storage = {'api_key': key, 'locale': 'en-GB', 'default_service': None}
		self.page.goto(self.base + '/static/img/favicon.svg')
		self.page.evaluate(
			'storage => localStorage.setItem("MIND", storage)',
			json.dumps(storage)
		)
		self.page.goto(self.base + path)
		self.page.wait_for_load_state('networkidle')

	def entry_titles(self, tab: str = '#reminder-tab') -> list:
		return self.page.locator(f'{tab} button.entry:not(.add-entry) h2').all_inner_texts()

	def assertNoPageErrors(self):
		self.assertEqual(self.page_errors, [])


class Test_Login(BrowserTestCase):
	def test_register_and_land_on_reminders(self):
		self.page.goto(self.base + '/')
		self.page.click('#login-form .switch-button')
		self.page.fill('#create-form input[type="text"]', 'alice')
		self.page.fill('#create-form input[type="password"]', 'secret')
		self.page.click('#create-form button[type="submit"]')
		self.page.wait_for_url(self.base + '/reminders')
		with self.ctx():
			from backend.users import Users
			Users().login('alice', 'secret')
		self.assertNoPageErrors()

	def test_login_errors_are_shown(self):
		self.create_user('alice', 'secret')
		self.page.goto(self.base + '/')
		self.page.fill('#login-form input[type="text"]', 'nobody')
		self.page.fill('#login-form input[type="password"]', 'x')
		self.page.click('#login-form button[type="submit"]')
		self.page.wait_for_selector('#username-error-container.error-container')

		self.page.fill('#login-form input[type="text"]', 'alice')
		self.page.fill('#login-form input[type="password"]', 'wrong')
		self.page.click('#login-form button[type="submit"]')
		self.page.wait_for_selector('#password-error-container.error-container')
		self.assertEqual(self.page.url, self.base + '/')

	def test_admin_lands_on_admin_panel(self):
		self.page.goto(self.base + '/')
		self.page.fill('#login-form input[type="text"]', 'admin')
		self.page.fill('#login-form input[type="password"]', 'admin')
		self.page.click('#login-form button[type="submit"]')
		self.page.wait_for_url(self.base + '/admin')
		self.page.wait_for_selector('#user-list tr')
		self.assertIn('admin', self.page.inner_text('#user-list'))

	def test_registration_hidden_when_disabled(self):
		self.api('PUT', '/admin/settings', self.admin_key(), json={'allow_new_accounts': False})
		self.page.goto(self.base + '/')
		self.page.wait_for_load_state('networkidle')
		self.assertTrue(self.page.is_hidden('#login-form .switch-button'))

	def test_logout(self):
		key = self.user_key('alice')
		self.open_as(key)
		self.page.click('#logout-button')
		self.page.wait_for_url(self.base + '/')
		self.assertApiError(self.api('GET', '/auth/status', key), 'APIKeyInvalid')


class Test_NotificationServicesUI(BrowserTestCase):
	def setUp(self):
		super().setUp()
		self.key = self.user_key('alice')

	def test_without_services_add_buttons_lead_to_services(self):
		self.open_as(self.key)
		self.page.wait_for_selector('#add-reminder.error')
		self.page.click('#add-reminder')
		self.page.wait_for_selector('.window-container.show-window')

	def open_custom_url_form(self):
		self.open_as(self.key)
		self.page.click('#notification-services-button')
		self.page.click('#add-service-button')
		self.page.click('#service-list button:text-is("Custom URL")')
		self.page.wait_for_selector('#service-title')

	def test_add_custom_url_service(self):
		self.open_custom_url_form()
		self.page.fill('#service-title', 'My phone')
		self.page.fill('#add-service-window input[placeholder="Apprise URL"]', DEFAULT_URL)
		self.page.click('#add-service-window .options button[type="submit"]')
		self.page.wait_for_selector('#services-list tr[data-id="1"]')
		self.assertEqual(
			self.api('GET', '/notificationservices', self.key)[1]['result'],
			[{'id': 1, 'title': 'My phone', 'url': DEFAULT_URL}]
		)
		self.assertNoPageErrors()

	def test_test_button_sends_test_notification(self):
		self.open_custom_url_form()
		self.page.fill('#service-title', 'My phone')
		self.page.fill('#add-service-window input[placeholder="Apprise URL"]', DEFAULT_URL)
		self.page.click('#test-service')
		self.page.wait_for_selector('#test-service.show-sent')
		self.assertEqual(RECORDER.titles(), ['MIND: Test title'])

	def test_service_catalogue_renders_real_services(self):
		# BUG-15: with current Apprise versions the list used to be empty
		self.open_as(self.key)
		self.page.click('#notification-services-button')
		self.page.click('#add-service-button')
		self.page.wait_for_selector('#service-list button:text-is("Telegram")')
		self.assertGreater(self.page.locator('#service-list button').count(), 50)

	def test_edit_and_delete_service(self):
		self.add_service(self.key, 'Old', DEFAULT_URL)
		self.open_as(self.key)
		self.page.click('#notification-services-button')
		row = self.page.locator('#services-list tr[data-id="1"]')
		row.locator('button[data-type="edit"]').click()
		row.locator('.title-column input').fill('New')
		row.locator('button[data-type="save"]').click()
		self.page.wait_for_function(
			'() => document.querySelector(\'#services-list tr[data-id="1"] .title-column input\').hasAttribute("readonly")'
		)
		self.assertEqual(self.api('GET', '/notificationservices/1', self.key)[1]['result']['title'], 'New')

		self.page.locator('#services-list tr[data-id="1"] button[data-type="delete"]').click()
		self.page.wait_for_selector('#services-list tr[data-id="1"]', state='detached')
		self.assertEqual(self.api('GET', '/notificationservices', self.key)[1]['result'], [])

	def test_delete_service_in_use_asks_to_delete_reminders(self):
		service = self.add_service(self.key)
		self.add_reminder(self.key, [service], title='Uses it')
		self.open_as(self.key)
		self.page.click('#notification-services-button')
		dialogs = []
		def accept(dialog):
			dialogs.append(dialog.message)
			dialog.accept()
		self.page.on('dialog', accept)
		self.page.locator(f'#services-list tr[data-id="{service}"] button[data-type="delete"]').click()
		self.page.wait_for_selector(f'#services-list tr[data-id="{service}"]', state='detached')
		self.assertEqual(len(dialogs), 1)
		self.assertIn('in use by a reminder', dialogs[0])
		self.assertEqual(self.api('GET', '/reminders', self.key)[1]['result'], [])

	def test_expired_session_redirects_to_login(self):
		# BUG-11: the error names are now spelled like the API sends them
		service = self.add_service(self.key)
		self.open_as(self.key)
		self.page.click('#notification-services-button')
		self.api('POST', '/auth/logout', self.key)
		self.page.locator(f'#services-list tr[data-id="{service}"] button[data-type="delete"]').click()
		self.page.wait_for_url(self.base + '/')


class Test_RemindersUI(BrowserTestCase):
	def setUp(self):
		super().setUp()
		self.key = self.user_key('alice')
		# The UI preselects the first service by title: 'Phone' < 'Work mail'
		self.service = self.add_service(self.key, 'Phone', DEFAULT_URL)
		self.other_service = self.add_service(self.key, 'Work mail', OTHER_URL)

	def fill_form(self, title, when=None, text=None):
		self.page.fill('#title-input', title)
		if when is not None:
			self.page.fill('#time-input', when)
		if text is not None:
			self.page.fill('#text-input', text)

	def submit_form(self):
		self.page.click('#info-form .options button[type="submit"]')
		self.page.wait_for_selector('.window-container:not(.show-window)')

	def test_add_reminder(self):
		self.open_as(self.key)
		self.page.click('#add-reminder')
		self.fill_form('Dentist', '2030-01-01T09:00', 'Bring card')
		self.submit_form()
		self.page.wait_for_selector('#reminder-tab h2:text-is("Dentist")')

		result = self.api('GET', '/reminders/1', self.key)[1]['result']
		self.assertEqual(result['title'], 'Dentist')
		self.assertEqual(result['text'], 'Bring card')
		# Browser and server both in UTC: the picked time is the real epoch
		self.assertEqual(result['time'], utc_epoch('2030-01-01T09:00'))
		# The first service (the default) is selected
		self.assertEqual(result['notification_services'], [self.service])
		self.assertNoPageErrors()

	def test_add_repeating_reminder(self):
		self.open_as(self.key)
		self.page.click('#add-reminder')
		self.fill_form('Water plants', '2030-01-01T09:00')
		self.page.click('#repeat-button')
		self.page.fill('#repeat-interval', '2')
		self.page.select_option('#repeat-quantity', 'weeks')
		self.submit_form()
		self.page.wait_for_selector('#reminder-tab p:has-text("every 2 weeks")')
		result = self.api('GET', '/reminders/1', self.key)[1]['result']
		self.assertEqual((result['repeat_quantity'], result['repeat_interval']), ('weeks', 2))

	def test_add_weekday_reminder(self):
		self.open_as(self.key)
		self.page.click('#add-reminder')
		self.fill_form('Gym', '2030-01-01T18:00')
		self.page.click('#weekday-button')
		checkboxes = self.page.locator('.weekday-bar > input[type="checkbox"]')
		checkboxes.nth(1).check() # Tuesday
		checkboxes.nth(3).check() # Thursday
		self.submit_form()
		self.page.wait_for_selector('#reminder-tab p:has-text("each Tu, Thu")')
		result = self.api('GET', '/reminders/1', self.key)[1]['result']
		self.assertEqual(result['weekdays'], [1, 3])
		# 2030-01-01 is a Tuesday: the first occurrence is that day (BUG-06)
		self.assertEqual(result['time'], utc_epoch('2030-01-01T18:00'))

	def test_past_time_is_rejected(self):
		self.open_as(self.key)
		self.page.click('#add-reminder')
		self.fill_form('Too late', '2001-01-01T09:00')
		self.page.click('#info-form .options button[type="submit"]')
		self.page.wait_for_selector('#time-input.error-input')
		self.assertEqual(self.api('GET', '/reminders', self.key)[1]['result'], [])

	def test_choose_services(self):
		self.open_as(self.key)
		self.page.click('#add-reminder')
		self.fill_form('Both', '2030-01-01T09:00')
		self.page.click('#notification-service-selection-button')
		self.page.check(f'.notification-service-selection input[data-id="{self.other_service}"]')
		self.submit_form()
		self.page.wait_for_selector('#reminder-tab h2:text-is("Both")')
		self.assertEqual(
			sorted(self.api('GET', '/reminders/1', self.key)[1]['result']['notification_services']),
			[self.service, self.other_service]
		)

	def test_edit_and_delete(self):
		self.add_reminder(self.key, [self.service], title='Original', time=utc_epoch('2030-01-01T09:00'))
		self.open_as(self.key)
		self.page.click('#reminder-tab h2:text-is("Original")')
		self.page.wait_for_function('() => document.querySelector("#title-input").value === "Original"')
		self.assertEqual(self.page.input_value('#time-input'), '2030-01-01T09:00')
		self.fill_form('Renamed')
		self.submit_form()
		self.page.wait_for_selector('#reminder-tab h2:text-is("Renamed")')

		self.page.click('#reminder-tab h2:text-is("Renamed")')
		self.page.wait_for_function('() => document.querySelector("#title-input").value === "Renamed"')
		self.page.click('#delete-info')
		self.page.wait_for_selector('#reminder-tab h2:text-is("Renamed")', state='detached')
		self.assertEqual(self.api('GET', '/reminders', self.key)[1]['result'], [])
		self.assertNoPageErrors()

	def test_test_button_sends_draft(self):
		self.open_as(self.key)
		self.page.click('#add-reminder')
		self.fill_form('Draft', text='Hello')
		self.page.click('#test-reminder')
		self.page.wait_for_selector('#test-reminder.show-sent')
		self.assertEqual(RECORDER.sent, [{'title': 'Draft', 'body': 'Hello', 'urls': [DEFAULT_URL]}])
		self.assertEqual(self.api('GET', '/reminders', self.key)[1]['result'], [])

	def test_search_with_special_characters(self):
		# BUG-12: the query used to be pasted into the URL unencoded
		for title in ('Fish & Chips #1', 'Salad', '100% juice'):
			self.add_reminder(self.key, [self.service], title=title)
		self.open_as(self.key)
		for query, expected in (
			('& Chips #', ['Fish & Chips #1']),
			('100%', ['100% juice']),
			('i', ['100% juice', 'Fish & Chips #1']),
		):
			with self.subTest(query=query):
				self.page.fill('#search-input', query)
				self.page.press('#search-input', 'Enter')
				try:
					self.page.wait_for_function(
						"""expected => JSON.stringify([...document.querySelectorAll(
							'#reminder-tab button.entry:not(.add-entry) h2'
						)].map(e => e.innerText).sort()) === JSON.stringify(expected)""",
						arg=sorted(expected),
						timeout=5000
					)
				except Exception:
					pass # The assertion below shows what was found
				self.assertEqual(sorted(self.entry_titles()), sorted(expected))
		self.page.click('#clear-button')
		self.page.wait_for_function(
			'() => document.querySelectorAll("#reminder-tab button.entry:not(.add-entry)").length === 3'
		)

	def test_sorting_is_remembered(self):
		self.add_reminder(self.key, [self.service], title='b', time=future(100))
		self.add_reminder(self.key, [self.service], title='a', time=future(200))
		self.open_as(self.key)
		self.assertEqual(self.entry_titles(), ['b', 'a'])
		self.page.select_option('#sort-input', 'title')
		self.page.wait_for_function(
			'() => document.querySelector("#reminder-tab button.entry:not(.add-entry) h2").innerText === "a"'
		)
		self.page.reload()
		self.page.wait_for_load_state('networkidle')
		self.assertEqual(self.entry_titles(), ['a', 'b'])

	def test_reminder_is_sent_while_page_is_open(self):
		import time
		from _harness import mind_now
		self.add_reminder(self.key, [self.service], title='Soon', time=int(mind_now()) + 2)
		self.open_as(self.key)
		deadline = time.monotonic() + 6
		while time.monotonic() < deadline and RECORDER.titles() != ['Soon']:
			time.sleep(0.1)
		self.assertEqual(RECORDER.titles(), ['Soon'])


class Test_LibraryTabsUI(BrowserTestCase):
	def setUp(self):
		super().setUp()
		self.key = self.user_key('alice')
		self.service = self.add_service(self.key, 'Phone', DEFAULT_URL)

	def test_static_reminder_add_and_trigger(self):
		self.open_as(self.key)
		self.page.click('label[for="static-tab-selector"]')
		self.page.click('#add-static-reminder')
		self.page.fill('#title-input', 'Take a pill')
		self.page.click('#info-form .options button[type="submit"]')
		self.page.wait_for_selector('#static-reminder-tab h2:text-is("Take a pill")')

		self.page.click('#static-reminder-tab h2:text-is("Take a pill")')
		self.page.wait_for_function('() => document.querySelector("#title-input").value === "Take a pill"')
		self.assertEqual(self.page.inner_text('#test-reminder > div:first-child'), 'Trigger')
		self.page.click('#test-reminder')
		self.page.wait_for_selector('#test-reminder.show-sent')
		self.assertEqual(RECORDER.titles(), ['Take a pill'])
		self.assertNoPageErrors()

	def test_template_fills_the_form(self):
		self.api('POST', '/templates', self.key, json={
			'title': 'Weekly report', 'notification_services': [self.service],
			'text': 'Send it to the team', 'color': '#083b06'
		})
		self.open_as(self.key)
		self.page.click('#add-reminder')
		self.page.select_option('#template-selection', label='Weekly report')
		self.page.wait_for_function('() => document.querySelector("#title-input").value === "Weekly report"')
		self.assertEqual(self.page.input_value('#text-input'), 'Send it to the team')
		self.assertTrue(self.page.is_checked('.color-list input[value="#083b06"]'))

	def test_add_template(self):
		self.open_as(self.key)
		self.page.click('label[for="template-tab-selector"]')
		self.page.click('#add-template')
		self.page.fill('#title-input', 'Standup')
		self.page.click('#info-form .options button[type="submit"]')
		self.page.wait_for_selector('#template-tab h2:text-is("Standup")')
		# The new template is offered in the add-reminder form right away
		self.page.wait_for_selector('#template-selection option:text-is("Standup")', state='attached')


class Test_SettingsUI(BrowserTestCase):
	def test_change_password(self):
		key = self.user_key('alice', 'old')
		self.open_as(key)
		self.page.click('#settings-button')
		self.page.fill('#password-input', 'new')
		with self.page.expect_navigation():
			self.page.press('#password-input', 'Enter')
		self.login('alice', 'new')

	def test_delete_account(self):
		key = self.user_key('alice')
		self.open_as(key)
		self.page.click('#settings-button')
		self.page.click('#delete-account-button')
		self.page.wait_for_url(self.base + '/')
		self.assertApiError(
			self.api('POST', '/auth/login', json={'username': 'alice', 'password': 'password'}),
			'UserNotFound'
		)


class Test_AdminUI(BrowserTestCase):
	def setUp(self):
		super().setUp()
		self.key = self.admin_key()

	def test_add_and_delete_user(self):
		self.open_as(self.key, '/admin')
		self.page.click('#add-user-button')
		self.page.fill('#new-username-input', 'bob')
		self.page.fill('#new-password-input', 'pw')
		self.page.press('#new-password-input', 'Enter')
		self.page.wait_for_selector('#user-list td:text-is("bob")')
		self.login('bob', 'pw')

		user_id = [u['id'] for u in self.api('GET', '/admin/users', self.key)[1]['result'] if u['username'] == 'bob'][0]
		self.page.locator(f'#user-list tr[data-id="{user_id}"] button').last.click()
		self.page.wait_for_selector('#user-list td:text-is("bob")', state='detached')
		self.page.wait_for_function('() => true')
		import time
		for _ in range(50):
			if 'bob' not in [u['username'] for u in self.api('GET', '/admin/users', self.key)[1]['result']]:
				break
			time.sleep(0.05)
		self.assertNotIn('bob', [u['username'] for u in self.api('GET', '/admin/users', self.key)[1]['result']])

	def test_admin_cannot_be_deleted_in_ui(self):
		self.open_as(self.key, '/admin')
		self.page.wait_for_selector('#user-list tr[data-id="1"]')
		self.assertEqual(self.page.locator('#user-list tr[data-id="1"] button').count(), 1)

	def test_save_settings(self):
		self.open_as(self.key, '/admin')
		self.page.wait_for_function('() => document.querySelector("#login-time-input").value === "60"')
		self.page.uncheck('#allow-new-accounts-input')
		self.page.fill('#login-time-input', '30')
		with self.page.expect_response(lambda r: '/api/admin/settings' in r.url and r.request.method == 'PUT'):
			self.page.click('#save-button')
		settings = self.api('GET', '/settings')[1]['result']
		self.assertIs(settings['allow_new_accounts'], False)
		self.assertEqual(settings['login_time'], 1800)
		self.restart_mock.assert_not_called()

	def test_download_logs_without_debug(self):
		self.open_as(self.key, '/admin')
		messages = []
		def accept(dialog):
			messages.append(dialog.message)
			dialog.accept()
		self.page.on('dialog', accept)
		self.page.click('#download-logs-button')
		self.page.wait_for_function('() => true')
		import time
		for _ in range(50):
			if messages:
				break
			time.sleep(0.05)
		self.assertEqual(len(messages), 1)
		self.assertIn('No debug log file', messages[0])


class Test_TimeModel(BrowserTestCase):
	"""The time model in the codebase atlas, section 7, in a real browser:
	times only line up when the browser's timezone matches the server's."""

	TIMEZONE = 'Asia/Tokyo' # UTC+9; the test server runs in UTC

	def test_browser_ahead_of_server(self):
		key = self.user_key('alice')
		self.add_service(key)
		self.open_as(key)
		self.page.click('#add-reminder')
		self.page.fill('#title-input', 'Breakfast')
		self.page.fill('#time-input', '2030-01-01T09:00')
		self.page.click('#info-form .options button[type="submit"]')
		self.page.wait_for_selector('#reminder-tab h2:text-is("Breakfast")')

		stored = self.api('GET', '/reminders/1', key)[1]['result']['time']
		# 09:00 in Tokyo is 00:00 UTC. The browser subtracts its own offset
		# once more, so the server (in UTC) fires 9 hours early.
		self.assertEqual(stored, utc_epoch('2029-12-31T15:00'))
		# The list looks right, because the browser adds its offset again
		self.assertIn('01/01/2030, 09:00:00', self.page.inner_text('#reminder-tab'))


if __name__ == '__main__':
	unittest.main()
