#-*- coding: utf-8 -*-

"""
Tests for `backend.notification_service`: managing services, the "in use"
protection, deleting services together with what uses them, and the
Apprise service catalogue that the web-UI uses to build URLs.
"""

import re
import unittest
from unittest import mock

from _harness import DEFAULT_URL, OTHER_URL, RECORDER, MindTestCase, future

from backend.custom_exceptions import (NotificationServiceInUse,
                                       NotificationServiceNotFound)
from backend.notification_service import (NotificationService,
                                          NotificationServices, _sort_tokens,
                                          get_apprise_services, process_regex)
from backend.users import Users


class Test_ProcessRegex(unittest.TestCase):
	def test_none(self):
		self.assertIsNone(process_regex(None))

	def test_removes_named_groups(self):
		# JavaScript (pre-ES2018 browsers) can't handle Python's (?P<name>...)
		self.assertEqual(
			process_regex(['^(?P<user>[a-z]+)@(?P<host>[a-z.]+)$', 'i']),
			['^([a-z]+)@([a-z.]+)$', 'i']
		)

	def test_keeps_other_groups(self):
		self.assertEqual(
			process_regex(['^(?:a|b)(c)(?=d)$', '']),
			['^(?:a|b)(c)(?=d)$', '']
		)

	def test_result_is_valid_regex(self):
		pattern, _ = process_regex(['^(?P<id>[0-9]{3,})$', 'i'])
		self.assertTrue(re.match(pattern, '1234'))


class Test_SortTokens(unittest.TestCase):
	def test_order(self):
		tokens = [
			{'name': 'opt list', 'required': False, 'type': 'list'},
			{'name': 'req string', 'required': True, 'type': 'string'},
			{'name': 'opt choice', 'required': False, 'type': 'choice'},
			{'name': 'req list', 'required': True, 'type': 'list'},
			{'name': 'req choice', 'required': True, 'type': 'choice'},
			{'name': 'opt int', 'required': False, 'type': 'int'},
		]
		tokens.sort(key=_sort_tokens)
		self.assertEqual(
			[t['name'] for t in tokens],
			['req choice', 'req string', 'req list',
			'opt choice', 'opt int', 'opt list']
		)


