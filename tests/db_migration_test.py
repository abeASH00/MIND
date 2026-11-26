#-*- coding: utf-8 -*-

"""
Tests for `backend.db`: connections, the schema, migrations from every older
released database version, and importing/reverting database files.
"""

import os
import shutil
import sqlite3
import threading
import time
import unittest
from datetime import datetime
from typing import Dict, Set
from unittest import mock

from _harness import (DEFAULT_URL, WAL_SURVIVES_CLOSE, MindTestCase,
                      close_thread_connection, future, known_bug)
from _legacy_schemas import LEGACY_SCHEMAS, SINGLE_SERVICE_TABLES

from backend.custom_exceptions import InvalidDatabaseFile
from backend.db import (__DATABASE_VERSION__, __DATEBASE_NAME_ORIGINAL__,
                        DB_Singleton, DBConnection, close_db, get_db,
                        import_db, revert_db_import, setup_db)
from backend.helpers import RestartVars
from backend.security import generate_salt_hash
from backend.settings import default_settings, get_setting, set_setting
from backend.users import Users

#: The columns every table must have after setup or migration.
CURRENT_SCHEMA: Dict[str, Set[str]] = {
	'users': {'id', 'username', 'salt', 'hash', 'admin'},
	'notification_services': {'id', 'user_id', 'title', 'url'},
	'reminders': {
		'id', 'user_id', 'title', 'text', 'time',
		'repeat_quantity', 'repeat_interval', 'original_time',
		'weekdays', 'color'
	},
	'templates': {'id', 'user_id', 'title', 'text', 'color'},
	'static_reminders': {'id', 'user_id', 'title', 'text', 'color'},
	'reminder_services': {
		'reminder_id', 'static_reminder_id', 'template_id',
		'notification_service_id'
	},
	'config': {'key', 'value'},
}


def table_columns(cursor) -> Dict[str, Set[str]]:
	tables = [
		r[0] for r in cursor.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';"
		)
	]
	return {
		t: {c[1] for c in cursor.execute(f"PRAGMA table_info({t});")}
		for t in tables
	}


class Test_Connection(MindTestCase):
	def test_foreign_keys_enabled(self):
		with self.ctx():
			self.assertEqual(get_db().execute("PRAGMA foreign_keys;").fetchone()[0], 1)

	def test_wal_journal_mode(self):
		with self.ctx():
			self.assertEqual(get_db().execute("PRAGMA journal_mode;").fetchone()[0], 'wal')

	def test_one_connection_per_thread(self):
		a = DBConnection(timeout=20.0)
		b = DBConnection(timeout=20.0)
		self.assertIs(a, b)

		other = {}
		def worker():
			other['conn'] = DBConnection(timeout=20.0)
			other['conn'].close()
		t = threading.Thread(target=worker)
		t.start(); t.join()
		self.assertIsNot(other['conn'], a)

	def test_closed_connection_is_replaced(self):
		a = DBConnection(timeout=20.0)
		a.close()
		self.assertTrue(a.closed)
		b = DBConnection(timeout=20.0)
		self.assertIsNot(a, b)
		self.assertFalse(b.closed)

	def test_repr(self):
		conn = DBConnection(timeout=20.0)
		self.assertIn('DBConnection', repr(conn))
		self.assertIn('MainThread', repr(conn))

	def test_get_db_reuses_cursor_within_context(self):
		with self.ctx():
			self.assertIs(get_db(), get_db(dict))

	def test_get_db_row_factory(self):
		with self.ctx():
			row = get_db(dict).execute("SELECT 1 AS one;").fetchone()
			self.assertEqual(row['one'], 1)
			row = get_db().execute("SELECT 1 AS one;").fetchone()
			self.assertEqual(row, (1,))

	def test_get_db_row_factory_is_shared_state(self):
		# The cursor is shared within a context, so asking for a tuple cursor
		# changes the row type of a dict cursor obtained earlier. Code that
		# keeps iterating an older cursor after calling get_db() again gets
		# tuples. This is the root cause of BUG-04.
		with self.ctx():
			dict_cursor = get_db(dict)
			get_db()
			row = dict_cursor.execute("SELECT 1 AS one;").fetchone()
			self.assertIsInstance(row, tuple)

	def test_close_db_commits(self):
		with self.ctx():
			get_db().execute("UPDATE config SET value = 1234 WHERE key = 'port';")
		with self.ctx():
			self.assertEqual(get_setting('port'), 1234)

	def test_uncommitted_changes_without_teardown_are_invisible_to_others(self):
		with self.ctx():
			get_db().execute("UPDATE config SET value = 4321 WHERE key = 'port';")
			# A separate connection can't see the pending write yet
			other = sqlite3.connect(DBConnection.file)
			value = other.execute("SELECT value FROM config WHERE key = 'port';").fetchone()[0]
			other.close()
			self.assertEqual(value, 8080)

	def test_close_db_without_cursor_is_safe(self):
		with self.ctx():
			close_db()
			close_db()


