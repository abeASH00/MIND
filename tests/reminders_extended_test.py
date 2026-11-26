#-*- coding: utf-8 -*-

"""
Tests for `backend.reminders`: the repeat/weekday time calculations, the
reminder library and the `ReminderHandler` scheduler.

Scheduler tests run on a controllable clock (`MindClock`) and a fake
`threading.Timer` (`FakeTimer`) so they are deterministic and instant. A few
end-to-end tests at the bottom use real threads and real time.
"""

import os
import time
import unittest
from datetime import datetime
from unittest import mock

from _harness import (DEFAULT_URL, OTHER_URL, RECORDER, FakeTimer, MindClock,
                      MindTestCase, frozen_datetime, future, known_bug,
                      local_ts, mind_now)

from backend.custom_exceptions import (InvalidKeyValue, InvalidTime,
                                       NotificationServiceNotFound,
                                       ReminderNotFound)
from backend.helpers import RepeatQuantity, SortingMethod
from backend.reminders import Reminder, Reminders, _find_next_time
from backend.users import Users

DAYS = RepeatQuantity.DAYS
WEEKS = RepeatQuantity.WEEKS
MONTHS = RepeatQuantity.MONTHS
YEARS = RepeatQuantity.YEARS
HOURS = RepeatQuantity.HOURS
MINUTES = RepeatQuantity.MINUTES

MON, TUE, WED, THU, FRI, SAT, SUN = range(7)


def next_time(now: datetime, original: datetime, quantity=None, interval=None, weekdays=None) -> datetime:
	"""Run `_find_next_time` with "now" frozen, in naive local datetimes."""
	with mock.patch('backend.reminders.datetime', frozen_datetime(now)):
		result = _find_next_time(
			int(original.timestamp()), quantity, interval, weekdays
		)
	return datetime.fromtimestamp(result)


class Test_FindNextTime_Repeat(unittest.TestCase):
	ORIGINAL = datetime(2027, 1, 1, 9, 0)
	NOW = datetime(2027, 1, 10, 12, 0)

	def test_no_repetition_returns_original(self):
		self.assertEqual(next_time(self.NOW, self.ORIGINAL), self.ORIGINAL)

	def test_future_original_is_kept(self):
		original = datetime(2027, 2, 1, 9, 0)
		for quantity in RepeatQuantity:
			with self.subTest(quantity=quantity):
				self.assertEqual(next_time(self.NOW, original, quantity, 1), original)

	def test_each_quantity(self):
		cases = [
			(MINUTES, 45, datetime(2027, 1, 10, 12, 45)),
			(MINUTES, 1, datetime(2027, 1, 10, 12, 1)),
			(HOURS, 5, datetime(2027, 1, 10, 13, 0)),
			(HOURS, 1, datetime(2027, 1, 10, 13, 0)),
			(DAYS, 1, datetime(2027, 1, 11, 9, 0)),
			(DAYS, 3, datetime(2027, 1, 13, 9, 0)),
			(WEEKS, 1, datetime(2027, 1, 15, 9, 0)),
			(WEEKS, 2, datetime(2027, 1, 15, 9, 0)),
			(MONTHS, 1, datetime(2027, 2, 1, 9, 0)),
			(MONTHS, 6, datetime(2027, 7, 1, 9, 0)),
			(YEARS, 1, datetime(2028, 1, 1, 9, 0)),
		]
		for quantity, interval, expected in cases:
			with self.subTest(quantity=quantity, interval=interval):
				self.assertEqual(
					next_time(self.NOW, self.ORIGINAL, quantity, interval),
					expected
				)

	def test_result_is_strictly_in_the_future(self):
		# An occurrence exactly at "now" is considered passed
		now = datetime(2027, 1, 3, 9, 0)
		self.assertEqual(
			next_time(now, self.ORIGINAL, DAYS, 1),
			datetime(2027, 1, 4, 9, 0)
		)

	def test_time_of_day_is_preserved(self):
		original = datetime(2027, 1, 1, 23, 59, 59)
		result = next_time(datetime(2030, 6, 15), original, DAYS, 7)
		self.assertEqual(result.time(), original.time())
		self.assertEqual((result - original).days % 7, 0)

	def test_long_gap(self):
		# A reminder that was "missed" for years is pushed forward correctly
		original = datetime(2000, 1, 1, 8, 0)
		self.assertEqual(
			next_time(self.NOW, original, DAYS, 1),
			datetime(2027, 1, 11, 8, 0)
		)

	def test_month_end_first_clamp(self):
		# relativedelta clamps the day to the end of shorter months
		original = datetime(2027, 1, 31, 9, 0)
		self.assertEqual(
			next_time(datetime(2027, 2, 1), original, MONTHS, 1),
			datetime(2027, 2, 28, 9, 0)
		)

	@known_bug('BUG-05')
	def test_month_end_does_not_drift(self):
		# A monthly reminder on the 31st should fire on the last day of
		# every month, not stay stuck on the 28th after February.
		original = datetime(2027, 1, 31, 9, 0)
		self.assertEqual(
			next_time(datetime(2027, 4, 1), original, MONTHS, 1),
			datetime(2027, 4, 30, 9, 0)
		)

	@known_bug('BUG-05')
	def test_leap_day_yearly_does_not_drift(self):
		original = datetime(2028, 2, 29, 9, 0)
		self.assertEqual(
			next_time(datetime(2031, 3, 1), original, YEARS, 1),
			datetime(2032, 2, 29, 9, 0)
		)

	def test_repeat_takes_precedence_over_weekdays(self):
		self.assertEqual(
			next_time(self.NOW, self.ORIGINAL, DAYS, 1, [MON]),
			datetime(2027, 1, 11, 9, 0)
		)


