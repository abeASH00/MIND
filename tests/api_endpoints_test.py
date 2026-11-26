#-*- coding: utf-8 -*-

"""
End-to-end tests of the HTTP API (`frontend.api`) through Flask's test
client: authentication, every endpoint, error responses and the admin panel.
"""

import io
import os
import re
import sqlite3
import time
import unittest
from unittest import mock

from _harness import (DEFAULT_URL, OTHER_URL, RECORDER, MindTestCase, future,
                      known_bug, mind_now)

from backend.db import DBConnection
from backend.helpers import RestartVars
from backend.server import SERVER


class Test_ErrorResponses(MindTestCase):
	def test_unknown_api_path_is_json_404(self):
		self.assertEqual(self.api('GET', '/nope'), (404, {'error': 'Not Found', 'result': {}}))

	def test_non_int_id_is_404(self):
		key = self.user_key()
		self.assertEqual(self.api('GET', '/reminders/abc', key)[0], 404)

	def test_unknown_ui_path_is_html(self):
		response = self.client.get('/does/not/exist')
		self.assertIn(b'<!DOCTYPE html>', response.data[:200])

	def test_method_not_allowed(self):
		self.assertEqual(
			self.api('PATCH', '/reminders'),
			(405, {'error': 'Method not allowed', 'result': {}})
		)

	def test_malformed_json(self):
		key = self.user_key()
		response = self.client.post(
			'/api/reminders', query_string={'api_key': key},
			data='{not json', content_type='application/json'
		)
		self.assertEqual(response.status_code, 400)
		self.assertEqual(response.get_json(), {'error': 'Bad request', 'result': {}})

	def test_json_array_body(self):
		key = self.user_key()
		response = self.client.post(
			'/api/reminders', query_string={'api_key': key},
			data='[1, 2]', content_type='application/json'
		)
		self.assertEqual(response.get_json()['error'], 'KeyNotFound')

	def test_error_format(self):
		code, body = self.api('GET', '/reminders')
		self.assertEqual(code, 401)
		self.assertEqual(set(body), {'error', 'result'})