class Test_SetupDB(MindTestCase):
	def test_schema(self):
		with self.ctx():
			self.assertEqual(table_columns(get_db()), CURRENT_SCHEMA)

	def test_default_config(self):
		config = dict(self.sql("SELECT key, value FROM config;"))
		self.assertEqual(set(config), set(default_settings))
		self.assertEqual(config['database_version'], __DATABASE_VERSION__)

	def test_admin_user(self):
		self.assertEqual(
			self.sql("SELECT id, username, admin FROM users;"),
			[(1, 'admin', 1)]
		)
		with self.ctx():
			self.assertTrue(Users().login('admin', 'admin').admin)

	def test_idempotent(self):
		with self.ctx():
			set_setting('port', 9999)
		for _ in range(3):
			with self.ctx():
				setup_db()
		self.assertEqual(self.sql("SELECT COUNT(*) FROM users;"), [(1,)])
		with self.ctx():
			# Existing settings are not reset to the defaults
			self.assertEqual(get_setting('port'), 9999)
			self.assertEqual(get_setting('database_version'), __DATABASE_VERSION__)

	def test_admin_recreated_if_missing(self):
		self.sql("DELETE FROM users WHERE username = 'admin';")
		with self.ctx():
			setup_db()
		self.assertEqual(self.sql("SELECT username, admin FROM users;"), [('admin', 1)])

	def test_updates_manifest(self):
		self.manifest_mock.reset_mock()
		with self.ctx():
			setup_db()
		self.manifest_mock.assert_called_once_with('')

	def test_reminder_services_cascade(self):
		key = self.user_key('alice')
		service = self.add_service(key)
		reminder = self.add_reminder(key, [service])
		self.assertEqual(len(self.sql("SELECT * FROM reminder_services;")), 1)
		self.sql("DELETE FROM reminders WHERE id = ?;", (reminder['id'],))
		self.assertEqual(self.sql("SELECT * FROM reminder_services;"), [])

	def test_service_in_use_cannot_be_removed_at_db_level(self):
		key = self.user_key('alice')
		service = self.add_service(key)
		self.add_reminder(key, [service])
		with self.assertRaises(sqlite3.IntegrityError):
			self.sql("DELETE FROM notification_services WHERE id = ?;", (service,))


