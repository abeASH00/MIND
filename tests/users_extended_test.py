#-*- coding: utf-8 -*-

"""
Tests for `backend.users`: registration, login, password changes, deletion
and everything that hangs off a user account.
"""

import unittest

from _harness import DEFAULT_URL, MindTestCase, future

from backend.custom_exceptions import (AccessUnauthorized,
                                       NewAccountsNotAllowed, UsernameInvalid,
                                       UsernameTaken, UserNotFound)
from backend.notification_service import NotificationServices
from backend.reminders import Reminders
from backend.settings import set_setting
from backend.static_reminders import StaticReminders
from backend.templates import Templates
from backend.users import (ONEPASS_INVALID_USERNAMES,
                           ONEPASS_USERNAME_CHARACTERS, User, Users)


class Test_UsernameCheck(unittest.TestCase):
	def setUp(self):
		self.users = Users()

	def test_allowed_characters(self):
		for username in (
			'alice', 'Bob', 'user_1', 'user-1', 'user.name',
			'wow!', 'me@home', 'cash$', 'a', 'A1', '1a', 'x' * 300
		):
			with self.subTest(username=username):
				self.users._check_username(username)

	def test_full_character_set_is_allowed(self):
		self.users._check_username(ONEPASS_USERNAME_CHARACTERS)

	def test_disallowed_characters(self):
		for username in (
			' ', 'two words', 'tab\there', 'new\nline', 'semi;colon',
			'slash/', 'back\\slash', 'quote"', "apos'", 'hash#', 'pct%',
			'amp&', 'star*', 'plus+', 'eq=', 'q?', '<tag>', 'é', 'ü', '日本',
			'emoji🙂', 'comma,'
		):
			with self.subTest(username=username):
				with self.assertRaises(UsernameInvalid) as cm:
					self.users._check_username(username)
				self.assertEqual(cm.exception.username, username)

	def test_reserved_usernames(self):
		self.assertEqual(ONEPASS_INVALID_USERNAMES, ['reminders', 'api'])
		for username in ONEPASS_INVALID_USERNAMES:
			with self.subTest(username=username):
				with self.assertRaises(UsernameInvalid):
					self.users._check_username(username)

	def test_reserved_usernames_are_case_sensitive(self):
		# Only the exact lowercase names are reserved
		for username in ('API', 'Reminders', 'apis'):
			self.users._check_username(username)

	def test_digit_only_usernames(self):
		for username in ('0', '1', '42', '000', '1234567890'):
			with self.subTest(username=username):
				with self.assertRaises(UsernameInvalid):
					self.users._check_username(username)

	def test_empty_username_passes_check(self):
		# The API layer rejects empty strings, but the check itself allows it
		self.users._check_username('')


class Test_Users(MindTestCase):
	def test_admin_exists_after_setup(self):
		with self.ctx():
			users = Users()
			self.assertIn('admin', users)
			all_users = users.get_all()
		self.assertEqual(all_users, [{'id': 1, 'username': 'admin', 'admin': 1}])

	def test_add_returns_incrementing_ids(self):
		first = self.create_user('first')
		second = self.create_user('second')
		self.assertEqual(second, first + 1)

	def test_contains(self):
		self.create_user('alice')
		with self.ctx():
			users = Users()
			self.assertIn('alice', users)
			self.assertNotIn('Alice', users) # Case sensitive
			self.assertNotIn('bob', users)

	def test_username_taken(self):
		self.create_user('alice')
		with self.ctx():
			with self.assertRaises(UsernameTaken):
				Users().add('alice', 'other')

	def test_username_taken_from_admin(self):
		with self.ctx():
			with self.assertRaises(UsernameTaken):
				Users().add('admin', 'other', True)

	def test_invalid_username_rejected_before_db(self):
		with self.ctx():
			with self.assertRaises(UsernameInvalid):
				Users().add('bad name', 'pw')
			self.assertNotIn('bad name', Users())

	def test_new_accounts_not_allowed(self):
		with self.ctx():
			set_setting('allow_new_accounts', False)
			with self.assertRaises(NewAccountsNotAllowed):
				Users().add('alice', 'pw')
			# The admin can always add accounts
			Users().add('alice', 'pw', from_admin=True)
			self.assertIn('alice', Users())

	def test_new_accounts_check_happens_before_username_check(self):
		with self.ctx():
			set_setting('allow_new_accounts', False)
			with self.assertRaises(NewAccountsNotAllowed):
				Users().add('bad name', 'pw')

	def test_passwords_are_not_stored_in_plain_text(self):
		self.create_user('alice', 'hunter2')
		row = self.sql("SELECT salt, hash FROM users WHERE username = 'alice';")[0]
		self.assertNotIn(b'hunter2', bytes(row[0]))
		self.assertNotIn(b'hunter2', bytes(row[1]))

	def test_get_all_sorted_by_username(self):
		for name in ('charlie', 'alice', 'Bob'):
			self.create_user(name)
		with self.ctx():
			names = [u['username'] for u in Users().get_all()]
		# SQLite's default BINARY collation: uppercase sorts first
		self.assertEqual(names, ['Bob', 'admin', 'alice', 'charlie'])

	def test_get_all_admin_flag(self):
		self.create_user('alice')
		with self.ctx():
			flags = {u['username']: u['admin'] for u in Users().get_all()}
		self.assertEqual(flags, {'admin': 1, 'alice': 0})


