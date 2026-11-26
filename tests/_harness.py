#-*- coding: utf-8 -*-

"""
Shared test harness for the MIND test-suite.

This module contains no tests itself. It provides:

- `MindTestCase`: a `unittest.TestCase` base class that gives every test an
  isolated, throw-away SQLite database, a freshly created Flask app, a fresh
  `ReminderHandler` singleton, a Flask test client and an empty API key map.
  Nothing outside of a temporary directory is touched: the PWA manifest
  writer, server restarts/shutdowns and Apprise are all patched out.

- `FakeApprise` + `RECORDER`: a drop-in replacement for `apprise.Apprise` that
  records every "sent" notification instead of sending it.

- Time helpers (`mind_now`, `future`, `frozen_datetime`) that follow MIND's
  own definition of "now" (see `docs/other_docs/codebase_atlas.md`, section
  "The time model").
"""

import logging
import os
import shutil
import tempfile
import threading
import unittest
import warnings
from contextlib import contextmanager
from datetime import datetime, timezone
from threading import current_thread
from typing import Any, Dict, Iterator, List, Optional, Tuple, Type
from unittest import TestCase, mock

from apprise import Apprise as RealApprise

from backend.db import DB_Singleton, DBConnection, setup_db
from backend.helpers import Singleton
from backend.reminders import ReminderHandler
from backend.server import SERVER

# Keep the test output clean: MIND logs warnings for every rejected input.
# A NullHandler on the MIND logger stops Python's "last resort" handler from
# printing them to stderr.
logging.getLogger('MIND').addHandler(logging.NullHandler())

DEFAULT_URL = 'json://localhost'
OTHER_URL = 'json://example.com'


def known_bug(bug_id: str, when: bool = True):
	"""Mark a test that reproduces a documented, not yet fixed, bug.

	The test describes the *correct* behaviour and is expected to fail until
	the bug is fixed. Once fixed, the test passes, unittest reports an
	"unexpected success" (which fails the run) and the marker must be removed.

	`when` limits the expectation to environments where the bug shows up
	(e.g. a specific Python/SQLite combination). Elsewhere the test is a
	normal test that must pass.

	Bug IDs refer to the "Known bugs" section of
	`docs/other_docs/codebase_atlas.md`.
	"""
	def decorator(func):
		func.__known_bug__ = bug_id
		if not when:
			return func
		return unittest.expectedFailure(func)
	return decorator


def _wal_survives_close() -> bool:
	"""Whether this Python's sqlite3 module defers closing a connection
	(and so the final WAL checkpoint) while a cursor still has an unfinished
	statement. True on Python 3.11. Relevant to BUG-16."""
	import sqlite3
	directory = tempfile.mkdtemp(prefix='mind-probe-')
	path = os.path.join(directory, 'probe.db')
	try:
		con = sqlite3.connect(path)
		con.execute('PRAGMA journal_mode = wal;')
		con.execute('CREATE TABLE t(k PRIMARY KEY, v);')
		con.commit()
		con.close()
		cursor = sqlite3.connect(path).cursor()
		cursor.execute('SELECT 1 FROM sqlite_master LIMIT 1;').fetchone()
		cursor.executemany('INSERT INTO t VALUES (?, ?);', [(1, 2)])
		cursor.connection.commit()
		cursor.connection.close()
		return os.path.exists(path + '-wal')
	finally:
		shutil.rmtree(directory, ignore_errors=True)


WAL_SURVIVES_CLOSE = _wal_survives_close()


#=====================
# Notification capture
#=====================
class NotificationRecorder:
	"""Thread-safe store of all notifications that MIND 'sent'."""

	def __init__(self) -> None:
		self.lock = threading.Lock()
		self.sent: List[Dict[str, Any]] = []

	def record(self, title: str, body: str, urls: List[str]) -> None:
		with self.lock:
			self.sent.append({'title': title, 'body': body, 'urls': urls})

	def reset(self) -> None:
		with self.lock:
			self.sent.clear()

	def titles(self) -> List[str]:
		with self.lock:
			return [s['title'] for s in self.sent]