class Test_Auth(MindTestCase):
	def test_login(self):
		self.create_user('alice', 'pw')
		before = time.time()
		code, body = self.api('POST', '/auth/login', json={'username': 'alice', 'password': 'pw'})
		self.assertEqual(code, 201)
		self.assertIsNone(body['error'])
		result = body['result']
		self.assertEqual(set(result), {'api_key', 'expires', 'admin'})
		self.assertRegex(result['api_key'], r'^[0-9a-f]{32}$')
		self.assertFalse(result['admin'])
		self.assertAlmostEqual(result['expires'], before + 3600, delta=5)

	def test_admin_login(self):
		code, body = self.api('POST', '/auth/login', json={'username': 'admin', 'password': 'admin'})
		self.assertEqual(code, 201)
		self.assertTrue(body['result']['admin'])

	def test_each_login_gets_a_new_key(self):
		self.create_user('alice', 'pw')
		self.assertNotEqual(self.login('alice', 'pw'), self.login('alice', 'pw'))

	def test_login_errors(self):
		self.create_user('alice', 'pw')
		self.assertApiError(
			self.api('POST', '/auth/login', json={'username': 'bob', 'password': 'pw'}),
			'UserNotFound', 404
		)
		self.assertApiError(
			self.api('POST', '/auth/login', json={'username': 'alice', 'password': 'wrong'}),
			'AccessUnauthorized', 401
		)
		self.assertApiError(
			self.api('POST', '/auth/login', json={'username': 'alice'}),
			'KeyNotFound', 400
		)
		self.assertApiError(
			self.api('POST', '/auth/login', json={'username': 'alice', 'password': ''}),
			'InvalidKeyValue', 400
		)

	def test_status(self):
		key = self.user_key('alice')
		code, body = self.api('GET', '/auth/status', key)
		self.assertEqual(code, 200)
		self.assertEqual(body['result']['username'], 'alice')
		self.assertFalse(body['result']['admin'])
		self.assertGreater(body['result']['expires'], time.time())

	def test_admin_status(self):
		code, body = self.api('GET', '/auth/status', self.admin_key())
		self.assertEqual(code, 200)
		self.assertTrue(body['result']['admin'])

	def test_logout(self):
		key = self.user_key()
		self.assertEqual(self.api('POST', '/auth/logout', key), (201, {'error': None, 'result': {}}))
		self.assertApiError(self.api('GET', '/auth/status', key), 'APIKeyInvalid', 401)

	def test_logout_only_affects_that_key(self):
		self.create_user('alice', 'pw')
		k1 = self.login('alice', 'pw')
		k2 = self.login('alice', 'pw')
		self.api('POST', '/auth/logout', k1)
		self.assertEqual(self.api('GET', '/auth/status', k2)[0], 200)

	def test_missing_and_invalid_key(self):
		self.assertApiError(self.api('GET', '/reminders'), 'APIKeyInvalid', 401)
		self.assertApiError(self.api('GET', '/reminders', 'f' * 32), 'APIKeyInvalid', 401)
		self.assertApiError(self.api('GET', '/reminders', ''), 'APIKeyInvalid', 401)

	def test_key_in_json_body_is_not_accepted(self):
		key = self.user_key()
		self.assertApiError(
			self.api('POST', '/reminders/test', json={'api_key': key}),
			'APIKeyInvalid', 401
		)

	def test_key_in_form_body_is_accepted(self):
		key = self.user_key()
		response = self.client.post('/api/auth/logout', data={'api_key': key})
		self.assertEqual(response.status_code, 201)

	def test_expired_key(self):
		key = self.user_key()
		entry = next(iter(self.api_key_map.values()))
		entry.exp = time.time() - 1
		self.assertApiError(self.api('GET', '/reminders', key), 'APIKeyExpired', 401)

	def test_login_time_reset_extends_key(self):
		key = self.user_key()
		entry = next(iter(self.api_key_map.values()))
		entry.exp = time.time() + 10
		self.api('GET', '/reminders', key)
		self.assertAlmostEqual(entry.exp, time.time() + 3600, delta=5)

	def test_no_login_time_reset(self):
		admin = self.admin_key()
		self.api('PUT', '/admin/settings', admin, json={'login_time_reset': False})
		key = self.user_key()
		entry = [e for e in self.api_key_map.values() if not e.user_data.admin][0]
		entry.exp = time.time() + 10
		self.api('GET', '/reminders', key)
		self.assertAlmostEqual(entry.exp, time.time() + 10, delta=2)

	def test_login_time_setting(self):
		admin = self.admin_key()
		self.api('PUT', '/admin/settings', admin, json={'login_time': 120})
		self.create_user('alice', 'pw')
		code, body = self.api('POST', '/auth/login', json={'username': 'alice', 'password': 'pw'})
		self.assertAlmostEqual(body['result']['expires'], time.time() + 120, delta=5)

	def test_admin_key_only_works_for_admin_endpoints(self):
		admin = self.admin_key()
		self.assertApiError(self.api('GET', '/reminders', admin), 'APIKeyInvalid', 401)
		self.assertApiError(self.api('GET', '/notificationservices', admin), 'APIKeyInvalid', 401)
		self.assertEqual(self.api('GET', '/admin/users', admin)[0], 200)
		self.assertEqual(self.api('GET', '/auth/status', admin)[0], 200)

	def test_user_key_does_not_work_for_admin_endpoints(self):
		key = self.user_key()
		for method, path in (
			('GET', '/admin/users'), ('GET', '/admin/settings'),
			('POST', '/admin/shutdown'), ('POST', '/admin/restart'),
			('GET', '/admin/database'), ('GET', '/admin/logs'),
		):
			with self.subTest(path=path):
				self.assertApiError(self.api(method, path, key), 'APIKeyInvalid', 401)
		self.shutdown_mock.assert_not_called()
		self.restart_mock.assert_not_called()

	def test_admin_login_defuses_database_import_timer(self):
		with mock.patch.object(SERVER, 'revert_db_timer') as timer, \
		mock.patch('frontend.api.revert_db_import') as revert:
			timer.is_alive.return_value = True
			self.admin_key()
			timer.cancel.assert_called_once()
			revert.assert_called_once_with(swap=False)

	def test_admin_login_defuses_hosting_timer(self):
		with mock.patch.object(SERVER, 'revert_db_timer') as db_timer, \
		mock.patch.object(SERVER, 'revert_hosting_timer') as host_timer:
			db_timer.is_alive.return_value = False
			host_timer.is_alive.return_value = True
			self.admin_key()
			host_timer.cancel.assert_called_once()

	def test_user_login_does_not_defuse_timers(self):
		self.create_user('alice', 'pw')
		with mock.patch.object(SERVER, 'revert_db_timer') as timer:
			timer.is_alive.return_value = True
			self.login('alice', 'pw')
			timer.cancel.assert_not_called()


