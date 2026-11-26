#-*- coding: utf-8 -*-

"""
Tests for `frontend.input_validation`: every input variable class, the
API documentation registry and the `input_validation()` request parser.
"""

import inspect
import io
import logging
import os
import unittest
from unittest import mock

from werkzeug.datastructures import FileStorage

from _harness import MindTestCase

import frontend.input_validation as iv
from backend.custom_exceptions import (InvalidDatabaseFile, InvalidKeyValue,
                                       KeyNotFound)
from backend.helpers import (RepeatQuantity, SortingMethod,
                             TimelessSortingMethod)
from backend.server import SERVER
from frontend.input_validation import (DataSource, Method, Methods, api_docs,
                                       get_api_docs, input_validation)


def valid(cls, value) -> bool:
	return bool(cls(value).validate())


def converted(cls, value):
	instance = cls(value)
	assert instance.validate(), f'{cls.__name__}({value!r}) should be valid'
	return instance.value


ALL_VARIABLES = [
	cls for _, cls in inspect.getmembers(iv, inspect.isclass)
	if issubclass(cls, iv.InputVariable)
	and cls.__module__ == iv.__name__
	and hasattr(cls, 'name') and isinstance(cls.__dict__.get('name', getattr(cls, 'name', None)), str)
]


class Test_Variables(unittest.TestCase):
	def test_all_variables_are_concrete(self):
		self.assertGreater(len(ALL_VARIABLES), 25)
		for cls in ALL_VARIABLES:
			with self.subTest(cls=cls.__name__):
				instance = cls(None)
				self.assertIsInstance(instance.name, str)
				self.assertIsInstance(instance.required, bool)
				self.assertIn(instance.source, (DataSource.DATA, DataSource.VALUES, DataSource.FILES))
				self.assertTrue(instance.description)
				self.assertTrue(instance.data_type)
				self.assertTrue(instance.related_exceptions)

	def test_markdown_rows(self):
		# Used by project_management/generate_api_docs.py
		for cls in ALL_VARIABLES:
			with self.subTest(cls=cls.__name__):
				row = repr(cls(''))
				self.assertTrue(row.startswith('| ') and row.endswith(' |'))
				self.assertEqual(row.count(' | '), 4)
				self.assertTrue(row.startswith(f'| {cls.name} | '))

	def test_required_flags(self):
		self.assertTrue(iv.TitleVariable.required)
		self.assertFalse(iv.EditTitleVariable.required)
		self.assertTrue(iv.TimeVariable.required)
		self.assertFalse(iv.EditTimeVariable.required)
		self.assertFalse(iv.TextVariable.required)
		self.assertFalse(iv.ColorVariable.required)
		self.assertTrue(iv.QueryVariable.required)
		self.assertFalse(iv.SortByVariable.required)

	def test_base_string(self):
		for good in ('a', ' ', 'ü', '0'):
			self.assertTrue(valid(iv.TitleVariable, good))
		for bad in ('', None, 1, [], {}, True):
			self.assertFalse(valid(iv.TitleVariable, bad), bad)

	def test_non_required_string(self):
		self.assertTrue(valid(iv.EditTitleVariable, None))
		self.assertIsNone(converted(iv.EditTitleVariable, None))
		self.assertTrue(valid(iv.EditTitleVariable, 'x'))
		self.assertFalse(valid(iv.EditTitleVariable, ''))
		self.assertFalse(valid(iv.EditTitleVariable, 5))

	def test_url(self):
		for good in ('json://localhost', 'json://example.com/path', 'mailto://user:pass@example.com'):
			self.assertTrue(valid(iv.URLVariable, good), good)
		for bad in ('', 'not a url', 'http//missing-colon', 'unknownscheme://x', None, 1):
			self.assertFalse(valid(iv.URLVariable, bad), bad)
		self.assertTrue(valid(iv.EditURLVariable, None))
		self.assertFalse(valid(iv.EditURLVariable, 'nope'))

	def test_sort_by(self):
		self.assertEqual(iv.SortByVariable.default, 'time')
		self.assertEqual(converted(iv.SortByVariable, None), SortingMethod.TIME)
		for method in SortingMethod:
			self.assertEqual(converted(iv.SortByVariable, method.name.lower()), method)
		for bad in ('TIME', 'Time', 'date', '', 'time ', 1):
			self.assertFalse(valid(iv.SortByVariable, bad), bad)

	def test_timeless_sort_by(self):
		self.assertEqual(iv.TimelessSortByVariable.default, 'title')
		self.assertEqual(converted(iv.TimelessSortByVariable, None), TimelessSortingMethod.TITLE)
		for method in TimelessSortingMethod:
			self.assertEqual(converted(iv.TimelessSortByVariable, method.name.lower()), method)
		self.assertFalse(valid(iv.TimelessSortByVariable, 'time'))

	def test_time(self):
		for good in (0, 1, 1893456000, 1893456000.5, -5):
			self.assertTrue(valid(iv.TimeVariable, good), good)
		for bad in ('1893456000', None, [], '2030-01-01'):
			self.assertFalse(valid(iv.TimeVariable, bad), bad)
		self.assertTrue(valid(iv.EditTimeVariable, None))

	def test_time_accepts_bool(self):
		# bool is an int subclass. True becomes time 1, which is then
		# rejected later as InvalidTime.
		self.assertTrue(valid(iv.TimeVariable, True))

	def test_time_rejects_non_finite(self):
		for bad in (float('nan'), float('inf'), float('-inf')):
			self.assertFalse(valid(iv.TimeVariable, bad), bad)

	def test_notification_services(self):
		self.assertTrue(valid(iv.NotificationServicesVariable, [1]))
		self.assertTrue(valid(iv.NotificationServicesVariable, [1, 2, 3]))
		for bad in ([], None, 1, '1', ['1'], [1, '2'], [1.0], {'a': 1}):
			self.assertFalse(valid(iv.NotificationServicesVariable, bad), bad)
		self.assertTrue(valid(iv.EditNotificationServicesVariable, None))
		self.assertFalse(valid(iv.EditNotificationServicesVariable, []))

	def test_text(self):
		self.assertEqual(converted(iv.TextVariable, None), '')
		self.assertEqual(converted(iv.TextVariable, ''), '')
		self.assertEqual(converted(iv.TextVariable, 'body'), 'body')
		self.assertFalse(valid(iv.TextVariable, 5))
		self.assertFalse(valid(iv.TextVariable, ['x']))

	def test_repeat_quantity(self):
		self.assertIsNone(converted(iv.RepeatQuantityVariable, None))
		for q in RepeatQuantity:
			self.assertEqual(converted(iv.RepeatQuantityVariable, q.value), q)
		for bad in ('day', 'Days', 'DAYS', 'seconds', '', 1):
			self.assertFalse(valid(iv.RepeatQuantityVariable, bad), bad)

	def test_repeat_interval(self):
		self.assertIsNone(converted(iv.RepeatIntervalVariable, None))
		for good in (1, 2, 100000):
			self.assertTrue(valid(iv.RepeatIntervalVariable, good))
		for bad in (0, -1, 1.5, '1', [1]):
			self.assertFalse(valid(iv.RepeatIntervalVariable, bad), bad)

	def test_weekdays(self):
		self.assertIsNone(converted(iv.WeekDaysVariable, None))
		for good in ([0], [6], [0, 1, 2, 3, 4, 5, 6], [3, 1]):
			self.assertTrue(valid(iv.WeekDaysVariable, good), good)
		for bad in ([], [7], [-1], ['0'], 0, '0,1', [0.0, 1.5]):
			self.assertFalse(valid(iv.WeekDaysVariable, bad), bad)

	def test_weekdays_allows_duplicates(self):
		self.assertTrue(valid(iv.WeekDaysVariable, [1, 1]))

	def test_color(self):
		self.assertIsNone(converted(iv.ColorVariable, None))
		for good in ('#000000', '#abcdef', '#3c3c3c', '#0a1b2c'):
			self.assertTrue(valid(iv.ColorVariable, good), good)
		for bad in ('#ABCDEF', '#abc', 'abcdef', '', 123, '#ghijkl'):
			self.assertFalse(valid(iv.ColorVariable, bad), bad)

	def test_color_must_be_exactly_one_hex_code(self):
		for bad in ('#abcdef00', 'x#abcdef', '#abcdef;background:url(x)', ' #abcdef', '#abcdef\n'):
			self.assertFalse(valid(iv.ColorVariable, bad), repr(bad))

	def test_delete_reminders_using(self):
		self.assertIs(converted(iv.DeleteRemindersUsingVariable, None), False)
		self.assertIs(converted(iv.DeleteRemindersUsingVariable, 'true'), True)
		self.assertIs(converted(iv.DeleteRemindersUsingVariable, 'false'), False)
		for bad in ('True', '1', 'yes', ''):
			self.assertFalse(valid(iv.DeleteRemindersUsingVariable, bad), bad)

	def test_copy_hosting_settings(self):
		self.assertIs(converted(iv.CopyHostingSettingsVariable, 'true'), True)
		self.assertIs(converted(iv.CopyHostingSettingsVariable, 'false'), False)
		for bad in ('True', None, '', 'yes'):
			self.assertFalse(valid(iv.CopyHostingSettingsVariable, bad), bad)

	def test_admin_settings(self):
		cases = [
			(iv.AllowNewAccountsVariable, [True, False], ['true', 1, 'yes']),
			(iv.LoginTimeVariable, [60, 3600, 2592000], [59, 2592001, '60', 60.0]),
			(iv.LoginTimeResetVariable, [True, False], ['false', 0]),
			(iv.HostVariable, ['0.0.0.0', 'localhost', ''], [1, ['x']]),
			(iv.PortVariable, [1, 8080, 65535], [0, 65536, '8080']),
			(iv.UrlPrefixVariable, ['', '/', '/mind', 'mind/'], [1, ['x']]),
			(iv.LogLevelVariable, [logging.INFO, logging.DEBUG], [logging.WARNING, '20']),
		]
		for cls, goods, bads in cases:
			with self.subTest(cls=cls.__name__):
				self.assertTrue(valid(cls, None))
				for good in goods:
					self.assertTrue(valid(cls, good), good)
				for bad in bads:
					self.assertFalse(valid(cls, bad), bad)

	def test_admin_setting_value_is_not_normalised(self):
		# Validation only checks; set_setting() does the normalising later
		self.assertEqual(converted(iv.UrlPrefixVariable, 'mind/'), 'mind/')


