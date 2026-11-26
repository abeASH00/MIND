#-*- coding: utf-8 -*-

"""
Tests for the template and static reminder libraries
(`backend.templates`, `backend.static_reminders`). Both share the same
shape, so most tests run against both through a common base class.
"""

import unittest

from _harness import DEFAULT_URL, OTHER_URL, RECORDER, MindTestCase

from backend.custom_exceptions import (NotificationServiceNotFound,
                                       ReminderNotFound, TemplateNotFound)
from backend.helpers import TimelessSortingMethod
from backend.static_reminders import StaticReminder, StaticReminders
from backend.templates import Template, Templates
from backend.users import Users


class TimelessLibraryTests:
	"""Mixin: shared tests for Templates and StaticReminders.

	Subclasses set `library_class`, `entry_class`, `not_found` and `table`.
	"""

	library_class = None
	entry_class = None
	not_found = None
	table = ''

	def setUp(self):
		super().setUp()
		self.alice_id = self.create_user('alice')
		self.bob_id = self.create_user('bob')
		with self.ctx():
			alice = Users().get_one(self.alice_id)
			self.s1 = alice.notification_services.add('Phone', DEFAULT_URL).id
			self.s2 = alice.notification_services.add('Mail', OTHER_URL).id
			bob = Users().get_one(self.bob_id)
			self.bob_service = bob.notification_services.add('Bob', 'json://bob.example').id

	def lib(self, user_id=None):
		return self.library_class(user_id or self.alice_id)

	def count(self):
		return self.sql(f"SELECT COUNT(*) FROM {self.table};")[0][0]

	# --- add ---
	def test_add(self):
		with self.ctx():
			entry = self.lib().add('Title', [self.s1], 'Body', '#300e40')
			self.assertIsInstance(entry, self.entry_class)
			result = entry.get()
		self.assertEqual(result, {
			'id': 1,
			'title': 'Title',
			'text': 'Body',
			'color': '#300e40',
			'notification_services': [self.s1],
		})

	def test_add_defaults(self):
		with self.ctx():
			result = self.lib().add('Title', [self.s1]).get()
		self.assertEqual(result['text'], '')
		self.assertIsNone(result['color'])

	def test_add_multiple_services(self):
		with self.ctx():
			result = self.lib().add('Title', [self.s1, self.s2]).get()
		self.assertEqual(sorted(result['notification_services']), [self.s1, self.s2])

	def test_add_unknown_service_raises(self):
		with self.ctx():
			with self.assertRaises(NotificationServiceNotFound):
				self.lib().add('Title', [999])

	def test_add_unknown_service_creates_nothing(self):
		with self.ctx():
			with self.assertRaises(NotificationServiceNotFound):
				self.lib().add('Title', [self.s1, 999])
		self.assertEqual(self.count(), 0)
		self.assertEqual(self.sql("SELECT COUNT(*) FROM reminder_services;"), [(0,)])

	def test_add_with_service_of_other_user(self):
		with self.ctx():
			with self.assertRaises(NotificationServiceNotFound):
				self.lib().add('Title', [self.bob_service])
		self.assertEqual(self.count(), 0)

	# --- read ---
	def test_fetchall_sorting_and_scope(self):
		with self.ctx():
			lib = self.lib()
			lib.add('b', [self.s1], 'z')
			lib.add('a', [self.s1], 'y')
			lib.add('C', [self.s1], 'x')
			self.library_class(self.bob_id).add('bob', [self.bob_service])

			def titles(method):
				return [e['title'] for e in lib.fetchall(method)]

			self.assertEqual(titles(TimelessSortingMethod.TITLE), ['C', 'a', 'b'])
			self.assertEqual(titles(TimelessSortingMethod.TITLE_REVERSED), ['b', 'a', 'C'])
			self.assertEqual(titles(TimelessSortingMethod.DATE_ADDED), ['b', 'a', 'C'])
			self.assertEqual(titles(TimelessSortingMethod.DATE_ADDED_REVERSED), ['C', 'a', 'b'])
			# Default is TITLE
			self.assertEqual([e['title'] for e in lib.fetchall()], ['C', 'a', 'b'])

	def test_fetchall_fields(self):
		with self.ctx():
			self.lib().add('t', [self.s1], 'x', '#083b06')
			rows = self.lib().fetchall()
		# The list view doesn't include the linked services
		self.assertEqual(rows, [{'id': 1, 'title': 't', 'text': 'x', 'color': '#083b06'}])

	def test_search(self):
		with self.ctx():
			lib = self.lib()
			lib.add('Groceries', [self.s1], 'milk and eggs')
			lib.add('Gym', [self.s1], 'leg day')
			self.library_class(self.bob_id).add('Groceries for bob', [self.bob_service])
			self.assertEqual([e['title'] for e in lib.search('gro')], ['Groceries'])
			self.assertEqual([e['title'] for e in lib.search('EGG')], ['Groceries'])
			self.assertEqual(
				[e['title'] for e in lib.search('g', TimelessSortingMethod.TITLE_REVERSED)],
				['Gym', 'Groceries']
			)
			self.assertEqual(lib.search('bob'), [])

	def test_fetchone_not_found(self):
		with self.ctx():
			with self.assertRaises(self.not_found):
				self.lib().fetchone(1)

	def test_fetchone_other_user(self):
		with self.ctx():
			bob_entry = self.library_class(self.bob_id).add('bob', [self.bob_service]).id
			with self.assertRaises(self.not_found):
				self.lib().fetchone(bob_entry)

	# --- update ---
	def make(self):
		with self.ctx():
			return self.lib().add('Original', [self.s1], 'text', '#3b3506').id

	def update(self, entry_id, **kwargs):
		with self.ctx():
			return self.lib().fetchone(entry_id).update(**kwargs)

	def test_update_fields(self):
		entry_id = self.make()
		result = self.update(entry_id, title='New', text='new', color='#171a42')
		self.assertEqual(
			(result['title'], result['text'], result['color']),
			('New', 'new', '#171a42')
		)

	def test_update_none_keeps_title_and_text_but_clears_color(self):
		entry_id = self.make()
		result = self.update(entry_id)
		self.assertEqual((result['title'], result['text']), ('Original', 'text'))
		self.assertIsNone(result['color'])

	def test_update_services(self):
		entry_id = self.make()
		self.assertEqual(
			self.update(entry_id, notification_services=[self.s2])['notification_services'],
			[self.s2]
		)
		self.assertEqual(
			sorted(self.update(entry_id, notification_services=[self.s1, self.s2])['notification_services']),
			[self.s1, self.s2]
		)

	def test_update_services_empty_or_none_keeps_services(self):
		entry_id = self.make()
		self.assertEqual(self.update(entry_id, notification_services=None)['notification_services'], [self.s1])
		self.assertEqual(self.update(entry_id, notification_services=[])['notification_services'], [self.s1])

	def test_update_unknown_service_raises(self):
		entry_id = self.make()
		with self.ctx():
			with self.assertRaises(NotificationServiceNotFound):
				self.lib().fetchone(entry_id).update(notification_services=[999])

	def test_failed_update_changes_nothing(self):
		entry_id = self.make()
		with self.ctx():
			with self.assertRaises(NotificationServiceNotFound):
				self.lib().fetchone(entry_id).update(title='Changed', notification_services=[999])
		with self.ctx():
			result = self.lib().fetchone(entry_id).get()
		self.assertEqual(result['title'], 'Original')
		self.assertEqual(result['notification_services'], [self.s1])

	def test_update_with_service_of_other_user(self):
		entry_id = self.make()
		with self.ctx():
			with self.assertRaises(NotificationServiceNotFound):
				self.lib().fetchone(entry_id).update(notification_services=[self.bob_service])
		with self.ctx():
			self.assertEqual(self.lib().fetchone(entry_id).get()['notification_services'], [self.s1])

	# --- delete ---
	def test_delete(self):
		entry_id = self.make()
		with self.ctx():
			self.lib().fetchone(entry_id).delete()
		with self.ctx():
			with self.assertRaises(self.not_found):
				self.lib().fetchone(entry_id)
		self.assertEqual(self.count(), 0)
		self.assertEqual(self.sql("SELECT COUNT(*) FROM reminder_services;"), [(0,)])

	def test_delete_keeps_other_entries(self):
		keep = self.make()
		drop = self.make()
		with self.ctx():
			self.lib().fetchone(drop).delete()
		with self.ctx():
			self.assertEqual([e['id'] for e in self.lib().fetchall()], [keep])