class Test_UserEndpoints(MindTestCase):
	def test_register(self):
		code, body = self.api('POST', '/user/add', json={'username': 'alice', 'password': 'pw'})
		self.assertEqual((code, body), (201, {'error': None, 'result': {}}))
		self.login('alice', 'pw')

	def test_register_errors(self):
		self.api('POST', '/user/add', json={'username': 'alice', 'password': 'pw'})
		self.assertApiError(
			self.api('POST', '/user/add', json={'username': 'alice', 'password': 'x'}),
			'UsernameTaken', 400
		)
		self.assertApiError(
			self.api('POST', '/user/add', json={'username': 'bad name', 'password': 'x'}),
			'UsernameInvalid', 400
		)
		self.assertApiError(
			self.api('POST', '/user/add', json={'username': '123', 'password': 'x'}),
			'UsernameInvalid', 400
		)
		self.assertApiError(
			self.api('POST', '/user/add', json={'username': 'bob'}),
			'KeyNotFound', 400
		)

	def test_register_disabled(self):
		admin = self.admin_key()
		self.api('PUT', '/admin/settings', admin, json={'allow_new_accounts': False})
		self.assertApiError(
			self.api('POST', '/user/add', json={'username': 'alice', 'password': 'pw'}),
			'NewAccountsNotAllowed', 403
		)
		# The admin can still add users
		self.assertEqual(
			self.api('POST', '/admin/users', admin, json={'username': 'alice', 'password': 'pw'})[0],
			201
		)

	def test_change_password(self):
		key = self.user_key('alice', 'old')
		self.assertEqual(self.api('PUT', '/user', key, json={'new_password': 'new'})[0], 200)
		self.login('alice', 'new')
		self.assertApiError(
			self.api('POST', '/auth/login', json={'username': 'alice', 'password': 'old'}),
			'AccessUnauthorized'
		)

	def test_change_password_requires_value(self):
		key = self.user_key()
		self.assertApiError(self.api('PUT', '/user', key, json={}), 'KeyNotFound', 400)

	def test_delete_account(self):
		key = self.user_key('alice')
		service = self.add_service(key)
		self.add_reminder(key, [service])
		self.assertEqual(self.api('DELETE', '/user', key), (200, {'error': None, 'result': {}}))
		self.assertApiError(self.api('GET', '/auth/status', key), 'APIKeyInvalid')
		self.assertApiError(
			self.api('POST', '/auth/login', json={'username': 'alice', 'password': 'password'}),
			'UserNotFound'
		)
		self.assertEqual(self.sql("SELECT COUNT(*) FROM reminders;"), [(0,)])

	@known_bug('BUG-14')
	def test_delete_account_invalidates_all_sessions(self):
		self.create_user('alice')
		k1 = self.login('alice', 'password')
		k2 = self.login('alice', 'password')
		self.api('DELETE', '/user', k1)
		self.assertApiError(self.api('GET', '/auth/status', k2), 'APIKeyInvalid', 401)

	def test_stale_session_after_account_deletion_crashes(self):
		# Pins the impact of BUG-14: a second session of a deleted account
		# keeps working until it tries to write, which then crashes (500).
		self.create_user('alice')
		k1 = self.login('alice', 'password')
		k2 = self.login('alice', 'password')
		self.api('DELETE', '/user', k1)
		code, body = self.api('POST', '/notificationservices', k2, json={'title': 'x', 'url': DEFAULT_URL})
		if code == 401:
			return # BUG-14 fixed
		self.assertInternalError((code, body))


class Test_NotificationServiceEndpoints(MindTestCase):
	def setUp(self):
		super().setUp()
		self.key = self.user_key('alice')

	def test_crud(self):
		self.assertEqual(self.api('GET', '/notificationservices', self.key), (200, {'error': None, 'result': []}))

		code, body = self.api('POST', '/notificationservices', self.key, json={'title': 'Phone', 'url': DEFAULT_URL})
		self.assertEqual(code, 201)
		service = body['result']
		self.assertEqual(service, {'id': 1, 'title': 'Phone', 'url': DEFAULT_URL})

		self.assertEqual(self.api('GET', '/notificationservices/1', self.key)[1]['result'], service)
		self.assertEqual(self.api('GET', '/notificationservices', self.key)[1]['result'], [service])

		code, body = self.api('PUT', '/notificationservices/1', self.key, json={'title': 'Mobile'})
		self.assertEqual(body['result'], {'id': 1, 'title': 'Mobile', 'url': DEFAULT_URL})
		code, body = self.api('PUT', '/notificationservices/1', self.key, json={'url': OTHER_URL})
		self.assertEqual(body['result'], {'id': 1, 'title': 'Mobile', 'url': OTHER_URL})

		self.assertEqual(self.api('DELETE', '/notificationservices/1', self.key)[0], 200)
		self.assertApiError(self.api('GET', '/notificationservices/1', self.key), 'NotificationServiceNotFound', 404)

	def test_add_validation(self):
		self.assertApiError(
			self.api('POST', '/notificationservices', self.key, json={'title': 'x', 'url': 'nonsense'}),
			'InvalidKeyValue', 400
		)
		self.assertApiError(
			self.api('POST', '/notificationservices', self.key, json={'url': DEFAULT_URL}),
			'KeyNotFound', 400
		)
		self.assertApiError(
			self.api('PUT', '/notificationservices/1', self.key, json={'url': 'nonsense'}),
			'InvalidKeyValue', 400
		)

	def test_other_users_service(self):
		service = self.add_service(self.key)
		other = self.user_key('bob')
		for method in ('GET', 'PUT', 'DELETE'):
			with self.subTest(method=method):
				self.assertApiError(
					self.api(method, f'/notificationservices/{service}', other, json={} if method == 'PUT' else None),
					'NotificationServiceNotFound', 404
				)
		self.assertEqual(self.api('GET', '/notificationservices', other)[1]['result'], [])

	def test_delete_in_use(self):
		service = self.add_service(self.key)
		self.add_reminder(self.key, [service])
		code, body = self.api('DELETE', f'/notificationservices/{service}', self.key)
		self.assertEqual((code, body), (400, {
			'error': 'NotificationServiceInUse', 'result': {'type': 'reminder'}
		}))
		self.assertEqual(
			self.api('DELETE', f'/notificationservices/{service}', self.key,
				query={'delete_reminders_using': 'true'})[0],
			200
		)
		self.assertEqual(self.api('GET', '/reminders', self.key)[1]['result'], [])

	def test_delete_flag_validation(self):
		service = self.add_service(self.key)
		self.assertApiError(
			self.api('DELETE', f'/notificationservices/{service}', self.key,
				query={'delete_reminders_using': 'yes'}),
			'InvalidKeyValue', 400
		)

	def test_available(self):
		# Wiring only; the catalogue itself is tested in
		# notification_services_test.py (see BUG-15 for the real data).
		catalogue = [{'name': 'Custom URL', 'doc_url': 'x', 'details': {'templates': ['{url}'], 'tokens': [], 'args': []}}]
		with mock.patch('frontend.api.get_apprise_services', return_value=catalogue):
			code, body = self.api('GET', '/notificationservices/available', self.key)
		self.assertEqual((code, body['result']), (200, catalogue))

	def test_available_requires_login(self):
		self.assertApiError(self.api('GET', '/notificationservices/available'), 'APIKeyInvalid', 401)

	def test_test_service(self):
		self.assertEqual(
			self.api('POST', '/notificationservices/test', self.key, json={'url': DEFAULT_URL})[0],
			201
		)
		self.assertEqual(RECORDER.sent[0]['urls'], [DEFAULT_URL])
		self.assertApiError(
			self.api('POST', '/notificationservices/test', self.key, json={'url': 'nonsense'}),
			'InvalidKeyValue', 400
		)