RECORDER = NotificationRecorder()


class FakeApprise:
	"""Stand-in for `apprise.Apprise` that records instead of sends."""

	def __init__(self, *args, **kwargs) -> None:
		self.urls: List[str] = []

	def add(self, url: str, *args, **kwargs) -> bool:
		self.urls.append(url)
		return True

	def notify(self, title: str = '', body: str = '', *args, **kwargs) -> bool:
		RECORDER.record(title, body, list(self.urls))
		return True

	def details(self, *args, **kwargs) -> dict:
		# `get_apprise_services()` only needs the static schema details, which
		# do not touch the network. Delegate to the real implementation.
		return RealApprise().details(*args, **kwargs)


#=====================
# Time helpers
#=====================
def mind_now() -> float:
	"""MIND's definition of "now": `datetime.utcnow().timestamp()`.

	That is the *UTC wall clock*, interpreted as a *local* time and converted
	to an epoch. On a server whose timezone is UTC, this equals `time.time()`.
	Written without the deprecated `utcnow()`.
	"""
	return datetime.now(timezone.utc).replace(tzinfo=None).timestamp()


def future(seconds: float = 86400) -> int:
	"""A MIND timestamp `seconds` in the future."""
	return int(mind_now() + seconds)


def local_ts(*args) -> int:
	"""Epoch of a naive *local* datetime, the way MIND computes them."""
	return int(datetime(*args).timestamp())


def frozen_datetime(now: datetime) -> Type[datetime]:
	"""Build a `datetime` subclass whose `utcnow()` always returns `now`.

	Use with `mock.patch('backend.reminders.datetime', frozen_datetime(...))`
	to make the repeat/weekday calculations deterministic.
	"""
	class FrozenDatetime(datetime):
		@classmethod
		def utcnow(cls):
			return cls(
				now.year, now.month, now.day,
				now.hour, now.minute, now.second, now.microsecond
			)

	return FrozenDatetime


class MindClock:
	"""A controllable clock for `backend.reminders`.

	`clock.datetime` is a `datetime` subclass whose `utcnow()` returns the
	clock's current time, expressed so that `utcnow().timestamp() == clock.ts`
	(i.e. `clock.ts` is "now" in MIND's time frame). Patch it in with
	`mock.patch('backend.reminders.datetime', clock.datetime)` and move time
	with `clock.ts = ...` or `clock.advance(seconds)`.
	"""

	def __init__(self, ts: float) -> None:
		self.ts = ts
		clock = self

		class ClockDatetime(datetime):
			@classmethod
			def utcnow(cls):
				d = datetime.fromtimestamp(clock.ts)
				return cls(
					d.year, d.month, d.day,
					d.hour, d.minute, d.second, d.microsecond
				)

		self.datetime = ClockDatetime

	def advance(self, seconds: float) -> float:
		self.ts += seconds
		return self.ts


class FakeTimer:
	"""Stand-in for `threading.Timer` that never runs on its own.

	Patch it in with `mock.patch('backend.reminders.Timer', FakeTimer)` and
	call `.fire()` to run the scheduled function synchronously.
	"""

	#: Every FakeTimer ever created (reset it in setUp).
	instances: List['FakeTimer'] = []

	def __init__(self, interval, function, args=None, kwargs=None) -> None:
		FakeTimer.instances.append(self)
		self.interval = interval
		self.function = function
		self.args = tuple(args or ())
		self.kwargs = dict(kwargs or {})
		self.name = ''
		self.started = False
		self.cancelled = False
		self.fired = False

	def start(self) -> None:
		self.started = True

	def cancel(self) -> None:
		self.cancelled = True

	def is_alive(self) -> bool:
		return self.started and not (self.cancelled or self.fired)

	@classmethod
	def live(cls) -> List['FakeTimer']:
		"""Timers that were started and will still fire."""
		return [t for t in cls.instances if t.is_alive()]

	def join(self, timeout=None) -> None:
		return

	def fire(self) -> None:
		"""Run the scheduled function now, in a separate thread like a real
		`Timer` would (MIND behaves differently on the main thread: there
		`close_db()` closes the connection). Blocks until done and re-raises
		any exception from the thread."""
		self.fired = True
		error: List[BaseException] = []

		def run():
			try:
				self.function(*self.args, **self.kwargs)
			except BaseException as e:
				error.append(e)
			finally:
				close_thread_connection()

		thread = threading.Thread(target=run, name='FakeTimer')
		thread.start()
		thread.join()
		if error:
			raise error[0]