class LegacyDatabaseMixin:
	"""Builds databases the way older MIND releases left them on disk."""

	T1 = 1893456000 # 2030-01-01T00:00:00Z
	T2 = 1893542400 # 2030-01-02T00:00:00Z

	def build_legacy_db(self, version: int, path: str) -> None:
		single = SINGLE_SERVICE_TABLES[version]
		con = sqlite3.connect(path)
		con.executescript(LEGACY_SCHEMAS[version])
		con.execute(
			"INSERT INTO config(key, value) VALUES ('database_version', ?);",
			(version,)
		)

		def add_user(name, password):
			salt, hashed = generate_salt_hash(password)
			return con.execute(
				"INSERT INTO users(username, salt, hash) VALUES (?, ?, ?);",
				(name, salt, hashed)
			).lastrowid

		alice = add_user('alice', 'alice-pw')
		# Before V8 'admin' was an ordinary username
		add_user('admin', 'old-admin-pw')
		user1 = add_user('User1', 'Password1') if version <= 5 else None

		def add_service(user_id, title):
			return con.execute(
				"INSERT INTO notification_services(user_id, title, url) VALUES (?, ?, ?);",
				(user_id, title, DEFAULT_URL)
			).lastrowid

		phone = add_service(alice, 'Phone')

		has_color = version >= 3
		quantity = 'day' if version <= 3 else 'days'

		def add_reminder(user_id, title, t, service, repeat=False):
			columns = ['user_id', 'title', 'text', 'time']
			values = [user_id, title, f'{title} text', t]
			if repeat:
				columns += ['repeat_quantity', 'repeat_interval', 'original_time']
				values += [quantity, 2, t]
			if has_color:
				columns.append('color')
				values.append('#49191e')
			if 'reminders' in single:
				columns.append('notification_service')
				values.append(service)
			rid = con.execute(
				f"INSERT INTO reminders({', '.join(columns)}) VALUES ({', '.join('?' * len(values))});",
				values
			).lastrowid
			if not single:
				con.execute(
					"INSERT INTO reminder_services(reminder_id, notification_service_id) VALUES (?, ?);",
					(rid, service)
				)
			return rid

		add_reminder(alice, 'Dentist', self.T1, phone)
		add_reminder(alice, 'Water plants', self.T2, phone, repeat=True)

		columns = ['user_id', 'title', 'text']
		values = [alice, 'Template', 'Template text']
		if has_color:
			columns.append('color')
			values.append('#171a42')
		if 'templates' in single:
			columns.append('notification_service')
			values.append(phone)
		tid = con.execute(
			f"INSERT INTO templates({', '.join(columns)}) VALUES ({', '.join('?' * len(values))});",
			values
		).lastrowid
		if not single:
			con.execute(
				"INSERT INTO reminder_services(template_id, notification_service_id) VALUES (?, ?);",
				(tid, phone)
			)

		if version >= 5:
			sid = con.execute(
				"INSERT INTO static_reminders(user_id, title, text, color) VALUES (?, ?, ?, ?);",
				(alice, 'Static', 'Static text', None)
			).lastrowid
			con.execute(
				"INSERT INTO reminder_services(static_reminder_id, notification_service_id) VALUES (?, ?);",
				(sid, phone)
			)

		if user1 is not None:
			# The default test account of early versions, with some data
			svc = add_service(user1, 'User1 service')
			add_reminder(user1, 'User1 reminder', self.T1, svc)

		con.commit()
		con.close()