class Test_Templates(TimelessLibraryTests, MindTestCase):
	library_class = Templates
	entry_class = Template
	not_found = TemplateNotFound
	table = 'templates'

	def test_templates_are_never_sent(self):
		with self.ctx():
			self.lib().add('Template', [self.s1])
		self.assertEqual(RECORDER.sent, [])


class Test_StaticReminders(TimelessLibraryTests, MindTestCase):
	library_class = StaticReminders
	entry_class = StaticReminder
	not_found = ReminderNotFound
	table = 'static_reminders'

	def test_trigger(self):
		with self.ctx():
			entry_id = self.lib().add('Pill', [self.s1, self.s2], 'Take one').id
			self.lib().trigger_reminder(entry_id)
		self.assertEqual(RECORDER.sent, [{
			'title': 'Pill', 'body': 'Take one', 'urls': [DEFAULT_URL, OTHER_URL]
		}])

	def test_trigger_is_repeatable_and_keeps_entry(self):
		with self.ctx():
			entry_id = self.lib().add('Pill', [self.s1]).id
			for _ in range(3):
				self.lib().trigger_reminder(entry_id)
		self.assertEqual(RECORDER.titles(), ['Pill'] * 3)
		self.assertEqual(self.count(), 1)

	def test_trigger_empty_body(self):
		with self.ctx():
			entry_id = self.lib().add('Pill', [self.s1]).id
			self.lib().trigger_reminder(entry_id)
		self.assertEqual(RECORDER.sent[0]['body'], '​')

	def test_trigger_not_found(self):
		with self.ctx():
			with self.assertRaises(ReminderNotFound):
				self.lib().trigger_reminder(42)
		self.assertEqual(RECORDER.sent, [])

	def test_trigger_other_user(self):
		with self.ctx():
			bob_entry = StaticReminders(self.bob_id).add('bob', [self.bob_service]).id
			with self.assertRaises(ReminderNotFound):
				self.lib().trigger_reminder(bob_entry)
		self.assertEqual(RECORDER.sent, [])

	def test_trigger_never_uses_other_users_services(self):
		# Linking a foreign service is rejected (BUG-02), so triggering can
		# never reach another user's notification URL.
		with self.ctx():
			try:
				entry_id = self.lib().add('Sneaky', [self.bob_service]).id
				self.lib().trigger_reminder(entry_id)
			except NotificationServiceNotFound:
				pass
		self.assertFalse(
			any('json://bob.example' in s['urls'] for s in RECORDER.sent),
			RECORDER.sent
		)


if __name__ == '__main__':
	unittest.main()