class Test_DatabaseFileVariable(unittest.TestCase):
	def setUp(self):
		import tempfile
		import shutil
		self.tmp = tempfile.mkdtemp(prefix='mind-upload-')
		self.addCleanup(shutil.rmtree, self.tmp, True)
		patcher = mock.patch.object(iv, 'folder_path', lambda *p: os.path.join(self.tmp, *p[1:]))
		patcher.start()
		self.addCleanup(patcher.stop)

	def file(self, name, content=b'data'):
		return FileStorage(stream=io.BytesIO(content), filename=name)

	def test_db_file_is_saved(self):
		var = iv.DatabaseFileVariable(self.file('backup.db', b'sqlite bytes'))
		self.assertTrue(var.validate())
		self.assertEqual(var.value, os.path.join(self.tmp, 'MIND_upload.db'))
		with open(var.value, 'rb') as f:
			self.assertEqual(f.read(), b'sqlite bytes')

	def test_other_extensions_rejected(self):
		for name in ('backup.sqlite', 'backup.db.txt', 'backup', '.db.bak', 'db'):
			with self.subTest(name=name):
				self.assertFalse(iv.DatabaseFileVariable(self.file(name)).validate())
		self.assertFalse(os.path.exists(os.path.join(self.tmp, 'MIND_upload.db')))

	def test_empty_filename_rejected(self):
		self.assertFalse(iv.DatabaseFileVariable(self.file('')).validate())

	def test_dotfile_named_db_is_rejected(self):
		# os.path.splitext('.db') == ('.db', ''): a file literally named
		# '.db' has no extension.
		self.assertFalse(iv.DatabaseFileVariable(self.file('.db')).validate())