class Test_FindNextTime_Weekdays(unittest.TestCase):
	MONDAY = datetime(2027, 1, 4, 8, 0)

	def test_documented_example(self):
		# From the comment in _find_next_time: it's Monday, the reminder is
		# set for Wednesday and repeats on Tuesday and Thursday. The first
		# notification goes on Thursday.
		self.assertEqual(
			next_time(self.MONDAY, datetime(2027, 1, 6, 9, 0), weekdays=[TUE, THU]),
			datetime(2027, 1, 7, 9, 0)
		)

	def test_wraps_to_next_week(self):
		# Set on a Friday, repeats on Mondays
		self.assertEqual(
			next_time(self.MONDAY, datetime(2027, 1, 8, 9, 0), weekdays=[MON]),
			datetime(2027, 1, 11, 9, 0)
		)

	def test_wraps_to_first_allowed_day(self):
		# Set on a Saturday, repeats on Tuesday and Thursday -> next Tuesday
		self.assertEqual(
			next_time(self.MONDAY, datetime(2027, 1, 9, 9, 0), weekdays=[TUE, THU]),
			datetime(2027, 1, 12, 9, 0)
		)

	def test_rolls_past_occurrences(self):
		now = datetime(2027, 1, 15, 10, 0) # Friday, after 09:00
		self.assertEqual(
			next_time(now, datetime(2027, 1, 4, 9, 0), weekdays=[MON, WED, FRI]),
			datetime(2027, 1, 18, 9, 0)
		)

	def test_rolls_to_later_today(self):
		now = datetime(2027, 1, 15, 8, 0) # Friday, before 09:00
		self.assertEqual(
			next_time(now, datetime(2027, 1, 4, 9, 0), weekdays=[MON, WED, FRI]),
			datetime(2027, 1, 15, 9, 0)
		)

	def test_unsorted_input(self):
		weekdays = [FRI, MON, WED]
		now = datetime(2027, 1, 15, 10, 0)
		self.assertEqual(
			next_time(now, datetime(2027, 1, 4, 9, 0), weekdays=weekdays),
			datetime(2027, 1, 18, 9, 0)
		)
		# Side effect: the given list is sorted in place
		self.assertEqual(weekdays, [MON, WED, FRI])

	def test_time_of_day_is_preserved(self):
		result = next_time(self.MONDAY, datetime(2027, 1, 6, 17, 42, 13), weekdays=[SUN])
		self.assertEqual(result, datetime(2027, 1, 10, 17, 42, 13))

	def test_every_weekday_from_the_past(self):
		now = datetime(2027, 1, 6, 12, 0) # Wednesday noon
		self.assertEqual(
			next_time(now, datetime(2027, 1, 1, 9, 0), weekdays=list(range(7))),
			datetime(2027, 1, 7, 9, 0)
		)

	@known_bug('BUG-06')
	def test_first_occurrence_on_selected_day_is_kept(self):
		# Set for Wednesday 09:00, repeating on Wednesdays: the first
		# notification should be that Wednesday, not a week later.
		self.assertEqual(
			next_time(self.MONDAY, datetime(2027, 1, 6, 9, 0), weekdays=[WED]),
			datetime(2027, 1, 6, 9, 0)
		)

	@known_bug('BUG-06')
	def test_every_day_starting_today_fires_today(self):
		self.assertEqual(
			next_time(self.MONDAY, datetime(2027, 1, 4, 9, 0), weekdays=list(range(7))),
			datetime(2027, 1, 4, 9, 0)
		)


