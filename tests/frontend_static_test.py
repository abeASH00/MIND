#-*- coding: utf-8 -*-

"""
Static consistency checks between the web-UI (JavaScript + Jinja templates)
and the backend. No browser needed: the JS sources are scanned as text.
"""

import inspect
import os
import re
import unittest

from _harness import MindTestCase, known_bug

import backend.custom_exceptions as ce
from backend.helpers import folder_path

JS_DIR = folder_path('frontend', 'static', 'js')
TEMPLATE_DIR = folder_path('frontend', 'templates')


def read(path):
	with open(path, encoding='utf-8') as f:
		return f.read()


def js_sources():
	return {
		name: read(os.path.join(JS_DIR, name))
		for name in sorted(os.listdir(JS_DIR))
		if name.endswith('.js')
	}


def backend_error_names():
	names = {'Bad request', 'Method not allowed', 'Internal error', 'Not Found'}
	for _, cls in inspect.getmembers(ce, inspect.isclass):
		if cls.__module__ != ce.__name__ or cls is ce.CustomException:
			continue
		for args in ((), ('1',), ('1', '2')):
			try:
				names.add(cls(*args).api_response['error'])
				break
			except TypeError:
				continue
	return names


class Test_ErrorNames(unittest.TestCase):
	# Matches: e.error === 'X', e === "X", ['X', 'Y'].includes(json.error)
	COMPARISON = re.compile(
		r"""(?:error|\be)\s*===?\s*['"]([A-Za-z]+)['"]"""
	)
	INCLUDES = re.compile(r"""\[([^\]]*)\]\s*\.includes\(\s*\w+\.error\s*\)""")

	def referenced_names(self):
		found = []
		for name, source in js_sources().items():
			for match in self.COMPARISON.finditer(source):
				found.append((name, match.group(1)))
			for match in self.INCLUDES.finditer(source):
				for literal in re.findall(r"""['"]([A-Za-z]+)['"]""", match.group(1)):
					found.append((name, literal))
		return found

	def test_scanner_finds_references(self):
		names = {n for _, n in self.referenced_names()}
		self.assertIn('UsernameTaken', names)
		self.assertIn('NotificationServiceInUse', names)

	@known_bug('BUG-11')
	def test_frontend_only_checks_for_existing_errors(self):
		known = backend_error_names()
		unknown = sorted({
			(file, name) for file, name in self.referenced_names()
			if name not in known
		})
		self.assertEqual(unknown, [])

	def test_backend_error_names(self):
		names = backend_error_names()
		self.assertIn('APIKeyInvalid', names)
		self.assertIn('APIKeyExpired', names)
		self.assertNotIn('ApiKeyInvalid', names)


class Test_ApiUrls(MindTestCase):
	SETUP_DB = False

	URL = re.compile(r"`\$\{url_prefix\}(/api/[^`?]*)")

	def test_every_fetched_endpoint_exists(self):
		adapter = self.app.url_map.bind('localhost')
		checked = 0
		for name, source in js_sources().items():
			for match in self.URL.finditer(source):
				raw = match.group(1)
				path = re.sub(r'\$\{[^}]+\}', '1', raw)
				with self.subTest(file=name, url=raw):
					try:
						adapter.match(path, method='GET')
					except Exception as e:
						# MethodNotAllowed still means the path exists
						self.assertEqual(type(e).__name__, 'MethodNotAllowed', f'{raw} -> {e!r}')
					checked += 1
		self.assertGreater(checked, 25)

	@known_bug('BUG-12')
	def test_search_query_is_url_encoded(self):
		source = read(os.path.join(JS_DIR, 'library.js'))
		self.assertRegex(source, r'query=\$\{encodeURIComponent\(query\)\}')


class Test_Templates(unittest.TestCase):
	def templates(self):
		return {
			name: read(os.path.join(TEMPLATE_DIR, name))
			for name in os.listdir(TEMPLATE_DIR)
			if name.endswith('.html')
		}

	def test_static_references_exist(self):
		for name, source in self.templates().items():
			for ref in re.findall(r"url_for\('static', filename='([^']+)'\)", source):
				with self.subTest(template=name, file=ref):
					self.assertTrue(
						os.path.isfile(folder_path('frontend', 'static', *ref.split('/'))),
						ref
					)

	def test_url_prefix_meta(self):
		# general.js / login.js read the URL prefix from this element
		for name, source in self.templates().items():
			if 'page_not_found' in name:
				continue
			with self.subTest(template=name):
				self.assertIn('id="url_prefix" data-value="{{url_prefix}}"', source)

	def test_script_order(self):
		# general.js defines helpers (url_prefix, api_key, Types, ...) that
		# every other script on the reminders page relies on.
		source = self.templates()['reminders.html']
		scripts = re.findall(r"filename='js/([a-z_]+)\.js'", source)
		self.assertEqual(scripts[0], 'general')
		self.assertEqual(
			set(scripts),
			{'general', 'library', 'window', 'templates', 'show', 'notification', 'settings'}
		)

	def test_all_js_files_are_used(self):
		used = set()
		for source in self.templates().values():
			used.update(re.findall(r"filename='js/([a-z_]+\.js)'", source))
		self.assertEqual(used, set(js_sources()))


if __name__ == '__main__':
	unittest.main()