class Test_ReminderEndpoints(MindTestCase):
	def setUp(self):
		super().setUp()
		self.key = self.user_key('alice')
		self.service = self.add_service(self.key)

	def post(self, **fields):
		data = {'title': 'T', 'time': future(), 'notification_services': [self.service]}
		data.update(fields)
		return self.api('POST', '/reminders', self.key, json={k: v for k, v in data.items() if v is not ...})

	def test_create_and_read(self):
		t = future()
		code, body = self.post(title='Dentist', time=t, text='Bring card', color='#49191e')
		self.assertEqual(code, 201)
		self.assertEqual(body['result'], {
			'id': 1, 'title': 'Dentist', 'text': 'Bring card', 'time': t,
			'repeat_quantity': None, 'repeat_interval': None, 'weekdays': None,
			'color': '#49191e', 'notification_services': [self.service]
		})
		self.assertEqual(self.api('GET', '/reminders/1', self.key)[1]['result'], body['result'])

	def test_create_validation(self):
		cases = [
			({'title': ...}, 'KeyNotFound', {'key': 'title'}),
			({'time': ...}, 'KeyNotFound', {'key': 'time'}),
			({'notification_services': ...}, 'KeyNotFound', {'key': 'notification_services'}),
			({'title': ''}, 'InvalidKeyValue', None),
			({'time': 'tomorrow'}, 'InvalidKeyValue', None),
			({'notification_services': []}, 'InvalidKeyValue', None),
			({'notification_services': ['1']}, 'InvalidKeyValue', None),
			({'repeat_quantity': 'fortnights', 'repeat_interval': 1}, 'InvalidKeyValue', None),
			({'repeat_quantity': 'days', 'repeat_interval': 0}, 'InvalidKeyValue', None),
			({'repeat_quantity': 'days'}, 'InvalidKeyValue', {'key': 'repeat_interval', 'value': None}),
			({'repeat_interval': 1}, 'InvalidKeyValue', {'key': 'repeat_quantity', 'value': None}),
			({'weekdays': [7]}, 'InvalidKeyValue', None),
			({'weekdays': [1], 'repeat_quantity': 'days', 'repeat_interval': 1}, 'InvalidKeyValue', None),
			({'color': 'red'}, 'InvalidKeyValue', None),
			({'text': 5}, 'InvalidKeyValue', None),
			({'time': mind_now() - 100}, 'InvalidTime', None),
			({'notification_services': [999]}, 'NotificationServiceNotFound', None),
		]
		for fields, error, result in cases:
			with self.subTest(fields=fields):
				code, body = self.post(**fields)
				self.assertEqual(body['error'], error, body)
				self.assertIn(code, (400, 404))
				if result is not None:
					self.assertEqual(body['result'], result)
		self.assertEqual(self.api('GET', '/reminders', self.key)[1]['result'], [])

	def test_repeating_and_weekday_reminders(self):
		code, body = self.post(repeat_quantity='weeks', repeat_interval=2)
		self.assertEqual((body['result']['repeat_quantity'], body['result']['repeat_interval']), ('weeks', 2))
		code, body = self.post(weekdays=[4, 0])
		self.assertEqual(body['result']['weekdays'], [0, 4])

	def test_list_sorting(self):
		base = future()
		self.post(title='b', time=base + 20)
		self.post(title='a', time=base + 30)
		self.post(title='c', time=base + 10)
		def titles(sort_by=None):
			query = {'sort_by': sort_by} if sort_by else None
			return [r['title'] for r in self.api('GET', '/reminders', self.key, query=query)[1]['result']]
		self.assertEqual(titles(), ['c', 'b', 'a'])
		self.assertEqual(titles('time_reversed'), ['a', 'b', 'c'])
		self.assertEqual(titles('title'), ['a', 'b', 'c'])
		self.assertEqual(titles('date_added'), ['b', 'a', 'c'])
		self.assertApiError(self.api('GET', '/reminders', self.key, query={'sort_by': 'nope'}), 'InvalidKeyValue', 400)

	def test_search(self):
		self.post(title='Buy milk')
		self.post(title='Call mom', text='about milk')
		self.post(title='Gym')
		code, body = self.api('GET', '/reminders/search', self.key, query={'query': 'MILK', 'sort_by': 'title'})
		self.assertEqual([r['title'] for r in body['result']], ['Buy milk', 'Call mom'])
		self.assertApiError(self.api('GET', '/reminders/search', self.key), 'KeyNotFound', 400)

	def test_test_reminder(self):
		code, body = self.api('POST', '/reminders/test', self.key, json={
			'title': 'Hi', 'notification_services': [self.service], 'text': 'there'
		})
		self.assertEqual(code, 201)
		self.assertEqual(RECORDER.sent, [{'title': 'Hi', 'body': 'there', 'urls': [DEFAULT_URL]}])
		self.assertApiError(
			self.api('POST', '/reminders/test', self.key, json={'title': 'Hi', 'notification_services': [42]}),
			'NotificationServiceNotFound', 404
		)

	def test_update(self):
		self.post(title='Old', text='old text', color='#49191e')
		t = future(7200)
		code, body = self.api('PUT', '/reminders/1', self.key, json={'time': t, 'text': 'new text'})
		self.assertEqual(code, 200)
		result = body['result']
		self.assertEqual(result['title'], 'Old') # title omitted -> kept
		self.assertEqual(result['text'], 'new text')
		self.assertEqual(result['time'], t)
		self.assertIsNone(result['color']) # color omitted -> cleared

	def test_update_text_omitted_becomes_empty(self):
		# TextVariable defaults to '' instead of None, so omitting it clears it
		self.post(text='keep me?')
		code, body = self.api('PUT', '/reminders/1', self.key, json={'title': 'x'})
		self.assertEqual(body['result']['text'], '')

	def test_update_validation(self):
		self.post()
		self.assertApiError(self.api('PUT', '/reminders/1', self.key, json={'time': mind_now() - 5}), 'InvalidTime', 400)
		self.assertApiError(self.api('PUT', '/reminders/1', self.key, json={'notification_services': []}), 'InvalidKeyValue', 400)
		self.assertApiError(self.api('PUT', '/reminders/1', self.key, json={'title': ''}), 'InvalidKeyValue', 400)
		self.assertApiError(self.api('PUT', '/reminders/2', self.key, json={}), 'ReminderNotFound', 404)

	def test_delete(self):
		self.post()
		self.assertEqual(self.api('DELETE', '/reminders/1', self.key), (200, {'error': None, 'result': {}}))
		self.assertApiError(self.api('GET', '/reminders/1', self.key), 'ReminderNotFound', 404)
		self.assertApiError(self.api('DELETE', '/reminders/1', self.key), 'ReminderNotFound', 404)

	def test_isolation_between_users(self):
		self.post(title='Private')
		other = self.user_key('bob')
		self.assertEqual(self.api('GET', '/reminders', other)[1]['result'], [])
		self.assertEqual(self.api('GET', '/reminders/search', other, query={'query': 'priv'})[1]['result'], [])
		for method in ('GET', 'PUT', 'DELETE'):
			self.assertApiError(
				self.api(method, '/reminders/1', other, json={} if method == 'PUT' else None),
				'ReminderNotFound', 404
			)
		# Bob can't use Alice's service when adding
		other_service = self.add_service(other)
		self.assertApiError(
			self.api('POST', '/reminders', other, json={
				'title': 'x', 'time': future(), 'notification_services': [self.service]
			}),
			'NotificationServiceNotFound', 404
		)
		self.assertApiError(
			self.api('POST', '/reminders/test', other, json={
				'title': 'x', 'notification_services': [self.service]
			}),
			'NotificationServiceNotFound', 404
		)

	@known_bug('BUG-02')
	def test_cannot_attach_other_users_service_on_update(self):
		other = self.user_key('bob')
		other_service = self.add_service(other)
		own = self.api('POST', '/reminders', other, json={
			'title': 'x', 'time': future(), 'notification_services': [other_service]
		})[1]['result']
		self.assertApiError(
			self.api('PUT', f"/reminders/{own['id']}", other, json={
				'notification_services': [self.service]
			}),
			'NotificationServiceNotFound', 404
		)

	@known_bug('BUG-13')
	def test_non_finite_time_is_rejected(self):
		for literal in ('NaN', 'Infinity', '-Infinity'):
			with self.subTest(literal=literal):
				response = self.client.post(
					'/api/reminders', query_string={'api_key': self.key},
					data='{"title": "t", "time": %s, "notification_services": [%d]}' % (literal, self.service),
					content_type='application/json'
				)
				self.assertEqual(response.status_code, 400, response.get_json())