@unittest.skipUnless(hasattr(time, 'tzset'), 'Needs time.tzset()')
class Test_FindNextTime_DST(unittest.TestCase):
	"""Repeats are calculated on naive local datetimes, so they keep their
	wall-clock time across daylight saving time changes."""

	def setUp(self):
		self.original_tz = os.environ.get('TZ')
		os.environ['TZ'] = 'Europe/Amsterdam'
		time.tzset()

	def tearDown(self):
		if self.original_tz is None:
			os.environ.pop('TZ', None)
		else:
			os.environ['TZ'] = self.original_tz
		time.tzset()

	def test_daily_across_spring_forward(self):
		# DST starts on Sunday 2027-03-28 at 02:00 in Amsterdam
		result = next_time(
			datetime(2027, 3, 28, 10, 0),
			datetime(2027, 3, 27, 9, 0),
			DAYS, 1
		)
		self.assertEqual(result, datetime(2027, 3, 29, 9, 0))
		# 23 hours of real time between Saturday 09:00 and Sunday 09:00
		self.assertEqual(
			local_ts(2027, 3, 28, 9, 0) - local_ts(2027, 3, 27, 9, 0),
			23 * 3600
		)

	def test_hourly_across_spring_forward(self):
		# Hourly repeats are wall-clock based too: 01:00 + 1h = 02:00 does not
		# exist on that day, and becomes 03:00 after the round trip.
		result = next_time(
			datetime(2027, 3, 28, 1, 30),
			datetime(2027, 3, 28, 1, 0),
			HOURS, 1
		)
		self.assertIn(result.hour, (2, 3))


class LibraryTestCase(MindTestCase):
	"""A user 'alice' with two notification services, plus a user 'bob'."""

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

	def reminders(self, user_id=None) -> Reminders:
		return Reminders(user_id or self.alice_id)


class Test_RemindersAdd(LibraryTestCase):
	def test_add_basic(self):
		t = future()
		with self.ctx():
			result = self.reminders().add('Title', t, [self.s1], 'Body', color='#3c3c3c').get()
		self.assertEqual(result, {
			'id': 1,
			'title': 'Title',
			'text': 'Body',
			'time': t,
			'repeat_quantity': None,
			'repeat_interval': None,
			'weekdays': None,
			'color': '#3c3c3c',
			'notification_services': [self.s1],
		})
		self.assertEqual(
			self.sql("SELECT original_time FROM reminders;"),
			[(None,)]
		)

	def test_time_is_rounded(self):
		t = future()
		with self.ctx():
			self.assertEqual(self.reminders().add('t', t + 0.6, [self.s1]).get()['time'], t + 1)
			self.assertEqual(self.reminders().add('t', t + 0.4, [self.s1]).get()['time'], t)

	def test_time_in_past(self):
		with self.ctx():
			with self.assertRaises(InvalidTime):
				self.reminders().add('t', mind_now() - 10, [self.s1])
		self.assertEqual(self.sql("SELECT COUNT(*) FROM reminders;"), [(0,)])

	def test_multiple_services(self):
		with self.ctx():
			result = self.reminders().add('t', future(), [self.s2, self.s1]).get()
		self.assertEqual(sorted(result['notification_services']), [self.s1, self.s2])

	def test_unknown_service(self):
		with self.ctx():
			with self.assertRaises(NotificationServiceNotFound):
				self.reminders().add('t', future(), [self.s1, 999])
		self.assertEqual(self.sql("SELECT COUNT(*) FROM reminders;"), [(0,)])

	def test_service_of_other_user(self):
		with self.ctx():
			with self.assertRaises(NotificationServiceNotFound):
				self.reminders().add('t', future(), [self.bob_service])
		self.assertEqual(self.sql("SELECT COUNT(*) FROM reminders;"), [(0,)])

	def test_repeat_validation(self):
		with self.ctx():
			with self.assertRaises(InvalidKeyValue) as cm:
				self.reminders().add('t', future(), [self.s1], repeat_interval=1)
			self.assertEqual(cm.exception.key, 'repeat_quantity')

			with self.assertRaises(InvalidKeyValue) as cm:
				self.reminders().add('t', future(), [self.s1], repeat_quantity=DAYS)
			self.assertEqual(cm.exception.key, 'repeat_interval')

			with self.assertRaises(InvalidKeyValue) as cm:
				self.reminders().add(
					't', future(), [self.s1],
					repeat_quantity=DAYS, repeat_interval=1, weekdays=[MON]
				)
			self.assertEqual(cm.exception.key, 'weekdays')

	def test_repeating_reminder_stores_original_time(self):
		t = future()
		with self.ctx():
			result = self.reminders().add(
				't', t, [self.s1], repeat_quantity=WEEKS, repeat_interval=2
			).get()
		self.assertEqual(result['repeat_quantity'], 'weeks')
		self.assertEqual(result['repeat_interval'], 2)
		self.assertEqual(result['time'], t)
		self.assertEqual(self.sql("SELECT original_time FROM reminders;"), [(t,)])

	def test_weekday_reminder(self):
		t = future()
		with self.ctx():
			result = self.reminders().add('t', t, [self.s1], weekdays=[FRI, MON]).get()
		self.assertEqual(result['weekdays'], [MON, FRI])
		self.assertEqual(self.sql("SELECT weekdays, original_time FROM reminders;"), [('0,4', t)])
		self.assertIn(datetime.fromtimestamp(result['time']).weekday(), (MON, FRI))
		self.assertGreater(result['time'], t)

	def test_add_arms_scheduler(self):
		t = future(600)
		with self.ctx():
			self.reminders().add('t', t, [self.s1])
		self.assertEqual(self.handler.time, t)
		self.assertTrue(self.handler.thread.is_alive())