class Test_MethodObjects(unittest.TestCase):
	def test_method_truthiness(self):
		self.assertFalse(Method())
		self.assertFalse(Method(description='only a description'))
		self.assertTrue(Method(vars=[iv.TitleVariable]))

	def test_methods_truthiness_and_lookup(self):
		self.assertFalse(Methods())
		methods = Methods(put=Method(vars=[iv.TitleVariable]))
		self.assertTrue(methods)
		self.assertIs(methods['PUT'], methods.put)
		self.assertIs(methods['put'], methods.put)
		self.assertFalse(methods['GET'])


class Test_ApiDocsRegistry(MindTestCase):
	SETUP_DB = False

	def rules(self):
		return {
			rule.rule: rule
			for rule in self.app.url_map.iter_rules()
			if rule.rule.startswith('/api')
		}

	def test_every_api_route_is_documented(self):
		for path, rule in self.rules().items():
			with self.subTest(path=path):
				if path.startswith(SERVER.admin_prefix):
					key = SERVER.admin_api_extension + path[len(SERVER.admin_prefix):]
				else:
					key = path[len(SERVER.api_prefix):]
				self.assertIn(key, api_docs)
				entry = api_docs[key]
				self.assertEqual(
					set(entry.used_methods),
					rule.methods - {'HEAD', 'OPTIONS'}
				)

	def test_every_documented_route_exists(self):
		paths = set(self.rules())
		for key in api_docs:
			if key.startswith(SERVER.admin_api_extension + '/'):
				expected = SERVER.api_prefix + key
			else:
				expected = SERVER.api_prefix + key
			self.assertIn(expected, paths, key)

	def test_known_public_endpoints(self):
		public = sorted(k for k, v in api_docs.items() if not v.requires_auth)
		self.assertEqual(public, ['/auth/login', '/settings', '/user/add'])

	def test_admin_endpoints(self):
		admin = sorted(k for k in api_docs if k.startswith('/admin'))
		self.assertEqual(admin, [
			'/admin/database', '/admin/logs', '/admin/restart',
			'/admin/settings', '/admin/shutdown', '/admin/users',
			'/admin/users/<int:u_id>'
		])

	def test_get_api_docs(self):
		with self.app.test_request_context('/api/reminders/5', method='PUT'):
			self.assertEqual(get_api_docs(iv.request).endpoint, '/reminders/<int:r_id>')
		with self.app.test_request_context('/api/admin/users/3', method='PUT'):
			self.assertEqual(get_api_docs(iv.request).endpoint, '/admin/users/<int:u_id>')
		with self.app.test_request_context('/api/settings'):
			self.assertEqual(get_api_docs(iv.request).endpoint, '/settings')
		with self.app.test_request_context('/api/admin/settings'):
			self.assertEqual(get_api_docs(iv.request).endpoint, '/admin/settings')

	def test_documented_vars_are_used_by_their_methods(self):
		for key, entry in api_docs.items():
			for method_name in ('get', 'post', 'put', 'delete'):
				method = getattr(entry.methods, method_name)
				if method:
					with self.subTest(endpoint=key, method=method_name):
						self.assertIn(method_name.upper(), entry.used_methods)


