#-*- coding: utf-8 -*-

"""
Tests for `backend.helpers`, `backend.security` and `backend.logging`.
These modules are pure (no database), so no harness is needed.
"""

import logging
import os
import unittest
from base64 import urlsafe_b64decode
from collections import namedtuple
from unittest import mock

from backend import helpers
from backend.helpers import (BaseEnum, RepeatQuantity, RestartVars, Singleton,
                             SortingMethod, TimelessSortingMethod,
                             check_python_version, folder_path, search_filter,
                             when_not_none)
from backend.security import generate_salt_hash, get_hash

VersionInfo = namedtuple('VersionInfo', 'major minor micro')

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Test_FolderPath(unittest.TestCase):
	def test_no_args_is_project_root(self):
		self.assertEqual(folder_path(), REPO_ROOT)

	def test_joins_relative_to_project_root(self):
		self.assertEqual(
			folder_path('db', 'MIND.db'),
			os.path.join(REPO_ROOT, 'db', 'MIND.db')
		)

	def test_is_absolute(self):
		self.assertTrue(os.path.isabs(folder_path('frontend')))

	def test_points_at_real_folders(self):
		for folder in ('backend', 'frontend', 'tests'):
			self.assertTrue(os.path.isdir(folder_path(folder)), folder)


class Test_CheckPythonVersion(unittest.TestCase):
	def test_current_interpreter_is_supported(self):
		self.assertTrue(check_python_version())

	def test_versions(self):
		cases = {
			(3, 8, 0): True,
			(3, 11, 4): True,
			(3, 13, 0): True,
			(3, 7, 9): False,
			(2, 7, 18): False,
			(4, 0, 0): False # Only python 3 is accepted
		}
		for version, expected in cases.items():
			with self.subTest(version=version), \
			mock.patch.object(helpers, 'version_info', VersionInfo(*version)):
				self.assertIs(check_python_version(), expected)


class Test_SearchFilter(unittest.TestCase):
	entry = {'title': 'Buy Milk', 'text': 'At the Corner Shop'}

	def test_matches(self):
		for query in ('', 'buy', 'MILK', 'y m', 'corner', 'shop', 'At the'):
			with self.subTest(query=query):
				self.assertTrue(search_filter(query, self.entry))

	def test_non_matches(self):
		for query in ('bread', 'milkshake', '  ', 'xyz'):
			with self.subTest(query=query):
				self.assertFalse(search_filter(query, self.entry))

	def test_query_does_not_span_title_and_text(self):
		# Title and text are searched separately, not concatenated
		self.assertFalse(search_filter('milkat', self.entry))
		self.assertFalse(search_filter('milk at', self.entry))

	def test_unicode(self):
		entry = {'title': 'Café Ünïcode', 'text': 'Ωmega'}
		self.assertTrue(search_filter('café', entry))
		self.assertTrue(search_filter('ünï', entry))
		self.assertTrue(search_filter('ωmega', entry))


class Test_WhenNotNone(unittest.TestCase):
	def test_none_short_circuits(self):
		to_run = mock.Mock()
		self.assertIsNone(when_not_none(None, to_run))
		to_run.assert_not_called()

	def test_value_is_passed(self):
		self.assertEqual(when_not_none(2, lambda v: v * 21), 42)

	def test_falsy_values_are_not_none(self):
		for value in (0, '', [], False):
			with self.subTest(value=value):
				self.assertEqual(when_not_none(value, lambda v: ('ran', v)), ('ran', value))


class Test_Singleton(unittest.TestCase):
	def test_same_instance(self):
		class Thing(metaclass=Singleton):
			def __init__(self, value=None):
				self.value = value

		a = Thing(1)
		b = Thing(2)
		self.assertIs(a, b)
		# The constructor arguments of later calls are ignored
		self.assertEqual(b.value, 1)
		Singleton._instances.pop(str(Thing))

	def test_different_classes_are_separate(self):
		class A(metaclass=Singleton): pass
		class B(metaclass=Singleton): pass
		self.assertIsNot(A(), B())
		Singleton._instances.pop(str(A))
		Singleton._instances.pop(str(B))