class Test_RemindersRead(LibraryTestCase):
	def setUp(self):
		super().setUp()
		self.base = future()
		with self.ctx():
			r = self.reminders()
			r.add('Beta', self.base + 300, [self.s1], 'second text')
			r.add('alpha', self.base + 200, [self.s1], 'first text', color='#49191e')
			r.add('Gamma', self.base + 100, [self.s2], weekdays=[SAT])
			r.add('Delta', self.base + 400, [self.s1], repeat_quantity=DAYS, repeat_interval=1)
			Reminders(self.bob_id).add('Bob only', self.base, [self.bob_service])

	def titles(self, rows):
		return [r['title'] for r in rows]

	def test_fetchall_is_scoped_to_user(self):
		with self.ctx():
			self.assertNotIn('Bob only', self.titles(self.reminders().fetchall()))
			self.assertEqual(self.titles(Reminders(self.bob_id).fetchall()), ['Bob only'])

	def test_fetchall_default_sort_is_time(self):
		with self.ctx():
			rows = self.reminders().fetchall()
		times = [r['time'] for r in rows]
		self.assertEqual(times, sorted(times))

	def test_fetchall_sorting(self):
		with self.ctx():
			r = self.reminders()
			self.assertEqual(
				self.titles(r.fetchall(SortingMethod.TITLE)),
				['Beta', 'Delta', 'Gamma', 'alpha'] # Case sensitive sort
			)
			self.assertEqual(
				self.titles(r.fetchall(SortingMethod.TITLE_REVERSED)),
				['alpha', 'Gamma', 'Delta', 'Beta']
			)
			self.assertEqual(
				self.titles(r.fetchall(SortingMethod.DATE_ADDED)),
				['Beta', 'alpha', 'Gamma', 'Delta']
			)
			self.assertEqual(
				self.titles(r.fetchall(SortingMethod.DATE_ADDED_REVERSED)),
				['Delta', 'Gamma', 'alpha', 'Beta']
			)
			by_time = self.titles(r.fetchall(SortingMethod.TIME))
			self.assertEqual(self.titles(r.fetchall(SortingMethod.TIME_REVERSED)), by_time[::-1])

	def test_fetchall_fields(self):
		with self.ctx():
			rows = {r['title']: r for r in self.reminders().fetchall()}
		self.assertEqual(
			set(rows['Beta']),
			{'id', 'title', 'text', 'time', 'repeat_quantity',
			'repeat_interval', 'weekdays', 'color'}
		)
		self.assertEqual(rows['Gamma']['weekdays'], [SAT])
		self.assertIsNone(rows['Beta']['weekdays'])
		self.assertEqual(rows['Delta']['repeat_quantity'], 'days')
		self.assertEqual(rows['alpha']['color'], '#49191e')

	def test_search(self):
		with self.ctx():
			r = self.reminders()
			self.assertEqual(self.titles(r.search('ALPHA')), ['alpha'])
			self.assertEqual(self.titles(r.search('text', SortingMethod.TITLE)), ['Beta', 'alpha'])
			self.assertEqual(self.titles(r.search('nothing')), [])
			self.assertEqual(len(r.search('')), 4)
			self.assertEqual(self.titles(r.search('bob')), [])

	def test_fetchone(self):
		with self.ctx():
			reminder = self.reminders().fetchone(1)
			self.assertIsInstance(reminder, Reminder)
			self.assertEqual(reminder.get()['title'], 'Beta')

	def test_fetchone_not_found(self):
		with self.ctx():
			with self.assertRaises(ReminderNotFound):
				self.reminders().fetchone(999)

	def test_fetchone_of_other_user(self):
		with self.ctx():
			with self.assertRaises(ReminderNotFound):
				self.reminders().fetchone(5)
			with self.assertRaises(ReminderNotFound):
				Reminders(self.bob_id).fetchone(1)


