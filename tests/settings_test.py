#-*- coding: utf-8 -*-

"""
Tests for `backend.settings`: value formatting, reading/writing settings,
hosting-setting backups and the PWA manifest updater.
"""

import json
import logging
import os
import shutil
import unittest
from unittest import mock

from _harness import MindTestCase

from backend import settings
from backend.custom_exceptions import InvalidKeyValue, KeyNotFound
from backend.db import __DATABASE_VERSION__, get_db
from backend.helpers import folder_path
from backend.settings import (_format_setting, _reverse_format_setting,
                              backup_hosting_settings, default_settings,
                              get_admin_settings, get_setting,
                              restore_hosting_settings, set_setting)


class Test_FormatSetting(unittest.TestCase):
	"""`_format_setting` is pure, so no database is needed."""

	def assertInvalid(self, key, value):
		with self.assertRaises(InvalidKeyValue, msg=f'{key}={value!r}') as cm:
			_format_setting(key, value)
		self.assertEqual(cm.exception.key, key)
		self.assertEqual(cm.exception.api_response['result'], {'key': key, 'value': value})

	def test_database_version(self):
		self.assertEqual(_format_setting('database_version', 5), 5)
		self.assertEqual(_format_setting('database_version', '7'), 7)
		self.assertInvalid('database_version', 'seven')

	def test_booleans(self):
		for key in ('allow_new_accounts', 'login_time_reset'):
			with self.subTest(key=key):
				self.assertEqual(_format_setting(key, True), 1)
				self.assertEqual(_format_setting(key, False), 0)
				for bad in (1, 0, 'true', None, 'yes'):
					self.assertInvalid(key, bad)

	def test_login_time_bounds(self):
		for good in (60, 3600, 2592000):
			self.assertEqual(_format_setting('login_time', good), good)
		for bad in (59, 2592001, -1, 0, '3600', 3600.0, None):
			self.assertInvalid('login_time', bad)

	def test_login_time_rejects_true(self):
		# bool is a subclass of int, but True == 1 is outside the bounds.
		self.assertInvalid('login_time', True)

	def test_host(self):
		self.assertEqual(_format_setting('host', '127.0.0.1'), '127.0.0.1')
		self.assertEqual(_format_setting('host', ''), '')
		for bad in (1, None, ['0.0.0.0']):
			self.assertInvalid('host', bad)

	def test_port_bounds(self):
		for good in (1, 80, 8080, 65535):
			self.assertEqual(_format_setting('port', good), good)
		for bad in (0, 65536, -80, '8080', 80.5, None):
			self.assertInvalid('port', bad)

	def test_url_prefix_normalisation(self):
		cases = {
			'': '',
			'/': '',
			'mind': '/mind',
			'/mind': '/mind',
			'/mind/': '/mind',
			'mind/': '/mind',
			'//mind//': '/mind',
			'a/b': '/a/b',
			'/a/b/': '/a/b',
		}
		for given, expected in cases.items():
			with self.subTest(given=given):
				self.assertEqual(_format_setting('url_prefix', given), expected)
		for bad in (None, 1, ['/mind']):
			self.assertInvalid('url_prefix', bad)

	def test_log_level(self):
		self.assertEqual(_format_setting('log_level', logging.INFO), logging.INFO)
		self.assertEqual(_format_setting('log_level', logging.DEBUG), logging.DEBUG)
		for bad in (logging.WARNING, logging.ERROR, 0, '20', None):
			self.assertInvalid('log_level', bad)

	def test_unknown_key_passes_through(self):
		# _format_setting does not validate keys; set_setting does.
		self.assertEqual(_format_setting('host_backup', 'x'), 'x')

	def test_defaults_are_valid(self):
		for key, value in default_settings.items():
			with self.subTest(key=key):
				_format_setting(key, value)