class Test_Enums(unittest.TestCase):
	def test_base_enum_equals_value(self):
		self.assertTrue(RepeatQuantity.DAYS == 'days')
		self.assertFalse(RepeatQuantity.DAYS == 'weeks')
		self.assertTrue(RestartVars.DB_IMPORT == 'db_import')
		self.assertTrue(RestartVars.HOST_CHANGE == 'host_change')

	def test_base_enum_members_are_unhashable(self):
		# Quirk: BaseEnum overrides __eq__ without __hash__, which makes
		# Python set __hash__ to None. Members can't be used in sets or as
		# dict keys. Pinned here so a change is a conscious decision.
		self.assertIsNone(BaseEnum.__hash__)
		with self.assertRaises(TypeError):
			{RepeatQuantity.DAYS}

	def test_repeat_quantity_values_are_relativedelta_kwargs(self):
		from dateutil.relativedelta import relativedelta
		for q in RepeatQuantity:
			with self.subTest(quantity=q):
				relativedelta(**{q.value: 1})

	def test_repeat_quantity_values_are_plural(self):
		# The V3 -> V4 migration made all stored quantities plural
		for q in RepeatQuantity:
			self.assertTrue(q.value.endswith('s'))
			self.assertEqual(q.name.lower(), q.value)

	def _rows(self):
		return [
			{'id': 1, 'title': 'b', 'text': '', 'color': None, 'time': 30},
			{'id': 2, 'title': 'a', 'text': 'z', 'color': None, 'time': 20},
			{'id': 3, 'title': 'a', 'text': 'y', 'color': None, 'time': 10},
			{'id': 4, 'title': 'c', 'text': '', 'color': None, 'time': 10},
		]

	def _sorted_ids(self, method):
		rows = self._rows()
		rows.sort(key=method.value[0], reverse=method.value[1])
		return [r['id'] for r in rows]

	def test_sorting_method(self):
		expected = [
			(SortingMethod.TIME, [3, 4, 2, 1]),
			(SortingMethod.TIME_REVERSED, [1, 2, 4, 3]),
			(SortingMethod.TITLE, [3, 2, 1, 4]),
			(SortingMethod.TITLE_REVERSED, [4, 1, 2, 3]),
			(SortingMethod.DATE_ADDED, [1, 2, 3, 4]),
			(SortingMethod.DATE_ADDED_REVERSED, [4, 3, 2, 1]),
		]
		self.assertEqual([m for m, _ in expected], list(SortingMethod))
		for method, ids in expected:
			with self.subTest(method=method):
				self.assertEqual(self._sorted_ids(method), ids)

	def test_timeless_sorting_method(self):
		expected = [
			(TimelessSortingMethod.TITLE, [3, 2, 1, 4]),
			(TimelessSortingMethod.TITLE_REVERSED, [4, 1, 2, 3]),
			(TimelessSortingMethod.DATE_ADDED, [1, 2, 3, 4]),
			(TimelessSortingMethod.DATE_ADDED_REVERSED, [4, 3, 2, 1]),
		]
		self.assertEqual([m for m, _ in expected], list(TimelessSortingMethod))
		for method, ids in expected:
			with self.subTest(method=method):
				self.assertEqual(self._sorted_ids(method), ids)

	def test_sorting_with_colors(self):
		# Sorting by title falls back to color when title and text tie.
		# A mix of None and str colors is then compared, which only works
		# because the earlier key parts already differ.
		rows = [
			{'id': 1, 'title': 'a', 'text': '', 'color': '#bbbbbb', 'time': 1},
			{'id': 2, 'title': 'a', 'text': '', 'color': '#aaaaaa', 'time': 1},
		]
		rows.sort(key=TimelessSortingMethod.TITLE.value[0])
		self.assertEqual([r['id'] for r in rows], [2, 1])


class Test_Security(unittest.TestCase):
	def test_hash_is_deterministic(self):
		salt = b'0' * 32
		self.assertEqual(get_hash(salt, 'password'), get_hash(salt, 'password'))

	def test_hash_depends_on_salt_and_data(self):
		self.assertNotEqual(get_hash(b'a' * 32, 'pw'), get_hash(b'b' * 32, 'pw'))
		self.assertNotEqual(get_hash(b'a' * 32, 'pw'), get_hash(b'a' * 32, 'pW'))

	def test_hash_format(self):
		result = get_hash(b'salt', 'data')
		self.assertIsInstance(result, bytes)
		# urlsafe base64 of a sha256 digest -> 32 bytes -> 44 chars
		self.assertEqual(len(result), 44)
		self.assertEqual(len(urlsafe_b64decode(result)), 32)

	def test_known_vector(self):
		# PBKDF2-HMAC-SHA256, 100_000 iterations. Pinning this guards against
		# accidentally changing the algorithm, which would lock every user out.
		from hashlib import pbkdf2_hmac
		from base64 import urlsafe_b64encode
		expected = urlsafe_b64encode(pbkdf2_hmac('sha256', b'admin', b'NaCl', 100_000))
		self.assertEqual(get_hash(b'NaCl', 'admin'), expected)

	def test_salt_is_random(self):
		salts = {generate_salt_hash('same')[0] for _ in range(5)}
		self.assertEqual(len(salts), 5)
		for salt in salts:
			self.assertEqual(len(salt), 32)

	def test_unicode_password(self):
		salt, hashed = generate_salt_hash('pässwörd🔑')
		self.assertEqual(get_hash(salt, 'pässwörd🔑'), hashed)
		self.assertNotEqual(get_hash(salt, 'passwords'), hashed)