class Test_ReminderUpdate(LibraryTestCase):
	def setUp(self):
		super().setUp()
		self.t = future()
		with self.ctx():
			self.id = self.reminders().add(
				'Original', self.t, [self.s1], 'text', color='#49191e'
			).id

	def update(self, **kwargs):
		with self.ctx():
			return self.reminders().fetchone(self.id).update(**kwargs)

	def test_update_title_and_text(self):
		result = self.update(title='New', text='new text', color='#49191e')
		self.assertEqual(result['title'], 'New')
		self.assertEqual(result['text'], 'new text')
		self.assertEqual(result['time'], self.t)
		self.assertEqual(result['notification_services'], [self.s1])

	def test_omitted_color_is_cleared(self):
		# PUT semantics: the color is always overwritten, None clears it
		result = self.update(title='New')
		self.assertIsNone(result['color'])

	def test_none_title_and_text_are_kept(self):
		result = self.update(color='#49191e')
		self.assertEqual(result['title'], 'Original')
		self.assertEqual(result['text'], 'text')

	def test_update_time(self):
		new_t = self.t + 3600
		self.assertEqual(self.update(time=new_t)['time'], new_t)

	def test_update_time_in_past(self):
		with self.ctx():
			with self.assertRaises(InvalidTime):
				self.reminders().fetchone(self.id).update(time=mind_now() - 60)
		with self.ctx():
			self.assertEqual(self.reminders().fetchone(self.id).get()['time'], self.t)

	def test_update_to_repeating(self):
		result = self.update(repeat_quantity=HOURS, repeat_interval=3)
		self.assertEqual((result['repeat_quantity'], result['repeat_interval']), ('hours', 3))
		self.assertEqual(self.sql("SELECT original_time FROM reminders;"), [(self.t,)])

	def test_repeating_reminder_may_get_past_time(self):
		# For repeating reminders the time is the anchor of the series,
		# so a past time is allowed and is rolled into the future.
		past = int(mind_now()) - 86400 * 3 - 60
		result = self.update(time=past, repeat_quantity=DAYS, repeat_interval=1)
		self.assertGreater(result['time'], mind_now())
		self.assertEqual((result['time'] - past) % 86400, 0)
		self.assertEqual(self.sql("SELECT original_time FROM reminders;"), [(past,)])

	def test_update_to_weekdays(self):
		result = self.update(weekdays=[SUN, MON])
		self.assertEqual(result['weekdays'], [MON, SUN])
		self.assertIn(datetime.fromtimestamp(result['time']).weekday(), (MON, SUN))

	def test_omitted_repetition_is_cleared(self):
		self.update(repeat_quantity=DAYS, repeat_interval=1)
		result = self.update(title='Still repeating?')
		self.assertIsNone(result['repeat_quantity'])
		self.assertIsNone(result['repeat_interval'])
		self.assertIsNone(result['weekdays'])

	def test_update_validation(self):
		with self.ctx():
			reminder = self.reminders().fetchone(self.id)
			with self.assertRaises(InvalidKeyValue):
				reminder.update(repeat_interval=1)
			with self.assertRaises(InvalidKeyValue):
				reminder.update(repeat_quantity=DAYS)
			with self.assertRaises(InvalidKeyValue):
				reminder.update(repeat_quantity=DAYS, repeat_interval=1, weekdays=[MON])

	def test_update_services(self):
		self.assertEqual(
			sorted(self.update(notification_services=[self.s2, self.s1])['notification_services']),
			[self.s1, self.s2]
		)
		self.assertEqual(self.update(notification_services=[self.s2])['notification_services'], [self.s2])

	def test_update_services_empty_list_keeps_services(self):
		self.assertEqual(self.update(notification_services=[])['notification_services'], [self.s1])

	def test_update_unknown_service_raises(self):
		with self.ctx():
			with self.assertRaises(NotificationServiceNotFound):
				self.reminders().fetchone(self.id).update(notification_services=[999])

	@known_bug('BUG-03')
	def test_failed_update_changes_nothing(self):
		with self.ctx():
			with self.assertRaises(NotificationServiceNotFound):
				self.reminders().fetchone(self.id).update(
					title='Changed', notification_services=[999]
				)
		with self.ctx():
			result = self.reminders().fetchone(self.id).get()
		self.assertEqual(result['title'], 'Original')
		self.assertEqual(result['notification_services'], [self.s1])

	@known_bug('BUG-02')
	def test_update_with_service_of_other_user(self):
		with self.ctx():
			with self.assertRaises(NotificationServiceNotFound):
				self.reminders().fetchone(self.id).update(
					notification_services=[self.bob_service]
				)
		with self.ctx():
			self.assertEqual(
				self.reminders().fetchone(self.id).get()['notification_services'],
				[self.s1]
			)

	def test_update_reschedules_earlier(self):
		earlier = int(mind_now()) + 300
		self.update(time=earlier)
		self.assertEqual(self.handler.time, earlier)

	def test_delete(self):
		with self.ctx():
			self.reminders().fetchone(self.id).delete()
		with self.ctx():
			with self.assertRaises(ReminderNotFound):
				self.reminders().fetchone(self.id)
		self.assertEqual(self.sql("SELECT * FROM reminder_services;"), [])