class Test_AppriseServices(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		cls.services = get_apprise_services()

	def test_custom_url_first(self):
		first = self.services[0]
		self.assertEqual(first['name'], 'Custom URL')
		self.assertEqual(first['details']['templates'], ['{url}'])
		self.assertEqual(first['details']['tokens'][0]['map_to'], 'url')

	def test_sorted_case_insensitively(self):
		names = [s['name'] for s in self.services[1:]]
		self.assertEqual(names, sorted(names, key=str.lower))

	def test_many_services(self):
		self.assertGreater(len(self.services), 50)

	def test_json_serialisable(self):
		# BUG-15: newer Apprise versions use frozensets for some values
		import json
		json.dumps(self.services)

	def test_structure(self):
		for service in self.services:
			with self.subTest(service=service['name']):
				self.assertEqual(set(service), {'name', 'doc_url', 'details'})
				self.assertIsInstance(service['name'], str)
				details = service['details']
				self.assertEqual(set(details), {'templates', 'tokens', 'args'})
				self.assertTrue(details['templates'])
				for token in details['tokens'] + details['args']:
					self.assertIn(token['type'], ('choice', 'list', 'string', 'int', 'bool', 'float'))
					self.assertIn('map_to', token)
					self.assertIsInstance(token['required'], bool)
					if token['type'] == 'choice':
						self.assertIn('options', token)
					if token['type'] == 'list':
						self.assertIn('delim', token)
						self.assertIn('content', token)

	def test_tokens_sorted(self):
		for service in self.services:
			with self.subTest(service=service['name']):
				keys = [_sort_tokens(t) for t in service['details']['tokens']]
				self.assertEqual(keys, sorted(keys))

	def test_first_token_is_schema_choice(self):
		for service in self.services[1:]:
			with self.subTest(service=service['name']):
				schema = [t for t in service['details']['tokens'] if t['map_to'] == 'schema']
				self.assertEqual(len(schema), 1)
				self.assertEqual(schema[0]['type'], 'choice')
				self.assertTrue(schema[0]['options'])

	def test_internal_args_hidden(self):
		hidden = {'cto', 'format', 'overflow', 'rto', 'verify'}
		for service in self.services:
			for arg in service['details']['args']:
				self.assertNotIn(arg['map_to'], hidden)

	def test_regexes_have_no_named_groups(self):
		for service in self.services:
			for token in service['details']['tokens'] + service['details']['args']:
				for item in [token] + token.get('content', []):
					if item.get('regex'):
						self.assertNotIn('?P<', item['regex'][0])

	def test_every_service_has_a_fillable_template(self):
		# The web-UI fills templates with values keyed by the tokens'
		# `map_to`. A template whose placeholders aren't all tokens can't be
		# built from the UI. A few exist: tokens that Apprise groups into a
		# list (e.g. ntfy's `{schema}://{topic}`: `topic` is folded into the
		# `targets` list). Every service must keep at least one usable one.
		for service in self.services[1:]:
			with self.subTest(service=service['name']):
				names = {t['map_to'] for t in service['details']['tokens']}
				fillable = [
					template
					for template in service['details']['templates']
					if set(re.findall(r'{(\w+)}', template)) <= names
				]
				self.assertTrue(fillable, service['details']['templates'])


class Test_AppriseServicesSerialisation(unittest.TestCase):
	"""The catalogue is sent to the browser as JSON."""

	FAKE_DETAILS = {
		'schemas': [{
			'service_name': 'Fake',
			'setup_url': 'https://example.com',
			'details': {
				'templates': ('{schema}://{host}',),
				'tokens': {
					'schema': {
						'name': 'Schema', 'type': 'choice:string',
						'required': True, 'values': ('fake',)
					},
					'host': {'name': 'Host', 'type': 'string', 'required': True},
				},
				'args': {
					# Newer Apprise versions (e.g. 1.13, allowed by
					# requirements.txt) use frozensets for choice values
					'mode': {
						'name': 'Mode', 'type': 'choice:string',
						'values': frozenset({'a', 'b'}), 'default': 'a'
					},
				},
			},
		}]
	}

	def test_frozenset_choices_are_serialisable(self):
		import json
		with mock.patch('backend.notification_service.Apprise') as apprise:
			apprise.return_value.details.return_value = self.FAKE_DETAILS
			services = get_apprise_services()
		json.dumps(services)
		mode = services[1]['details']['args'][0]
		self.assertEqual(sorted(mode['options']), ['a', 'b'])


class ServicesTestCase(MindTestCase):
	def setUp(self):
		super().setUp()
		self.alice_id = self.create_user('alice')
		self.bob_id = self.create_user('bob')

	def services(self, user_id=None) -> NotificationServices:
		return NotificationServices(user_id or self.alice_id)


class Test_NotificationServices(ServicesTestCase):
	def test_add_and_get(self):
		with self.ctx():
			service = self.services().add('Phone', DEFAULT_URL)
			self.assertIsInstance(service, NotificationService)
			self.assertEqual(service.get(), {'id': 1, 'title': 'Phone', 'url': DEFAULT_URL})

	def test_fetchall_sorted_by_title_then_id(self):
		with self.ctx():
			s = self.services()
			s.add('b', DEFAULT_URL)
			s.add('a', DEFAULT_URL)
			s.add('a', OTHER_URL)
			NotificationServices(self.bob_id).add('bob', DEFAULT_URL)
			self.assertEqual(
				[(x['id'], x['title']) for x in s.fetchall()],
				[(2, 'a'), (3, 'a'), (1, 'b')]
			)

	def test_fetchone_scoped(self):
		with self.ctx():
			bob_service = NotificationServices(self.bob_id).add('bob', DEFAULT_URL).id
			with self.assertRaises(NotificationServiceNotFound):
				self.services().fetchone(bob_service)
			with self.assertRaises(NotificationServiceNotFound):
				self.services().fetchone(999)

	def test_update(self):
		with self.ctx():
			service = self.services().add('Phone', DEFAULT_URL)
			self.assertEqual(
				service.update(title='Mobile'),
				{'id': service.id, 'title': 'Mobile', 'url': DEFAULT_URL}
			)
			self.assertEqual(
				service.update(url=OTHER_URL),
				{'id': service.id, 'title': 'Mobile', 'url': OTHER_URL}
			)
			self.assertEqual(service.update(), service.get())

	def test_delete_unused(self):
		with self.ctx():
			service = self.services().add('Phone', DEFAULT_URL)
			service.delete()
			self.assertEqual(self.services().fetchall(), [])

	def test_test_service(self):
		with self.ctx():
			self.services().test_service(DEFAULT_URL)
		self.assertEqual(RECORDER.sent, [{
			'title': 'MIND: Test title',
			'body': 'MIND: Test body',
			'urls': [DEFAULT_URL]
		}])


class Test_ServiceInUse(ServicesTestCase):
	def setUp(self):
		super().setUp()
		with self.ctx():
			user = Users().get_one(self.alice_id)
			self.user = user
			self.used = user.notification_services.add('Used', DEFAULT_URL).id
			self.spare = user.notification_services.add('Spare', OTHER_URL).id

	def in_use_type(self):
		with self.ctx():
			with self.assertRaises(NotificationServiceInUse) as cm:
				self.services().fetchone(self.used).delete()
		return cm.exception

	def test_in_use_by_reminder(self):
		with self.ctx():
			self.user.reminders.add('r', future(), [self.used])
		error = self.in_use_type()
		self.assertEqual(error.type, 'reminder')
		self.assertEqual(error.api_response, {
			'error': 'NotificationServiceInUse',
			'result': {'type': 'reminder'},
			'code': 400
		})

	def test_in_use_by_template(self):
		with self.ctx():
			self.user.templates.add('t', [self.used])
		self.assertEqual(self.in_use_type().type, 'template')

	def test_in_use_by_static_reminder(self):
		with self.ctx():
			self.user.static_reminders.add('s', [self.used])
		self.assertEqual(self.in_use_type().type, 'static reminder')

	def test_reminder_is_reported_first(self):
		with self.ctx():
			self.user.static_reminders.add('s', [self.used])
			self.user.templates.add('t', [self.used])
			self.user.reminders.add('r', future(), [self.used])
		self.assertEqual(self.in_use_type().type, 'reminder')

	def test_failed_delete_keeps_service(self):
		with self.ctx():
			self.user.reminders.add('r', future(), [self.used])
		self.in_use_type()
		with self.ctx():
			self.services().fetchone(self.used)

	def test_delete_with_reminders_using(self):
		with self.ctx():
			r_used = self.user.reminders.add('used', future(), [self.used]).id
			r_spare = self.user.reminders.add('spare', future(), [self.spare]).id
			self.user.templates.add('t used', [self.used])
			self.user.templates.add('t spare', [self.spare])
			self.user.static_reminders.add('s used', [self.used])
		with self.ctx():
			self.services().fetchone(self.used).delete(delete_reminders_using=True)
		with self.ctx():
			self.assertEqual([s['title'] for s in self.services().fetchall()], ['Spare'])
			self.assertEqual([r['id'] for r in self.user.reminders.fetchall()], [r_spare])
			self.assertEqual([t['title'] for t in self.user.templates.fetchall()], ['t spare'])
			self.assertEqual(self.user.static_reminders.fetchall(), [])
		self.assertNotIn(r_used, [r[0] for r in self.sql("SELECT id FROM reminders;")])

	def test_delete_with_reminders_using_removes_multi_service_entries(self):
		# An entry that uses the deleted service AND another service is
		# deleted entirely, not just unlinked.
		with self.ctx():
			self.user.reminders.add('both', future(), [self.used, self.spare])
		with self.ctx():
			self.services().fetchone(self.used).delete(delete_reminders_using=True)
		with self.ctx():
			self.assertEqual(self.user.reminders.fetchall(), [])

	def test_delete_with_reminders_using_reschedules(self):
		soon = future(120)
		with self.ctx():
			self.user.reminders.add('soon', soon, [self.used])
			self.user.reminders.add('later', future(600), [self.spare])
		self.assertEqual(self.handler.time, soon)
		with self.ctx():
			self.services().fetchone(self.used).delete(delete_reminders_using=True)
		# The reminder the scheduler waited for is gone: it moves on
		later = self.sql("SELECT time FROM reminders;")[0][0]
		self.assertEqual(self.handler.time, later)


if __name__ == '__main__':
	unittest.main()