class Test_Login(MindTestCase):
	def test_login_success(self):
		user_id = self.create_user('alice', 'secret')
		with self.ctx():
			user = Users().login('alice', 'secret')
		self.assertIsInstance(user, User)
		self.assertEqual(user.user_id, user_id)
		self.assertEqual(user.username, 'alice')
		self.assertFalse(user.admin)

	def test_admin_login(self):
		with self.ctx():
			user = Users().login('admin', 'admin')
		self.assertTrue(user.admin)

	def test_unknown_user(self):
		with self.ctx():
			with self.assertRaises(UserNotFound):
				Users().login('ghost', 'pw')

	def test_wrong_password(self):
		self.create_user('alice', 'secret')
		with self.ctx():
			for pw in ('Secret', 'secret ', '', 'secrets'):
				with self.subTest(pw=pw):
					with self.assertRaises(AccessUnauthorized):
						Users().login('alice', pw)

	def test_username_is_case_sensitive(self):
		self.create_user('alice', 'secret')
		with self.ctx():
			with self.assertRaises(UserNotFound):
				Users().login('ALICE', 'secret')

	def test_empty_password_account(self):
		self.create_user('alice', '')
		with self.ctx():
			Users().login('alice', '')
			with self.assertRaises(AccessUnauthorized):
				Users().login('alice', ' ')

	def test_get_one(self):
		user_id = self.create_user('alice')
		with self.ctx():
			self.assertEqual(Users().get_one(user_id).username, 'alice')
			with self.assertRaises(UserNotFound):
				Users().get_one(9999)


class Test_User(MindTestCase):
	def setUp(self):
		super().setUp()
		self.user_id = self.create_user('alice', 'old')

	def test_edit_password(self):
		with self.ctx():
			Users().get_one(self.user_id).edit_password('new')
		with self.ctx():
			Users().login('alice', 'new')
			with self.assertRaises(AccessUnauthorized):
				Users().login('alice', 'old')

	def test_edit_password_keeps_salt(self):
		before = self.sql("SELECT salt FROM users WHERE id = ?;", (self.user_id,))
		with self.ctx():
			Users().get_one(self.user_id).edit_password('new')
		after = self.sql("SELECT salt FROM users WHERE id = ?;", (self.user_id,))
		self.assertEqual(before, after)

	def test_library_properties_are_cached_and_scoped(self):
		with self.ctx():
			user = Users().get_one(self.user_id)
			pairs = (
				(user.reminders, Reminders),
				(user.templates, Templates),
				(user.static_reminders, StaticReminders),
				(user.notification_services, NotificationServices),
			)
			for library, cls in pairs:
				with self.subTest(cls=cls.__name__):
					self.assertIsInstance(library, cls)
					self.assertEqual(library.user_id, self.user_id)
			self.assertIs(user.reminders, user.reminders)
			self.assertIs(user.templates, user.templates)
			self.assertIs(user.static_reminders, user.static_reminders)
			self.assertIs(user.notification_services, user.notification_services)

	def test_admin_cannot_be_deleted(self):
		with self.ctx():
			admin = Users().login('admin', 'admin')
			with self.assertRaises(UserNotFound):
				admin.delete()
			self.assertIn('admin', Users())

	def test_delete_removes_everything(self):
		with self.ctx():
			user = Users().get_one(self.user_id)
			service = user.notification_services.add('svc', DEFAULT_URL)
			user.reminders.add('r', future(), [service.id])
			user.templates.add('t', [service.id])
			user.static_reminders.add('s', [service.id])

		# A second user whose data must survive
		other_id = self.create_user('bob')
		with self.ctx():
			other = Users().get_one(other_id)
			other_service = other.notification_services.add('svc', DEFAULT_URL)
			other.reminders.add('r', future(), [other_service.id])

		with self.ctx():
			Users().get_one(self.user_id).delete()

		with self.ctx():
			self.assertNotIn('alice', Users())
			with self.assertRaises(UserNotFound):
				Users().get_one(self.user_id)

		for table in ('reminders', 'templates', 'static_reminders', 'notification_services'):
			with self.subTest(table=table):
				self.assertEqual(
					self.sql(f"SELECT COUNT(*) FROM {table} WHERE user_id = ?;", (self.user_id,))[0][0],
					0
				)
		# Link rows cascade away; only bob's single link is left
		self.assertEqual(
			self.sql("SELECT reminder_id, notification_service_id FROM reminder_services;"),
			[(2, other_service.id)]
		)

	def test_deleted_username_can_be_reused(self):
		with self.ctx():
			Users().get_one(self.user_id).delete()
		new_id = self.create_user('alice', 'fresh')
		self.assertNotEqual(new_id, None)
		with self.ctx():
			Users().login('alice', 'fresh')


if __name__ == '__main__':
	unittest.main()