class Test_TestReminder(LibraryTestCase):
	def test_sends_to_all_services(self):
		with self.ctx():
			self.reminders().test_reminder('Hello', [self.s1, self.s2], 'World')
		self.assertEqual(RECORDER.sent, [{
			'title': 'Hello', 'body': 'World', 'urls': [DEFAULT_URL, OTHER_URL]
		}])

	def test_empty_body_becomes_zero_width_space(self):
		# Some services refuse empty bodies, so MIND sends U+200B
		with self.ctx():
			self.reminders().test_reminder('Hello', [self.s1])
		self.assertEqual(RECORDER.sent[0]['body'], '​')

	def test_service_of_other_user(self):
		with self.ctx():
			with self.assertRaises(NotificationServiceNotFound):
				self.reminders().test_reminder('Hello', [self.s1, self.bob_service])
		self.assertEqual(RECORDER.sent, [])

	def test_nothing_is_stored(self):
		with self.ctx():
			self.reminders().test_reminder('Hello', [self.s1])
		self.assertEqual(self.sql("SELECT COUNT(*) FROM reminders;"), [(0,)])


class SchedulerTestCase(LibraryTestCase):
	"""Runs on a controllable clock with fake timers."""

	START = local_ts(2030, 1, 7, 8, 0) # A Monday

	def setUp(self):
		super().setUp()
		self.clock = MindClock(self.START)
		self._patch('backend.reminders.datetime', self.clock.datetime)
		self._patch('backend.reminders.Timer', FakeTimer)
		FakeTimer.instances = []
		self.handler.thread = None
		self.handler.time = None

	def add(self, title, offset, services=None, **kwargs):
		with self.ctx():
			return self.reminders().add(
				title, self.START + offset, services or [self.s1], **kwargs
			).id

	def fire(self):
		"""Advance the clock to the armed time and run the timer."""
		timer = self.handler.thread
		self.assertIsNotNone(timer, 'No timer armed')
		self.clock.ts = self.handler.time
		timer.fire()
		return timer

	def live_timers(self):
		"""The times of all timers that will still fire, including ones the
		handler lost track of."""
		return sorted(t.args[0] for t in FakeTimer.live())

	def armed(self):
		"""(time, interval) of the live timer, or None."""
		timer = self.handler.thread
		if timer is None or not timer.is_alive():
			return None
		return self.handler.time, round(timer.interval)