class Test_Migration(LegacyDatabaseMixin, MindTestCase):
	SETUP_DB = False

	def migrate_from(self, version: int) -> None:
		self.build_legacy_db(version, DBConnection.file)
		with self.ctx():
			setup_db()

	def check_migrated(self, version: int) -> None:
		with self.ctx():
			cursor = get_db()

			# Schema is identical to a fresh install
			self.assertEqual(table_columns(cursor), CURRENT_SCHEMA)

			# Config was rebuilt with all settings, at the newest version
			self.assertEqual(get_setting('database_version'), __DATABASE_VERSION__)
			for key in default_settings:
				get_setting(key)
			self.assertEqual(get_setting('host'), '0.0.0.0')
			self.assertEqual(get_setting('port'), 8080)
			self.assertEqual(get_setting('url_prefix'), '')

			# Users: old 'admin' renamed, new admin created, User1 removed
			users = {
				u['username']: u['admin'] for u in Users().get_all()
			}
			self.assertEqual(users, {'admin': 1, 'admin_old': 0, 'alice': 0})
			Users().login('alice', 'alice-pw')
			Users().login('admin_old', 'old-admin-pw')
			self.assertTrue(Users().login('admin', 'admin').admin)

			alice = Users().login('alice', 'alice-pw')

			# Reminders kept, linked to their service, quantity plural
			reminders = {r['title']: r for r in alice.reminders.fetchall()}
			self.assertEqual(set(reminders), {'Dentist', 'Water plants'})
			dentist = alice.reminders.fetchone(reminders['Dentist']['id']).get()
			self.assertEqual(dentist['time'], self.T1)
			self.assertEqual(dentist['text'], 'Dentist text')
			self.assertEqual(dentist['notification_services'], [1])
			self.assertIsNone(dentist['weekdays'])
			self.assertEqual(dentist['color'], '#49191e' if version >= 3 else None)

			water = reminders['Water plants']
			self.assertEqual(water['repeat_quantity'], 'days')
			self.assertEqual(water['repeat_interval'], 2)

			templates = alice.templates.fetchall()
			self.assertEqual([t['title'] for t in templates], ['Template'])
			self.assertEqual(
				alice.templates.fetchone(templates[0]['id']).get()['notification_services'],
				[1]
			)

			statics = alice.static_reminders.fetchall()
			if version >= 5:
				self.assertEqual([s['title'] for s in statics], ['Static'])
			else:
				self.assertEqual(statics, [])

			# Nothing of User1 survived, and no dangling links exist
			self.assertEqual(
				cursor.execute(
					"SELECT COUNT(*) FROM notification_services WHERE title = 'User1 service';"
				).fetchone()[0],
				0
			)
			self.assertEqual(
				cursor.execute("""
					SELECT COUNT(*) FROM reminder_services rs
					LEFT JOIN notification_services ns ON rs.notification_service_id = ns.id
					WHERE ns.id IS NULL;
				""").fetchone()[0],
				0
			)
			self.assertEqual(cursor.execute("PRAGMA foreign_key_check;").fetchall(), [])

			# The migrated database is fully usable
			new = alice.reminders.add('New', future(), [1])
			self.assertEqual(new.get()['notification_services'], [1])
			alice.static_reminders.add('New static', [1])
			alice.templates.add('New template', [1])

	@known_bug('BUG-07')
	def test_migrate_from_v1(self):
		self.migrate_from(1)
		self.check_migrated(1)

	@known_bug('BUG-07')
	def test_migrate_from_v2(self):
		self.migrate_from(2)
		self.check_migrated(2)

	@known_bug('BUG-07')
	def test_migrate_from_v3(self):
		self.migrate_from(3)
		self.check_migrated(3)

	@known_bug('BUG-07')
	def test_migrate_from_v4(self):
		self.migrate_from(4)
		self.check_migrated(4)

	@known_bug('BUG-07')
	def test_migrate_from_v5(self):
		self.migrate_from(5)
		self.check_migrated(5)

	def test_migrate_from_v6(self):
		self.migrate_from(6)
		self.check_migrated(6)

	def test_migrate_from_v7(self):
		self.migrate_from(7)
		self.check_migrated(7)

	def test_migrate_from_v8_resets_hosting_settings(self):
		# V8 -> V9 moved the hosting settings from MIND.py into the database
		with self.ctx():
			setup_db()
			set_setting('host', '10.1.2.3')
			set_setting('port', 1234)
			set_setting('database_version', 8)
		with self.ctx():
			setup_db()
			self.assertEqual(get_setting('host'), '0.0.0.0')
			self.assertEqual(get_setting('port'), 8080)
			self.assertEqual(get_setting('database_version'), __DATABASE_VERSION__)

	def test_migrate_from_v9_updates_manifest(self):
		with self.ctx():
			setup_db()
			set_setting('url_prefix', '/mind')
			set_setting('database_version', 9)
		self.manifest_mock.reset_mock()
		with self.ctx():
			setup_db()
		self.assertEqual(
			[c.args for c in self.manifest_mock.call_args_list],
			[('/mind',), ('/mind',)] # once by setup_db, once by the migration
		)

	@unittest.skipUnless(hasattr(time, 'tzset'), 'Needs time.tzset()')
	def test_v1_to_v2_converts_local_times_to_utc(self):
		# Version 1 stored local times. V1 -> V2 subtracts the UTC offset.
		original_tz = os.environ.get('TZ')
		os.environ['TZ'] = 'Asia/Tokyo' # UTC+9, no DST
		time.tzset()
		try:
			con = sqlite3.connect(DBConnection.file)
			con.executescript(LEGACY_SCHEMAS[1])
			con.execute("INSERT INTO config(key, value) VALUES ('database_version', 1);")
			salt, hashed = generate_salt_hash('pw')
			con.execute("INSERT INTO users(username, salt, hash) VALUES ('alice', ?, ?);", (salt, hashed))
			con.execute("INSERT INTO notification_services(user_id, title, url) VALUES (1, 's', ?);", (DEFAULT_URL,))
			con.execute(
				"INSERT INTO reminders(user_id, title, time, notification_service) VALUES (1, 'r', ?, 1);",
				(self.T1,)
			)
			con.commit()
			con.close()

			from backend import db as db_module

			class StopAtFirstScript:
				"""Cursor proxy that halts migrate_db() after V1 -> V2."""
				def __init__(self, cursor):
					self._cursor = cursor
				def executescript(self, *args):
					raise StopIteration
				def __iter__(self):
					return iter(self._cursor)
				def __getattr__(self, name):
					return getattr(self._cursor, name)

			with self.ctx():
				real_cursor = get_db()
				with mock.patch.object(
					db_module, 'get_db',
					lambda *a, **k: StopAtFirstScript(real_cursor)
				):
					with self.assertRaises(StopIteration):
						db_module.migrate_db(1)
			self.assertEqual(
				self.sql("SELECT time FROM reminders;"),
				[(self.T1 - 9 * 3600,)]
			)
		finally:
			if original_tz is None:
				os.environ.pop('TZ', None)
			else:
				os.environ['TZ'] = original_tz
			time.tzset()