class Test_ReverseFormatSetting(unittest.TestCase):
	def test_booleans(self):
		for key in ('allow_new_accounts', 'login_time_reset'):
			self.assertIs(_reverse_format_setting(key, 1), True)
			self.assertIs(_reverse_format_setting(key, 0), False)

	def test_ints_from_text(self):
		# Databases created before V8 stored config values as TEXT
		for key in ('log_level', 'database_version', 'login_time'):
			self.assertEqual(_reverse_format_setting(key, '20'), 20)
			self.assertIsInstance(_reverse_format_setting(key, '20'), int)

	def test_strings_untouched(self):
		self.assertEqual(_reverse_format_setting('host', '0.0.0.0'), '0.0.0.0')
		self.assertEqual(_reverse_format_setting('url_prefix', '/x'), '/x')
		self.assertEqual(_reverse_format_setting('port', 8080), 8080)

	def test_roundtrip(self):
		for key, value in default_settings.items():
			with self.subTest(key=key):
				self.assertEqual(
					_reverse_format_setting(key, _format_setting(key, value)),
					value
				)


class Test_SettingsStorage(MindTestCase):
	def test_defaults_after_setup(self):
		with self.ctx():
			for key, value in default_settings.items():
				with self.subTest(key=key):
					self.assertEqual(get_setting(key), value)

	def test_database_version_is_current(self):
		with self.ctx():
			self.assertEqual(get_setting('database_version'), __DATABASE_VERSION__)

	def test_get_unknown_key(self):
		with self.ctx():
			with self.assertRaises(KeyNotFound) as cm:
				get_setting('nope')
			self.assertEqual(cm.exception.key, 'nope')

	def test_set_unknown_key(self):
		with self.ctx():
			with self.assertRaises(KeyNotFound):
				set_setting('nope', 1)
			# Backup keys exist in the table but may not be set directly
			with self.assertRaises(KeyNotFound):
				set_setting('host_backup', '1.2.3.4')

	def test_set_invalid_value_changes_nothing(self):
		with self.ctx():
			with self.assertRaises(InvalidKeyValue):
				set_setting('port', 0)
			self.assertEqual(get_setting('port'), 8080)

	def test_set_and_get_persist_across_contexts(self):
		with self.ctx():
			set_setting('allow_new_accounts', False)
			set_setting('login_time', 120)
			set_setting('login_time_reset', False)
			set_setting('host', '127.0.0.1')
			set_setting('port', 9090)
		with self.ctx():
			self.assertIs(get_setting('allow_new_accounts'), False)
			self.assertEqual(get_setting('login_time'), 120)
			self.assertIs(get_setting('login_time_reset'), False)
			self.assertEqual(get_setting('host'), '127.0.0.1')
			self.assertEqual(get_setting('port'), 9090)

	def test_set_url_prefix_updates_manifest(self):
		self.manifest_mock.reset_mock()
		with self.ctx():
			set_setting('url_prefix', 'mind/')
			self.assertEqual(get_setting('url_prefix'), '/mind')
		self.manifest_mock.assert_called_once_with('/mind')

	def test_set_log_level_changes_logger(self):
		with self.ctx(), mock.patch.object(settings, 'set_log_level') as set_log_level:
			set_setting('log_level', logging.DEBUG)
			set_log_level.assert_called_once_with(logging.DEBUG)
			self.assertEqual(get_setting('log_level'), logging.DEBUG)

	def test_admin_settings_keys(self):
		with self.ctx():
			result = get_admin_settings()
		self.assertEqual(
			set(result),
			{'allow_new_accounts', 'login_time', 'login_time_reset',
			'host', 'port', 'url_prefix', 'log_level'}
		)
		# database_version and backups are internal
		self.assertNotIn('database_version', result)
		self.assertIs(result['allow_new_accounts'], True)
		self.assertEqual(result['login_time'], 3600)

	def test_admin_settings_ignore_backup_keys(self):
		with self.ctx():
			backup_hosting_settings()
			result = get_admin_settings()
		self.assertFalse(any(k.endswith('_backup') for k in result))