class Test_TemplateAndStaticEndpoints(MindTestCase):
	def setUp(self):
		super().setUp()
		self.key = self.user_key('alice')
		self.service = self.add_service(self.key)

	def crud(self, base):
		code, body = self.api('POST', base, self.key, json={
			'title': 'Entry', 'notification_services': [self.service], 'text': 'x', 'color': '#083b06'
		})
		self.assertEqual(code, 201)
		entry = body['result']
		self.assertEqual(entry, {
			'id': 1, 'title': 'Entry', 'text': 'x', 'color': '#083b06',
			'notification_services': [self.service]
		})
		self.assertEqual(self.api('GET', f'{base}/1', self.key)[1]['result'], entry)
		listed = self.api('GET', base, self.key)[1]['result']
		self.assertEqual(listed, [{k: v for k, v in entry.items() if k != 'notification_services'}])

		self.assertEqual(
			[e['title'] for e in self.api('GET', f'{base}/search', self.key, query={'query': 'ENT'})[1]['result']],
			['Entry']
		)
		self.assertApiError(self.api('GET', base, self.key, query={'sort_by': 'time'}), 'InvalidKeyValue', 400)

		code, body = self.api('PUT', f'{base}/1', self.key, json={'title': 'Renamed'})
		self.assertEqual((body['result']['title'], body['result']['text'], body['result']['color']), ('Renamed', '', None))

		self.assertEqual(self.api('DELETE', f'{base}/1', self.key)[0], 200)
		self.assertEqual(self.api('GET', base, self.key)[1]['result'], [])

	def test_templates(self):
		self.crud('/templates')
		self.assertApiError(self.api('GET', '/templates/1', self.key), 'TemplateNotFound', 404)

	def test_static_reminders(self):
		self.crud('/staticreminders')
		self.assertApiError(self.api('GET', '/staticreminders/1', self.key), 'ReminderNotFound', 404)

	def test_trigger_static_reminder(self):
		self.api('POST', '/staticreminders', self.key, json={
			'title': 'Pill', 'notification_services': [self.service]
		})
		self.assertEqual(self.api('POST', '/staticreminders/1', self.key), (201, {'error': None, 'result': {}}))
		self.assertEqual(RECORDER.titles(), ['Pill'])
		self.assertApiError(self.api('POST', '/staticreminders/2', self.key), 'ReminderNotFound', 404)

	def test_validation(self):
		for base in ('/templates', '/staticreminders'):
			with self.subTest(base=base):
				self.assertApiError(self.api('POST', base, self.key, json={'title': 'x'}), 'KeyNotFound', 400)
				self.assertApiError(
					self.api('POST', base, self.key, json={'title': 'x', 'notification_services': []}),
					'InvalidKeyValue', 400
				)
				self.assertApiError(
					self.api('POST', base, self.key, json={'title': 'x', 'notification_services': [self.service], 'color': '#FFF'}),
					'InvalidKeyValue', 400
				)

	def test_isolation(self):
		for base in ('/templates', '/staticreminders'):
			self.api('POST', base, self.key, json={'title': 'mine', 'notification_services': [self.service]})
		other = self.user_key('bob')
		for base in ('/templates', '/staticreminders'):
			with self.subTest(base=base):
				self.assertEqual(self.api('GET', base, other)[1]['result'], [])
				self.assertEqual(self.api('GET', f'{base}/1', other)[0], 404)
		self.assertEqual(self.api('POST', '/staticreminders/1', other)[0], 404)
		self.assertEqual(RECORDER.sent, [])