#=====================
# DB helpers
#=====================
def close_thread_connection() -> None:
	"""Close the cached `DBConnection` of the current thread, if any, so the
	next `get_db()` opens `DBConnection.file` afresh."""
	key = f'{DBConnection}{current_thread()}'
	instance = DB_Singleton._instances.get(key)
	if instance is not None and not instance.closed:
		try:
			instance.commit()
		except Exception:
			pass
		instance.close()
	DB_Singleton._instances.pop(key, None)


class _ListHandler(logging.Handler):
	"""Logging handler that appends records to a list."""

	def __init__(self, target: List[logging.LogRecord]) -> None:
		super().__init__(logging.ERROR)
		self.target = target

	def emit(self, record: logging.LogRecord) -> None:
		self.target.append(record)


#=====================
# Base test case
#=====================
class MindTestCase(TestCase):
	"""Base class: isolated database + app + client per test."""

	#: Set to False in a subclass to get an app without a set up database.
	SETUP_DB = True

	def setUp(self) -> None:
		super().setUp()
		RECORDER.reset()

		# MIND itself uses the deprecated `datetime.utcnow()` everywhere.
		# That is a known, documented quirk; don't flood the test output.
		warnings.filterwarnings(
			'ignore',
			message=r'datetime\.datetime\.utc(now|fromtimestamp)',
			category=DeprecationWarning
		)

		self.tmp_dir = tempfile.mkdtemp(prefix='mind-test-')
		self.addCleanup(shutil.rmtree, self.tmp_dir, True)

		close_thread_connection()
		self._original_db_file = DBConnection.file
		DBConnection.file = os.path.join(self.tmp_dir, 'MIND.db')
		self.addCleanup(self._restore_db_file)

		# Patches: nothing may leave the temp dir or the process
		self.manifest_mock = self._patch('backend.settings.update_manifest')
		self.restart_mock = self._patch_object(SERVER, 'restart')
		self.shutdown_mock = self._patch_object(SERVER, 'shutdown')
		for module in (
			'backend.reminders',
			'backend.static_reminders',
			'backend.notification_service'
		):
			self._patch(f'{module}.Apprise', FakeApprise)

		# Fresh app and reminder handler
		SERVER.url_prefix = ''
		SERVER.create_app()
		self.app = SERVER.app
		# Behave like production: unhandled exceptions become MIND's JSON
		# 500 response instead of propagating into the test. The traceback
		# is captured in `self.server_errors` instead of printed.
		self.app.config['PROPAGATE_EXCEPTIONS'] = False
		self.server_errors: List[logging.LogRecord] = []
		capture = _ListHandler(self.server_errors)
		self.app.logger.addHandler(capture)
		self.app.logger.propagate = False
		from flask.logging import default_handler
		self.app.logger.removeHandler(default_handler)

		Singleton._instances.pop(str(ReminderHandler), None)
		self.handler = ReminderHandler(self.app.app_context)
		self.addCleanup(self._stop_handler)

		from frontend.api import api_key_map
		self.api_key_map = api_key_map
		api_key_map.clear()
		self.addCleanup(api_key_map.clear)

		self.client = self.app.test_client()

		if self.SETUP_DB:
			with self.ctx():
				setup_db()

		return

	#---------------------
	# Internals
	#---------------------
	def _patch(self, target: str, new: Any = mock.DEFAULT) -> Any:
		patcher = mock.patch(target, new)
		result = patcher.start()
		self.addCleanup(patcher.stop)
		return result

	def _patch_object(self, target: Any, attribute: str) -> Any:
		patcher = mock.patch.object(target, attribute)
		result = patcher.start()
		self.addCleanup(patcher.stop)
		return result

	def _stop_handler(self) -> None:
		self.handler.stop_handling()
		thread = self.handler.thread
		if thread is not None and thread.is_alive() and thread is not current_thread():
			thread.join(timeout=5)
		Singleton._instances.pop(str(ReminderHandler), None)

	def _restore_db_file(self) -> None:
		close_thread_connection()
		# Connections cached for other (timer) threads point at this test's
		# temp database. Thread idents get reused by the OS, so a later test's
		# thread could otherwise pick up a connection to a deleted file.
		# They can't be closed from this thread; drop them instead.
		DB_Singleton._instances.clear()
		DBConnection.file = self._original_db_file

	#---------------------
	# Context helpers
	#---------------------
	@contextmanager
	def ctx(self) -> Iterator[None]:
		"""An app context. On exit the DB is committed (`close_db`)."""
		with self.app.app_context():
			yield

	def sql(self, query: str, params: tuple = ()) -> List[tuple]:
		"""Run raw SQL on the test database in a fresh context."""
		from backend.db import get_db
		with self.ctx():
			return list(get_db().execute(query, params))

	#---------------------
	# API helpers
	#---------------------
	def api(
		self,
		method: str,
		path: str,
		key: Optional[str] = None,
		json: Any = None,
		query: Optional[Dict[str, Any]] = None,
		**kwargs
	) -> Tuple[int, Any]:
		"""Do an API request. Returns (status_code, parsed JSON or raw bytes)."""
		params = dict(query or {})
		if key is not None:
			params['api_key'] = key
		response = self.client.open(
			'/api' + path,
			method=method,
			json=json,
			query_string=params,
			**kwargs
		)
		body = response.get_json(silent=True)
		if body is None:
			body = response.data
		response.close()
		return response.status_code, body

	def login(self, username: str, password: str) -> str:
		code, body = self.api(
			'POST', '/auth/login',
			json={'username': username, 'password': password}
		)
		self.assertEqual(code, 201, body)
		return body['result']['api_key']

	def admin_key(self) -> str:
		return self.login('admin', 'admin')

	def create_user(self, username: str, password: str = 'password') -> int:
		from backend.users import Users
		with self.ctx():
			return Users().add(username, password, True)

	def user_key(self, username: str = 'user', password: str = 'password') -> str:
		self.create_user(username, password)
		return self.login(username, password)

	def add_service(
		self,
		key: str,
		title: str = 'Service',
		url: str = DEFAULT_URL
	) -> int:
		code, body = self.api(
			'POST', '/notificationservices', key,
			json={'title': title, 'url': url}
		)
		self.assertEqual(code, 201, body)
		return body['result']['id']

	def add_reminder(self, key: str, services: List[int], **fields) -> dict:
		data = {
			'title': 'Reminder',
			'time': future(),
			'notification_services': services,
			**fields
		}
		code, body = self.api('POST', '/reminders', key, json=data)
		self.assertEqual(code, 201, body)
		return body['result']

	def assertInternalError(self, response: Tuple[int, Any]) -> None:
		"""The request crashed: MIND answered with its generic 500."""
		status, body = response
		self.assertEqual(status, 500, body)
		self.assertEqual(body, {'error': 'Internal error', 'result': {}})
		self.assertTrue(self.server_errors, 'Expected a captured server error')

	def assertApiError(
		self,
		response: Tuple[int, Any],
		error: str,
		code: Optional[int] = None
	) -> None:
		status, body = response
		self.assertIsInstance(body, dict, f'Not a JSON body: {body!r}')
		self.assertEqual(body['error'], error, body)
		if code is not None:
			self.assertEqual(status, code, body)