class Test_HostingBackup(MindTestCase):
	def config(self):
		return dict(self.sql("SELECT key, value FROM config;"))

	def test_backup_creates_backup_keys(self):
		with self.ctx():
			backup_hosting_settings()
		config = self.config()
		self.assertEqual(config['host_backup'], '0.0.0.0')
		self.assertEqual(config['port_backup'], 8080)
		self.assertEqual(config['url_prefix_backup'], '')

	def test_backup_overwrites_previous_backup(self):
		with self.ctx():
			backup_hosting_settings()
			set_setting('port', 1234)
			backup_hosting_settings()
		self.assertEqual(self.config()['port_backup'], 1234)

	def test_restore(self):
		with self.ctx():
			backup_hosting_settings()
			set_setting('host', '10.0.0.1')
			set_setting('port', 5000)
			set_setting('url_prefix', '/new')
		self.manifest_mock.reset_mock()
		with self.ctx():
			restore_hosting_settings()
		with self.ctx():
			self.assertEqual(get_setting('host'), '0.0.0.0')
			self.assertEqual(get_setting('port'), 8080)
			self.assertEqual(get_setting('url_prefix'), '')
		self.manifest_mock.assert_called_once_with('')

	def test_restore_without_backup_is_noop(self):
		with self.ctx():
			set_setting('port', 5000)
			restore_hosting_settings()
			self.assertEqual(get_setting('port'), 5000)
		self.assertNotIn('port_backup', self.config())

	def test_restore_with_partial_backup_is_noop(self):
		with self.ctx():
			get_db().execute("INSERT INTO config(key, value) VALUES ('port_backup', 1);")
			set_setting('port', 5000)
			restore_hosting_settings()
			self.assertEqual(get_setting('port'), 5000)


class Test_UpdateManifest(unittest.TestCase):
	"""Runs the real `update_manifest` on a copy of the manifest file."""

	def setUp(self):
		import tempfile
		self.tmp = tempfile.mkdtemp(prefix='mind-manifest-')
		os.makedirs(os.path.join(self.tmp, 'frontend', 'static', 'json'))
		self.manifest = os.path.join(self.tmp, 'frontend', 'static', 'json', 'pwa_manifest.json')
		shutil.copy(folder_path('frontend', 'static', 'json', 'pwa_manifest.json'), self.manifest)
		patcher = mock.patch.object(
			settings, 'folder_path',
			lambda *p: os.path.join(self.tmp, *p)
		)
		patcher.start()
		self.addCleanup(patcher.stop)
		self.addCleanup(shutil.rmtree, self.tmp, True)

	def read(self):
		with open(self.manifest) as f:
			return json.load(f)

	def test_empty_prefix(self):
		settings.update_manifest('')
		manifest = self.read()
		self.assertEqual(manifest['start_url'], '/')
		self.assertEqual(manifest['icons'][0]['src'], '/static/img/favicon.svg')

	def test_prefix(self):
		settings.update_manifest('/mind')
		manifest = self.read()
		self.assertEqual(manifest['start_url'], '/mind/')
		self.assertEqual(manifest['icons'][0]['src'], '/mind/static/img/favicon.svg')

	def test_other_fields_preserved(self):
		before = self.read()
		settings.update_manifest('/x')
		settings.update_manifest('')
		after = self.read()
		self.assertEqual(before, after)

	def test_repo_manifest_is_in_default_state(self):
		# The committed manifest should match a MIND without a URL prefix
		with open(folder_path('frontend', 'static', 'json', 'pwa_manifest.json')) as f:
			manifest = json.load(f)
		self.assertEqual(manifest['start_url'], '/')
		self.assertEqual(manifest['icons'][0]['src'], '/static/img/favicon.svg')


if __name__ == '__main__':
	unittest.main()