class Test_InputValidation(MindTestCase):
	SETUP_DB = False

	def parse(self, path, method='GET', **kwargs):
		with self.app.test_request_context(path, method=method, **kwargs):
			return input_validation()

	def test_endpoint_without_methods_returns_none(self):
		self.assertIsNone(self.parse('/api/auth/status'))

	def test_method_without_vars_returns_empty_dict(self):
		self.assertEqual(self.parse('/api/reminders/1', method='DELETE'), {})
		self.assertEqual(self.parse('/api/reminders/1', method='GET'), {})

	def test_required_key_missing(self):
		with self.assertRaises(KeyNotFound) as cm:
			self.parse('/api/auth/login', method='POST', json={'username': 'x'})
		self.assertEqual(cm.exception.key, 'password')

	def test_first_missing_key_is_reported(self):
		with self.assertRaises(KeyNotFound) as cm:
			self.parse('/api/auth/login', method='POST', json={})
		self.assertEqual(cm.exception.key, 'username')

	def test_invalid_value(self):
		with self.assertRaises(InvalidKeyValue) as cm:
			self.parse('/api/auth/login', method='POST', json={'username': '', 'password': 'x'})
		self.assertEqual((cm.exception.key, cm.exception.value), ('username', ''))

	def test_defaults_and_conversion(self):
		result = self.parse('/api/reminders', method='POST', json={
			'title': 'T', 'time': 5, 'notification_services': [1],
			'repeat_quantity': 'days', 'repeat_interval': 2
		})
		self.assertEqual(result, {
			'title': 'T',
			'time': 5,
			'notification_services': [1],
			'text': '',
			'repeat_quantity': RepeatQuantity.DAYS,
			'repeat_interval': 2,
			'weekdays': None,
			'color': None,
		})

	def test_extra_keys_are_ignored(self):
		result = self.parse('/api/auth/login', method='POST', json={
			'username': 'u', 'password': 'p', 'admin': True
		})
		self.assertEqual(result, {'username': 'u', 'password': 'p'})

	def test_url_values_source(self):
		result = self.parse('/api/reminders/search?query=milk&sort_by=title')
		self.assertEqual(result, {'sort_by': SortingMethod.TITLE, 'query': 'milk'})

	def test_url_values_are_not_read_from_body(self):
		with self.assertRaises(KeyNotFound):
			self.parse('/api/reminders/search', json={'query': 'milk'})

	def test_body_values_are_not_read_from_url(self):
		with self.assertRaises(KeyNotFound):
			self.parse('/api/auth/login?username=u&password=p', method='POST')

	def test_form_values_count_as_url_values(self):
		# request.values merges the query string and form data...
		result = self.parse(
			'/api/notificationservices/1', method='DELETE',
			data={'delete_reminders_using': 'true'},
			content_type='application/x-www-form-urlencoded'
		)
		self.assertIs(result['delete_reminders_using'], True)

	def test_form_values_are_ignored_for_get(self):
		# ...except for GET requests (Werkzeug >= 2.0)
		with self.assertRaises(KeyNotFound):
			self.parse(
				'/api/reminders/search', method='GET',
				data={'query': 'milk'},
				content_type='application/x-www-form-urlencoded'
			)

	def test_json_null_is_invalid_for_required(self):
		with self.assertRaises(InvalidKeyValue):
			self.parse('/api/auth/login', method='POST', json={'username': None, 'password': 'p'})

	def test_json_null_means_default_for_optional(self):
		result = self.parse('/api/reminders/1', method='PUT', json={'title': None, 'text': None})
		self.assertIsNone(result['title'])
		self.assertEqual(result['text'], '')

	def test_admin_settings_all_optional(self):
		self.assertEqual(self.parse('/api/admin/settings', method='PUT', json={}), {
			'allow_new_accounts': None, 'login_time': None,
			'login_time_reset': None, 'host': None, 'port': None,
			'url_prefix': None, 'log_level': None
		})

	def test_file_source(self):
		patcher = mock.patch.object(iv, 'folder_path', lambda *p: os.path.join(self.tmp_dir, *p[1:]))
		patcher.start()
		self.addCleanup(patcher.stop)
		result = self.parse(
			'/api/admin/database?copy_hosting_settings=true', method='POST',
			data={'file': (io.BytesIO(b'x'), 'backup.db')},
			content_type='multipart/form-data'
		)
		self.assertEqual(result, {
			'file': os.path.join(self.tmp_dir, 'MIND_upload.db'),
			'copy_hosting_settings': True
		})

	def test_missing_file(self):
		with self.assertRaises(KeyNotFound) as cm:
			self.parse(
				'/api/admin/database?copy_hosting_settings=true', method='POST',
				data={}, content_type='multipart/form-data'
			)
		self.assertEqual(cm.exception.key, 'file')

	def test_wrong_file_type_is_invalid_database_file(self):
		with self.assertRaises(InvalidDatabaseFile):
			self.parse(
				'/api/admin/database?copy_hosting_settings=true', method='POST',
				data={'file': (io.BytesIO(b'x'), 'backup.txt')},
				content_type='multipart/form-data'
			)


if __name__ == '__main__':
	unittest.main()