class Test_AdminEndpoints(MindTestCase):
	def setUp(self):
		super().setUp()
		self.admin = self.admin_key()

	def test_public_settings(self):
		code, body = self.api('GET', '/settings')
		self.assertEqual(code, 200)
		self.assertEqual(body['result'], {
			'allow_new_accounts': True, 'login_time': 3600,
			'login_time_reset': True, 'host': '0.0.0.0', 'port': 8080,
			'url_prefix': '', 'log_level': 20
		})

	def test_admin_settings_get(self):
		self.assertEqual(
			self.api('GET', '/admin/settings', self.admin)[1]['result'],
			self.api('GET', '/settings')[1]['result']
		)

	def test_put_settings_without_hosting(self):
		code, body = self.api('PUT', '/admin/settings', self.admin, json={
			'allow_new_accounts': False, 'login_time': 600, 'login_time_reset': False
		})
		self.assertEqual(code, 200)
		settings = self.api('GET', '/settings')[1]['result']
		self.assertEqual(
			(settings['allow_new_accounts'], settings['login_time'], settings['login_time_reset']),
			(False, 600, False)
		)
		self.restart_mock.assert_not_called()
		config = dict(self.sql("SELECT key, value FROM config;"))
		self.assertNotIn('host_backup', config)

	def test_put_hosting_settings_restarts_with_backup(self):
		code, body = self.api('PUT', '/admin/settings', self.admin, json={'port': 9090, 'url_prefix': 'mind'})
		self.assertEqual(code, 200)
		self.restart_mock.assert_called_once_with([RestartVars.HOST_CHANGE.value])
		config = dict(self.sql("SELECT key, value FROM config;"))
		self.assertEqual((config['port'], config['url_prefix']), (9090, '/mind'))
		self.assertEqual((config['port_backup'], config['url_prefix_backup'], config['host_backup']), (8080, '', '0.0.0.0'))

	def test_put_invalid_setting_changes_nothing(self):
		self.assertApiError(
			self.api('PUT', '/admin/settings', self.admin, json={'login_time': 600, 'port': 0}),
			'InvalidKeyValue', 400
		)
		self.assertEqual(self.api('GET', '/settings')[1]['result']['login_time'], 3600)
		self.restart_mock.assert_not_called()

	def test_log_level_setting(self):
		with mock.patch('backend.settings.set_log_level') as set_log_level:
			self.api('PUT', '/admin/settings', self.admin, json={'log_level': 10})
		set_log_level.assert_called_once_with(10)

	def test_logs(self):
		log_file = os.path.join(self.tmp_dir, 'MIND_debug.log')
		with mock.patch('frontend.api.get_debug_log_filepath', return_value=log_file):
			self.assertApiError(self.api('GET', '/admin/logs', self.admin), 'LogFileNotFound', 404)
			with open(log_file, 'w') as f:
				f.write('debug line\n')
			code, body = self.api('GET', '/admin/logs', self.admin)
		self.assertEqual(code, 200)
		self.assertEqual(body, b'debug line\n')

	def test_users_management(self):
		self.assertEqual(
			self.api('GET', '/admin/users', self.admin)[1]['result'],
			[{'id': 1, 'username': 'admin', 'admin': 1}]
		)
		self.assertEqual(self.api('POST', '/admin/users', self.admin, json={'username': 'alice', 'password': 'pw'})[0], 201)
		users = self.api('GET', '/admin/users', self.admin)[1]['result']
		alice = [u for u in users if u['username'] == 'alice'][0]

		self.assertEqual(self.api('PUT', f"/admin/users/{alice['id']}", self.admin, json={'new_password': 'new'})[0], 200)
		alice_key = self.login('alice', 'new')

		self.assertEqual(self.api('DELETE', f"/admin/users/{alice['id']}", self.admin)[0], 200)
		self.assertApiError(self.api('GET', '/auth/status', alice_key), 'APIKeyInvalid', 401)
		self.assertEqual(
			[u['username'] for u in self.api('GET', '/admin/users', self.admin)[1]['result']],
			['admin']
		)

	def test_users_management_errors(self):
		self.assertApiError(self.api('DELETE', '/admin/users/1', self.admin), 'UserNotFound', 404)
		self.assertApiError(self.api('DELETE', '/admin/users/99', self.admin), 'UserNotFound', 404)
		self.assertApiError(self.api('PUT', '/admin/users/99', self.admin, json={'new_password': 'x'}), 'UserNotFound', 404)
		self.assertApiError(self.api('POST', '/admin/users', self.admin, json={'username': 'admin', 'password': 'x'}), 'UsernameTaken', 400)

	def test_admin_can_change_own_password(self):
		self.assertEqual(self.api('PUT', '/admin/users/1', self.admin, json={'new_password': 'better'})[0], 200)
		self.login('admin', 'better')

	@known_bug('BUG-14')
	def test_admin_delete_user_invalidates_all_sessions(self):
		self.create_user('alice')
		k1 = self.login('alice', 'password')
		k2 = self.login('alice', 'password')
		user_id = [u['id'] for u in self.api('GET', '/admin/users', self.admin)[1]['result'] if u['username'] == 'alice'][0]
		self.api('DELETE', f'/admin/users/{user_id}', self.admin)
		self.assertApiError(self.api('GET', '/auth/status', k1), 'APIKeyInvalid', 401)
		self.assertApiError(self.api('GET', '/auth/status', k2), 'APIKeyInvalid', 401)

	def test_power(self):
		self.assertEqual(self.api('POST', '/admin/shutdown', self.admin)[0], 200)
		self.shutdown_mock.assert_called_once_with()
		self.assertEqual(self.api('POST', '/admin/restart', self.admin)[0], 200)
		self.restart_mock.assert_called_once_with()

	def test_download_database(self):
		self._patch('frontend.api.folder_path', lambda *p: os.path.join(self.tmp_dir, *p[1:]))
		self.create_user('alice')
		response = self.client.get('/api/admin/database', query_string={'api_key': self.admin})
		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.mimetype, 'application/x-sqlite3')
		self.assertRegex(
			response.headers['Content-Disposition'],
			r'filename=MIND_\d{4}_\d{2}_\d{2}_\d{2}_\d{2}\.db'
		)
		self.assertTrue(response.data.startswith(b'SQLite format 3\x00'))
		downloaded = os.path.join(self.tmp_dir, 'downloaded.db')
		with open(downloaded, 'wb') as f:
			f.write(response.data)
		con = sqlite3.connect(downloaded)
		self.assertEqual(
			sorted(r[0] for r in con.execute("SELECT username FROM users;")),
			['admin', 'alice']
		)
		con.close()
		# The temporary VACUUM INTO file is cleaned up
		self.assertEqual(
			[f for f in os.listdir(self.tmp_dir) if re.match(r'MIND_\d{4}', f)],
			[]
		)

	def test_upload_database_roundtrip(self):
		self._patch('frontend.api.folder_path', lambda *p: os.path.join(self.tmp_dir, *p[1:]))
		self._patch('frontend.input_validation.folder_path', lambda *p: os.path.join(self.tmp_dir, *p[1:]))
		self.create_user('alice')
		backup = self.client.get('/api/admin/database', query_string={'api_key': self.admin}).data
		self.create_user('bob') # Not in the backup

		response = self.client.post(
			'/api/admin/database',
			query_string={'api_key': self.admin, 'copy_hosting_settings': 'true'},
			data={'file': (io.BytesIO(backup), 'backup.db')},
			content_type='multipart/form-data'
		)
		self.assertEqual(response.status_code, 200, response.get_json())
		self.restart_mock.assert_called_once_with([RestartVars.DB_IMPORT.value])
		self.assertTrue(os.path.exists(os.path.join(self.tmp_dir, 'MIND_original.db')))
		usernames = sorted(r[0] for r in self.sql("SELECT username FROM users;"))
		self.assertEqual(usernames, ['admin', 'alice'])

	def test_upload_requires_copy_flag(self):
		self._patch('frontend.input_validation.folder_path', lambda *p: os.path.join(self.tmp_dir, *p[1:]))
		response = self.client.post(
			'/api/admin/database', query_string={'api_key': self.admin},
			data={'file': (io.BytesIO(b'x'), 'backup.db')},
			content_type='multipart/form-data'
		)
		self.assertEqual(response.get_json()['error'], 'KeyNotFound')

	@known_bug('BUG-08')
	def test_upload_garbage_file(self):
		self._patch('frontend.input_validation.folder_path', lambda *p: os.path.join(self.tmp_dir, *p[1:]))
		response = self.client.post(
			'/api/admin/database',
			query_string={'api_key': self.admin, 'copy_hosting_settings': 'false'},
			data={'file': (io.BytesIO(b'garbage' * 500), 'backup.db')},
			content_type='multipart/form-data'
		)
		self.assertEqual(response.status_code, 400)
		self.assertEqual(response.get_json()['error'], 'InvalidDatabaseFile')
		self.assertFalse(os.path.exists(os.path.join(self.tmp_dir, 'MIND_upload.db')))

	@known_bug('BUG-09')
	def test_upload_wrong_extension(self):
		response = self.client.post(
			'/api/admin/database',
			query_string={'api_key': self.admin, 'copy_hosting_settings': 'false'},
			data={'file': (io.BytesIO(b'x'), 'backup.txt')},
			content_type='multipart/form-data'
		)
		self.assertEqual(response.get_json()['error'], 'InvalidDatabaseFile')