class Test_ImportDB(LegacyDatabaseMixin, MindTestCase):
	def make_mind_db(self, path: str, port: int = 8080, extra_user: str = 'imported') -> None:
		"""Create a valid, current MIND database file at `path`."""
		current = DBConnection.file
		close_thread_connection()
		DBConnection.file = path
		try:
			with self.ctx():
				setup_db()
				set_setting('port', port)
				Users().add(extra_user, 'pw', True)
		finally:
			close_thread_connection()
			DBConnection.file = current

	def upload_path(self) -> str:
		return os.path.join(self.tmp_dir, 'MIND_upload.db')

	def test_import_valid_database(self):
		self.make_mind_db(self.upload_path(), port=5555)
		with self.ctx():
			set_setting('port', 1111)
		with self.ctx():
			import_db(self.upload_path(), copy_hosting_settings=False)

		self.restart_mock.assert_called_once_with([RestartVars.DB_IMPORT.value])
		self.assertFalse(os.path.exists(self.upload_path()))
		original = os.path.join(self.tmp_dir, __DATEBASE_NAME_ORIGINAL__)
		self.assertTrue(os.path.exists(original))

		close_thread_connection()
		with self.ctx():
			self.assertIn('imported', Users())
			self.assertEqual(get_setting('port'), 5555)

	@known_bug('BUG-16', when=WAL_SURVIVES_CLOSE)
	def test_import_copies_hosting_settings(self):
		self.make_mind_db(self.upload_path(), port=5555)
		with self.ctx():
			set_setting('host', '10.0.0.7')
			set_setting('port', 1111)
			set_setting('url_prefix', '/here')
		with self.ctx():
			import_db(self.upload_path(), copy_hosting_settings=True)
		close_thread_connection()
		with self.ctx():
			self.assertIn('imported', Users())
			self.assertEqual(get_setting('host'), '10.0.0.7')
			self.assertEqual(get_setting('port'), 1111)
			self.assertEqual(get_setting('url_prefix'), '/here')

	@known_bug('BUG-16')
	def test_import_survives_writes_during_restart_window(self):
		# After an import MIND restarts after one second. Requests that are
		# still being served in that window write to the live connection.
		# The imported data must not be lost or mixed with the old database.
		self.make_mind_db(self.upload_path(), extra_user='imported')
		self.create_user('original_only')
		with self.ctx():
			import_db(self.upload_path(), copy_hosting_settings=True)
			for i in range(25):
				Users().add(f'late{i}', 'pw', True)
		close_thread_connection()
		con = sqlite3.connect(DBConnection.file)
		try:
			self.assertEqual(con.execute("PRAGMA integrity_check;").fetchone(), ('ok',))
			usernames = {r[0] for r in con.execute("SELECT username FROM users;")}
		finally:
			con.close()
		self.assertIn('imported', usernames)
		self.assertNotIn('original_only', usernames)

	@known_bug('BUG-16', when=WAL_SURVIVES_CLOSE)
	def test_import_leaves_no_stray_upload_files(self):
		self.make_mind_db(self.upload_path())
		with self.ctx():
			import_db(self.upload_path(), copy_hosting_settings=True)
		self.assertEqual(
			[f for f in os.listdir(self.tmp_dir) if f.startswith('MIND_upload')],
			[]
		)

	def test_import_newer_version_rejected(self):
		self.make_mind_db(self.upload_path())
		con = sqlite3.connect(self.upload_path())
		con.execute(
			"UPDATE config SET value = ? WHERE key = 'database_version';",
			(__DATABASE_VERSION__ + 1,)
		)
		con.commit()
		con.close()
		with self.ctx():
			with self.assertRaises(InvalidDatabaseFile):
				import_db(self.upload_path(), False)
		self.assertFalse(os.path.exists(self.upload_path()))
		self.restart_mock.assert_not_called()

	def test_import_sqlite_without_config_rejected(self):
		con = sqlite3.connect(self.upload_path())
		con.execute("CREATE TABLE something(x);")
		con.commit()
		con.close()
		with self.ctx():
			with self.assertRaises(InvalidDatabaseFile):
				import_db(self.upload_path(), False)
		self.assertFalse(os.path.exists(self.upload_path()))

	def test_import_pre_v8_database_rejected(self):
		# Old databases stored the version as TEXT, which import_db refuses.
		# Documented: "The database file is too old".
		self.build_legacy_db(7, self.upload_path())
		with self.ctx():
			with self.assertRaises(InvalidDatabaseFile):
				import_db(self.upload_path(), False)
		self.assertFalse(os.path.exists(self.upload_path()))

	@known_bug('BUG-08')
	def test_import_non_sqlite_file_rejected(self):
		with open(self.upload_path(), 'wb') as f:
			f.write(b'definitely not a database ' * 200)
		with self.ctx():
			with self.assertRaises(InvalidDatabaseFile):
				import_db(self.upload_path(), False)
		self.assertFalse(os.path.exists(self.upload_path()))

	@known_bug('BUG-08')
	def test_import_without_version_row_rejected(self):
		con = sqlite3.connect(self.upload_path())
		con.execute("CREATE TABLE config(key VARCHAR(255) PRIMARY KEY, value BLOB NOT NULL);")
		con.commit()
		con.close()
		with self.ctx():
			with self.assertRaises(InvalidDatabaseFile):
				import_db(self.upload_path(), False)

	def test_revert_keep_imported(self):
		original = os.path.join(self.tmp_dir, __DATEBASE_NAME_ORIGINAL__)
		with open(original, 'w') as f:
			f.write('backup')
		close_thread_connection()
		revert_db_import(swap=False)
		self.assertFalse(os.path.exists(original))
		self.assertTrue(os.path.exists(DBConnection.file))

	def test_revert_swap_back(self):
		original = os.path.join(self.tmp_dir, __DATEBASE_NAME_ORIGINAL__)
		close_thread_connection()
		shutil.copy(DBConnection.file, original)
		with open(DBConnection.file, 'w') as f:
			f.write('imported')
		revert_db_import(swap=True)
		self.assertFalse(os.path.exists(original))
		con = sqlite3.connect(DBConnection.file)
		self.assertEqual(con.execute("SELECT username FROM users;").fetchall(), [('admin',)])
		con.close()

	def test_revert_explicit_file(self):
		other = os.path.join(self.tmp_dir, 'other.db')
		with open(other, 'w') as f:
			f.write('x')
		revert_db_import(swap=False, imported_db_file=other)
		self.assertFalse(os.path.exists(other))


if __name__ == '__main__':
	unittest.main()