class Test_Scheduler(SchedulerTestCase):
	def test_nothing_to_schedule(self):
		self.handler.find_next_reminder()
		self.assertIsNone(self.handler.thread)

	def test_arms_soonest(self):
		self.add('later', 600)
		self.add('soon', 60)
		self.add('latest', 900)
		self.assertEqual(self.armed(), (self.START + 60, 60))

	def test_find_next_reminder_from_database(self):
		self.add('a', 500)
		self.add('b', 100)
		self.handler.thread = None
		self.handler.time = None
		self.handler.find_next_reminder()
		self.assertEqual(self.armed(), (self.START + 100, 100))

	def test_earlier_time_replaces_timer(self):
		self.add('a', 500)
		first = self.handler.thread
		self.add('b', 100)
		self.assertTrue(first.cancelled)
		self.assertEqual(self.live_timers(), [self.START + 100])
		self.assertIsNot(self.handler.thread, first)
		self.assertEqual(self.handler.time, self.START + 100)

	def test_later_time_keeps_timer(self):
		self.add('a', 100)
		first = self.handler.thread
		self.add('b', 500)
		self.assertIs(self.handler.thread, first)
		self.assertFalse(first.cancelled)

	def test_trigger_sends_and_deletes_one_off(self):
		self.add('One-off', 60, [self.s1, self.s2], text='Body')
		self.fire()
		self.assertEqual(RECORDER.sent, [{
			'title': 'One-off', 'body': 'Body', 'urls': [DEFAULT_URL, OTHER_URL]
		}])
		self.assertEqual(self.sql("SELECT COUNT(*) FROM reminders;"), [(0,)])

	def test_trigger_empty_body(self):
		self.add('One-off', 60)
		self.fire()
		self.assertEqual(RECORDER.sent[0]['body'], '​')

	def test_trigger_reschedules_repeating(self):
		rid = self.add('Daily', 60, repeat_quantity=DAYS, repeat_interval=1)
		self.fire()
		self.assertEqual(RECORDER.titles(), ['Daily'])
		self.assertEqual(
			self.sql("SELECT time, original_time FROM reminders WHERE id = ?;", (rid,)),
			[(self.START + 60 + 86400, self.START + 60)]
		)
		self.assertEqual(self.armed(), (self.START + 60 + 86400, 86400))
		self.assertEqual(self.live_timers(), [self.START + 60 + 86400])

	def test_repeating_reminder_fires_again_and_again(self):
		self.add('Hourly', 60, repeat_quantity=HOURS, repeat_interval=1)
		for _ in range(5):
			self.fire()
		self.assertEqual(RECORDER.titles(), ['Hourly'] * 5)
		self.assertEqual(self.handler.time, self.START + 60 + 5 * 3600)

	def test_trigger_reschedules_weekday(self):
		# Monday 08:00 now; Monday 09:00 reminder repeating on Mon and Thu.
		# (Its first occurrence is moved to Thursday, see BUG-06.)
		rid = self.add('Weekly', 3600, weekdays=[MON, THU])
		first = self.handler.time
		self.assertEqual(datetime.fromtimestamp(first).weekday(), THU)
		self.fire()
		second = self.sql("SELECT time FROM reminders WHERE id = ?;", (rid,))[0][0]
		self.assertEqual(datetime.fromtimestamp(second).weekday(), MON)
		self.assertEqual(second - first, 4 * 86400)

	def test_only_reminders_at_that_time_are_sent(self):
		self.add('first', 60)
		self.add('second', 120)
		self.fire()
		self.assertEqual(RECORDER.titles(), ['first'])
		self.assertEqual(self.armed(), (self.START + 120, 60))
		self.fire()
		self.assertEqual(RECORDER.titles(), ['first', 'second'])
		self.assertIsNone(self.armed())
		self.assertEqual(self.live_timers(), [])

	@known_bug('BUG-04')
	def test_reminders_of_different_users_at_same_time(self):
		self.add('alice', 60)
		with self.ctx():
			Reminders(self.bob_id).add('bob', self.START + 60, [self.bob_service])
		self.fire()
		self.assertEqual(
			sorted((s['title'], tuple(s['urls'])) for s in RECORDER.sent),
			[('alice', (DEFAULT_URL,)), ('bob', ('json://bob.example',))]
		)

	def test_moving_soonest_reminder_earlier(self):
		self.add('a', 600)
		rid = self.add('b', 900)
		with self.ctx():
			self.reminders().fetchone(rid).update(title='b', time=self.START + 60)
		self.assertEqual(self.armed(), (self.START + 60, 60))

	def test_stop_handling(self):
		self.add('a', 60)
		timer = self.handler.thread
		self.handler.stop_handling()
		self.assertTrue(timer.cancelled)

	@known_bug('BUG-01')
	def test_deleting_soonest_reminder_keeps_schedule_alive(self):
		first = self.add('first', 60)
		self.add('second', 120)
		with self.ctx():
			self.reminders().fetchone(first).delete()
		# Whether the scheduler re-arms right away or after the old timer
		# fires on an empty slot, 'second' must eventually be sent.
		for _ in range(3):
			if self.armed() is None:
				break
			self.fire()
			if RECORDER.titles():
				break
		self.assertEqual(RECORDER.titles(), ['second'])

	@known_bug('BUG-01')
	def test_moving_soonest_reminder_later_keeps_schedule_alive(self):
		rid = self.add('moved', 60)
		with self.ctx():
			self.reminders().fetchone(rid).update(title='moved', time=self.START + 3600)
		for _ in range(3):
			if self.armed() is None:
				break
			self.fire()
			if RECORDER.titles():
				break
		self.assertEqual(RECORDER.titles(), ['moved'])

	@known_bug('BUG-01')
	def test_new_reminder_is_scheduled_after_empty_trigger(self):
		rid = self.add('deleted', 60)
		with self.ctx():
			self.reminders().fetchone(rid).delete()
		self.fire() # The stale timer fires on an empty slot
		self.add('new', 600)
		self.assertEqual(self.armed(), (self.START + 600, 600 - 60))

	@known_bug('BUG-04')
	def test_same_time_one_offs_are_all_sent_once(self):
		self.add('one', 60)
		self.add('two', 60)
		self.add('three', 60)
		self.fire()
		self.assertEqual(sorted(RECORDER.titles()), ['one', 'three', 'two'])
		self.assertEqual(self.sql("SELECT COUNT(*) FROM reminders;"), [(0,)])

	@known_bug('BUG-04')
	def test_same_time_batch_does_not_rearm_for_itself(self):
		# While a batch is being processed, the scheduler must not arm a new
		# timer for the batch's own timestamp: in production that timer fires
		# immediately in a second thread and sends the rest of the batch twice.
		self.add('repeating', 60, repeat_quantity=DAYS, repeat_interval=1)
		self.add('one-off', 60)
		self.fire()
		self.assertEqual(sorted(RECORDER.titles()), ['one-off', 'repeating'])
		self.assertEqual(self.live_timers(), [self.START + 60 + 86400])