class Test_UI(MindTestCase):
	def test_pages(self):
		for path, title in (
			('/', b'Login - MIND'),
			('/reminders', b'Reminders - MIND'),
			('/admin', b'Admin - MIND'),
		):
			with self.subTest(path=path):
				response = self.client.get(path)
				self.assertEqual(response.status_code, 200)
				self.assertIn(title, response.data)
				self.assertIn(b'id="url_prefix" data-value=""', response.data)

	def test_static_files(self):
		for path in ('/static/js/general.js', '/static/css/general.css', '/static/json/pwa_manifest.json', '/static/img/favicon.svg'):
			with self.subTest(path=path):
				response = self.client.get(path)
				self.assertEqual(response.status_code, 200)
				response.close()

	def test_pages_need_no_login(self):
		# Authentication happens in the browser via the API
		self.assertEqual(self.client.get('/admin').status_code, 200)

	def test_url_prefix(self):
		SERVER.set_url_prefix('/mind')
		self.addCleanup(setattr, SERVER, 'url_prefix', '')
		client = self.app.test_client()
		response = client.get('/mind/')
		self.assertEqual(response.status_code, 200)
		self.assertIn(b'data-value="/mind"', response.data)
		self.assertIn(b'/mind/static/css/general.css', response.data)
		code = client.post('/mind/api/auth/login', json={'username': 'admin', 'password': 'admin'}).status_code
		self.assertEqual(code, 201)
		self.assertEqual(client.get('/api/settings').status_code, 404)
		self.assertEqual(client.get('/').status_code, 404)


if __name__ == '__main__':
	unittest.main()
