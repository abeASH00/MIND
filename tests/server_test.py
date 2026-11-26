#-*- coding: utf-8 -*-

"""
Tests for `backend.server`: restarting (flags, timers, re-executing the
interpreter) and the Flask app setup.
"""

import os
import sys
import unittest
from unittest import mock

from _harness import MindTestCase

from backend import server as server_module
from backend.helpers import RestartVars, folder_path
from backend.server import SERVER, Server, handle_flags, handle_flags_pre_restart


class Test_Restart(MindTestCase):
	def setUp(self):
		super().setUp()
		state = (SERVER.do_restart, SERVER.restart_args, SERVER.handle_flags)
		def restore():
			SERVER.do_restart, SERVER.restart_args, SERVER.handle_flags = state
		self.addCleanup(restore)

	def test_restart_sets_state_and_shuts_down(self):
		# SERVER.restart is mocked by the harness; call the real method
		Server.restart(SERVER, [RestartVars.HOST_CHANGE.value], handle_flags=True)
		self.assertTrue(SERVER.do_restart)
		self.assertEqual(SERVER.restart_args, ['host_change'])
		self.assertTrue(SERVER.handle_flags)
		self.shutdown_mock.assert_called_once_with()

	def test_handle_restart_reexecutes_same_interpreter(self):
		# BUG-17: executing MIND.py directly fails without its executable
		# bit (it isn't set in the repository)
		SERVER.handle_flags = False
		SERVER.restart_args = ['db_import']
		with mock.patch.object(server_module, 'execv') as execv:
			SERVER.handle_restart(None)
		mind_file = folder_path('MIND.py')
		execv.assert_called_once_with(
			sys.executable, [sys.executable, mind_file, 'db_import']
		)
		self.assertTrue(os.path.isfile(mind_file))

	def test_handle_restart_runs_flag_actions_first(self):
		SERVER.handle_flags = True
		SERVER.restart_args = []
		calls = []
		with mock.patch.object(server_module, 'execv', side_effect=lambda *a: calls.append('execv')), \
		mock.patch.object(server_module, 'handle_flags_pre_restart', side_effect=lambda f: calls.append(('pre', f))):
			SERVER.handle_restart('db_import')
		self.assertEqual(calls, [('pre', 'db_import'), 'execv'])

	def test_handle_restart_skips_flag_actions_by_default(self):
		SERVER.handle_flags = False
		with mock.patch.object(server_module, 'execv'), \
		mock.patch.object(server_module, 'handle_flags_pre_restart') as pre:
			SERVER.handle_restart('db_import')
		pre.assert_not_called()


class Test_Flags(MindTestCase):
	def test_db_import_flag_starts_revert_timer(self):
		with mock.patch.object(SERVER, 'revert_db_timer') as db_timer, \
		mock.patch.object(SERVER, 'revert_hosting_timer') as host_timer:
			handle_flags('db_import')
		db_timer.start.assert_called_once_with()
		host_timer.start.assert_not_called()

	def test_host_change_flag_starts_revert_timer(self):
		with mock.patch.object(SERVER, 'revert_db_timer') as db_timer, \
		mock.patch.object(SERVER, 'revert_hosting_timer') as host_timer:
			handle_flags('host_change')
		host_timer.start.assert_called_once_with()
		db_timer.start.assert_not_called()

	def test_no_or_unknown_flag(self):
		for flag in (None, 'something'):
			with mock.patch.object(SERVER, 'revert_db_timer') as db_timer, \
			mock.patch.object(SERVER, 'revert_hosting_timer') as host_timer:
				handle_flags(flag)
			db_timer.start.assert_not_called()
			host_timer.start.assert_not_called()

	def test_revert_timers_wait_a_minute(self):
		self.assertEqual(SERVER.revert_db_timer.interval, 60.0)
		self.assertEqual(SERVER.revert_hosting_timer.interval, 60.0)

	def test_pre_restart_db_import_reverts(self):
		with mock.patch.object(server_module, 'revert_db_import') as revert:
			handle_flags_pre_restart('db_import')
		revert.assert_called_once_with(swap=True)

	def test_pre_restart_host_change_restores_hosting(self):
		with mock.patch.object(server_module, 'restore_hosting_settings') as restore:
			handle_flags_pre_restart('host_change')
		restore.assert_called_once_with()

	def test_pre_restart_nothing_for_other_flags(self):
		with mock.patch.object(server_module, 'revert_db_import') as revert, \
		mock.patch.object(server_module, 'restore_hosting_settings') as restore:
			handle_flags_pre_restart(None)
		revert.assert_not_called()
		restore.assert_not_called()


class Test_App(MindTestCase):
	SETUP_DB = False

	def test_blueprints(self):
		self.assertEqual(set(self.app.blueprints), {'ui', 'api', 'admin_api'})

	def test_error_handlers(self):
		self.assertTrue({400, 404, 405, 500} <= set(self.app.error_handler_spec[None]))

	def test_secret_key_is_random_per_app(self):
		first = self.app.config['SECRET_KEY']
		SERVER.create_app()
		self.assertNotEqual(first, SERVER.app.config['SECRET_KEY'])
		self.assertEqual(len(first), 32)

	def test_server_is_a_singleton(self):
		self.assertIs(Server(), SERVER)


if __name__ == '__main__':
	unittest.main()