class Test_Logging(unittest.TestCase):
	def setUp(self):
		from backend import logging as mind_logging
		self.mind_logging = mind_logging
		self.logger = mind_logging.LOGGER
		self.original_level = self.logger.level
		# setup_logging() (dictConfig) replaces the handlers of the MIND
		# logger, including the NullHandler that keeps test output quiet.
		self.original_handlers = list(self.logger.handlers)

	def tearDown(self):
		self.logger.setLevel(self.original_level)
		self.logger.handlers = self.original_handlers

	def test_logger_name(self):
		self.assertEqual(self.logger.name, 'MIND')

	def test_info_only_filter(self):
		f = self.mind_logging.InfoOnlyFilter()
		for level, expected in (
			(logging.DEBUG, False), (logging.INFO, True),
			(logging.WARNING, False), (logging.ERROR, False)
		):
			record = logging.LogRecord('MIND', level, __file__, 1, 'msg', None, None)
			self.assertEqual(f.filter(record), expected, level)

	def test_debugging_only_filter_follows_logger_level(self):
		f = self.mind_logging.DebuggingOnlyFilter()
		record = logging.LogRecord('MIND', logging.ERROR, __file__, 1, 'msg', None, None)
		self.logger.setLevel(logging.INFO)
		self.assertFalse(f.filter(record))
		self.logger.setLevel(logging.DEBUG)
		self.assertTrue(f.filter(record))

	def test_error_color_formatter_wraps_in_ansi(self):
		formatter = self.mind_logging.ErrorColorFormatter('%(message)s')
		record = logging.LogRecord('MIND', logging.ERROR, __file__, 1, 'boom', None, None)
		result = formatter.format(record)
		self.assertTrue(result.startswith('\033['))
		self.assertIn('boom', result)
		self.assertTrue(result.endswith('\033[0m'))

	def test_set_log_level_same_level_is_noop(self):
		self.logger.setLevel(logging.INFO)
		with mock.patch.object(self.logger, 'setLevel') as set_level:
			self.mind_logging.set_log_level(logging.INFO)
			set_level.assert_not_called()

	def test_set_log_level_debug_creates_and_clears_file(self):
		import tempfile
		tmp = tempfile.mkdtemp(prefix='mind-log-')
		log_file = os.path.join(tmp, 'MIND_debug.log')
		root = logging.getLogger()
		original_handlers = list(root.handlers)
		try:
			with mock.patch.object(self.mind_logging, 'get_debug_log_filepath', return_value=log_file):
				self.mind_logging.setup_logging()
				self.logger.setLevel(logging.INFO)

				self.mind_logging.set_log_level(logging.DEBUG)
				self.assertTrue(os.path.exists(log_file))
				self.logger.debug('first debug line')
				for handler in root.handlers:
					handler.flush()
				with open(log_file) as f:
					self.assertIn('first debug line', f.read())

				# Going back to INFO and then DEBUG again clears the file
				self.mind_logging.set_log_level(logging.INFO)
				self.mind_logging.set_log_level(logging.DEBUG)
				with open(log_file) as f:
					self.assertEqual(f.read(), '')

				# clear_file=False keeps the content
				self.logger.debug('second debug line')
				for handler in root.handlers:
					handler.flush()
				self.mind_logging.set_log_level(logging.INFO)
				self.mind_logging.set_log_level(logging.DEBUG, clear_file=False)
				with open(log_file) as f:
					self.assertIn('second debug line', f.read())
		finally:
			for handler in root.handlers:
				if handler not in original_handlers:
					stream = getattr(handler, 'stream', None)
					if stream is not None and getattr(stream, 'name', None) == log_file:
						stream.close()
			root.handlers = original_handlers
			import shutil
			shutil.rmtree(tmp, ignore_errors=True)

	def test_logging_config_handlers_match_root(self):
		config = self.mind_logging.LOGGING_CONFIG
		# set_log_level() finds the debug handler by its index in this list
		self.assertIn('debug_file', config['root']['handlers'])
		for handler in config['root']['handlers']:
			self.assertIn(handler, config['handlers'])


if __name__ == '__main__':
	unittest.main()