class Test_Scheduler_RealTime(LibraryTestCase):
	"""End-to-end with real threads. These take a few seconds."""

	def wait_for(self, condition, timeout=6.0):
		deadline = time.monotonic() + timeout
		while time.monotonic() < deadline:
			if condition():
				return True
			time.sleep(0.05)
		return condition()

	def test_reminder_is_sent_on_time(self):
		t = int(mind_now()) + 2
		with self.ctx():
			self.reminders().add('Real', t, [self.s1])
		self.assertTrue(self.wait_for(lambda: RECORDER.titles() == ['Real']))
		self.assertGreaterEqual(mind_now(), t - 0.5)
		self.assertTrue(self.wait_for(
			lambda: self.sql("SELECT COUNT(*) FROM reminders;") == [(0,)]
		))

	@known_bug('BUG-01')
	def test_deleted_soonest_does_not_stall(self):
		base = int(mind_now())
		with self.ctx():
			first = self.reminders().add('first', base + 1, [self.s1]).id
			self.reminders().add('second', base + 2, [self.s1])
		with self.ctx():
			self.reminders().fetchone(first).delete()
		self.assertTrue(self.wait_for(lambda: RECORDER.titles() == ['second'], 5))

	@known_bug('BUG-04')
	def test_same_time_batch_is_not_sent_twice(self):
		t = int(mind_now()) + 2
		with self.ctx():
			self.reminders().add('repeating', t, [self.s1], repeat_quantity=DAYS, repeat_interval=1)
			self.reminders().add('one-off', t, [self.s1])
		self.wait_for(lambda: len(RECORDER.sent) >= 2)
		time.sleep(1)
		self.assertEqual(sorted(RECORDER.titles()), ['one-off', 'repeating'])


if __name__ == '__main__':
	unittest.main()
