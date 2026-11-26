#-*- coding: utf-8 -*-

from __future__ import annotations

from datetime import datetime, timedelta
from sqlite3 import IntegrityError
from threading import RLock, Timer, current_thread, main_thread
from typing import TYPE_CHECKING, Callable, List, Optional, Union

from apprise import Apprise
from dateutil.relativedelta import relativedelta
from dateutil.relativedelta import weekday as du_weekday
from flask import has_app_context

from backend.custom_exceptions import (InvalidKeyValue, InvalidTime,
                                       NotificationServiceNotFound,
                                       ReminderNotFound)
from backend.db import DB_Singleton, DBConnection, get_db
from backend.helpers import (RepeatQuantity, Singleton, SortingMethod,
                             search_filter, when_not_none)
from backend.logging import LOGGER
from backend.notification_service import check_notification_services

if TYPE_CHECKING:
	from flask.ctx import AppContext


def __next_selected_day(
	weekdays: List[int],
	weekday: int
) -> int:
	"""Find the next allowed day in the week.

	Args:
		weekdays (List[int]): The days of the week that are allowed.
		Monday is 0, Sunday is 6.
		weekday (int): The current weekday.

	Returns:
		int: The next allowed weekday.
	"""
	return (
		# Get all days later than current, then grab first one.
		[d for d in weekdays if weekday < d]
		or
		# weekday is last allowed day, so it should grab the first
		# allowed day of the week.
		weekdays
	)[0]

def _find_next_time(
	original_time: int,
	repeat_quantity: Union[RepeatQuantity, None],
	repeat_interval: Union[int, None],
	weekdays: Union[List[int], None]
) -> int:
	"""Calculate the next timestep based on original time and repeat/interval
	values.

	Args:
		original_time (int): The original time of the repeating timestamp.

		repeat_quantity (Union[RepeatQuantity, None]): If set, what the quantity
		is of the repetition.

		repeat_interval (Union[int, None]): If set, the value of the repetition.

		weekdays (Union[List[int], None]): If set, on which days the time can
		continue. Monday is 0, Sunday is 6.

	Returns:
		int: The next timestamp in the future.
	"""
	if weekdays is not None:
		weekdays.sort()

	new_time = datetime.fromtimestamp(original_time)
	current_time = datetime.fromtimestamp(datetime.utcnow().timestamp())

	if repeat_quantity is not None and new_time <= current_time:
		# Always step from the original time (original + n * interval)
		# instead of adding the interval to the previous result. Months and
		# years get clamped to shorter months, and accumulating would keep
		# that clamp: Jan 31 -> Feb 28 -> Mar 28 instead of Mar 31.
		original = new_time
		if repeat_quantity in (RepeatQuantity.MONTHS, RepeatQuantity.YEARS):
			td = relativedelta(**{repeat_quantity.value: repeat_interval})
			n = 0
			while new_time <= current_time:
				n += 1
				new_time = original + td * n

		else:
			# Fixed length steps: jump straight to the first one in the future
			step = timedelta(**{repeat_quantity.value: repeat_interval})
			n = (current_time - original) // step + 1
			new_time = original + step * n

	elif repeat_quantity is None and weekdays is not None:
		# If the 'free' date is not one of the selected weekdays, it is forced
		# to the next selected weekday first, so the loop has to run at least
		# once.
		# Say it's Monday, we set a reminder for Wednesday and make it repeat
		# on Tuesday and Thursday. Then the first notification needs to go on
		# Thurday, not Wednesday. If the date is one of the selected weekdays,
		# it can be used as is (if it's in the future).
		# Afterwards, it can run normally to push the timestamp into the future.
		one_to_go = new_time.weekday() not in weekdays
		while one_to_go or new_time <= current_time:
			next_day = __next_selected_day(weekdays, new_time.weekday())
			proposed_time = new_time + relativedelta(weekday=du_weekday(next_day))
			if proposed_time == new_time:
				proposed_time += relativedelta(weekday=du_weekday(next_day, 2))
			new_time = proposed_time
			one_to_go = False

	result = int(new_time.timestamp())
	LOGGER.debug(
		f'{original_time=}, {current_time=} ' +
		f'and interval of {repeat_interval} {repeat_quantity} ' +
		f'leads to {result}'
	)
	return result


class Reminder:
	"""Represents a reminder
	"""	
	def __init__(self, user_id: int, reminder_id: int) -> None:
		"""Create an instance.

		Args:
			user_id (int): The ID of the user.
			reminder_id (int): The ID of the reminder.

		Raises:
			ReminderNotFound: Reminder with given ID does not exist or is not
			owned by user.
		"""
		self.id = reminder_id
		self.user_id = user_id

		# Check if reminder exists
		if not get_db().execute(
			"SELECT 1 FROM reminders WHERE id = ? AND user_id = ? LIMIT 1",
			(self.id, user_id)
		).fetchone():
			raise ReminderNotFound

		return

	def _get_notification_services(self) -> List[int]:
		"""Get ID's of notification services linked to the reminder.

		Returns:
			List[int]: The list with ID's.
		"""
		result = [
			r[0]
			for r in get_db().execute("""
				SELECT notification_service_id
				FROM reminder_services
				WHERE reminder_id = ?;
				""",
				(self.id,)
			)
		]
		return result

	def get(self) -> dict:
		"""Get info about the reminder

		Returns:
			dict: The info about the reminder
		"""
		reminder = get_db(dict).execute("""
			SELECT
				id,
				title, text,
				time,
				repeat_quantity,
				repeat_interval,
				weekdays,
				color
			FROM reminders
			WHERE id = ?
			LIMIT 1;
			""",
			(self.id,)
		).fetchone()
		reminder = dict(reminder)

		reminder["weekdays"] = [
			int(n)
			for n in reminder["weekdays"].split(",")
			if n
		] if reminder["weekdays"] else None
		reminder['notification_services'] = self._get_notification_services()

		return reminder

	def update(
		self,
		title: Union[None, str] = None,
		time: Union[None, int] = None,
		notification_services: Union[None, List[int]] = None,
		text: Union[None, str] = None,
		repeat_quantity: Union[None, RepeatQuantity] = None,
		repeat_interval: Union[None, int] = None,
		weekdays: Union[None, List[int]] = None,
		color: Union[None, str] = None
	) -> dict:
		"""Edit the reminder.

		Args:
			title (Union[None, str]): The new title of the entry.
				Defaults to None.

			time (Union[None, int]): The new UTC epoch timestamp when the
			reminder should be send.
				Defaults to None.

			notification_services (Union[None, List[int]]): The new list
			of id's of the notification services to use to send the reminder.
				Defaults to None.

			text (Union[None, str], optional): The new body of the reminder.
				Defaults to None.

			repeat_quantity (Union[None, RepeatQuantity], optional): The new
			quantity of the repeat specified for the reminder.
				Defaults to None.

			repeat_interval (Union[None, int], optional): The new amount of
			repeat_quantity, like "5" (hours).
				Defaults to None.

			weekdays (Union[None, List[int]], optional): The new indexes of
			the days of the week that the reminder should run.
				Defaults to None.

			color (Union[None, str], optional): The new hex code of the color
			of the reminder, which is shown in the web-ui.
				Defaults to None.

		Note about args:
			Either repeat_quantity and repeat_interval are given, weekdays is
			given or neither, but not both.

		Raises:
			NotificationServiceNotFound: One of the notification services was not found.
			InvalidKeyValue: The value of one of the keys is not valid or
			the "Note about args" is violated.

		Returns:
			dict: The new reminder info.
		"""
		LOGGER.info(
			f'Updating reminder {self.id}: '
			+ f'{title=}, {time=}, {notification_services=}, {text=}, '
			+ f'{repeat_quantity=}, {repeat_interval=}, {weekdays=}, {color=}'
		)
		cursor = get_db()

		# Validate data
		if repeat_quantity is None and repeat_interval is not None:
			raise InvalidKeyValue('repeat_quantity', repeat_quantity)
		elif repeat_quantity is not None and repeat_interval is None:
			raise InvalidKeyValue('repeat_interval', repeat_interval)
		elif weekdays is not None and repeat_quantity is not None:
			raise InvalidKeyValue('weekdays', weekdays)

		if notification_services:
			# Before writing anything, so that a bad ID changes nothing
			check_notification_services(self.user_id, notification_services)

		repeated_reminder = (
			(repeat_quantity is not None and repeat_interval is not None)
			or weekdays is not None
		)

		if time is not None:
			if not repeated_reminder:
				if time < datetime.utcnow().timestamp():
					raise InvalidTime
			time = round(time)

		# Get current data and update it with new values
		data = self.get()
		new_values = {
			'title': title,
			'time': time,
			'text': text,
			'repeat_quantity': repeat_quantity,
			'repeat_interval': repeat_interval,
			'weekdays': when_not_none(
				weekdays,
				lambda w: ",".join(map(str, sorted(w)))
			),
			'color': color
		}
		for k, v in new_values.items():
			if (
				k in ('repeat_quantity', 'repeat_interval', 'weekdays', 'color')
				or v is not None
			):
				data[k] = v

		# Update database
		rq = when_not_none(
			data["repeat_quantity"],
			lambda q: q.value
		)
		if repeated_reminder:
			next_time = _find_next_time(
				data["time"],
				data["repeat_quantity"],
				data["repeat_interval"],
				weekdays
			)
			cursor.execute("""
				UPDATE reminders
				SET
					title=?,
					text=?,
					time=?,
					repeat_quantity=?,
					repeat_interval=?,
					weekdays=?,
					original_time=?,
					color=?
				WHERE id = ?;
				""", (
					data["title"],
					data["text"],
					next_time,
					rq,
					data["repeat_interval"],
					data["weekdays"],
					data["time"],
					data["color"],
					self.id
			))

		else:
			next_time = data["time"]
			cursor.execute("""
				UPDATE reminders
				SET
					title=?,
					text=?,
					time=?,
					repeat_quantity=?,
					repeat_interval=?,
					weekdays=?,
					color=?
				WHERE id = ?;
				""", (
					data["title"],
					data["text"],
					data["time"],
					rq,
					data["repeat_interval"],
					data["weekdays"],
					data["color"],
					self.id
			))

		if notification_services:
			cursor.connection.isolation_level = None
			cursor.execute("BEGIN TRANSACTION;")
			cursor.execute(
				"DELETE FROM reminder_services WHERE reminder_id = ?",
				(self.id,)
			)
			try:
				cursor.executemany("""
					INSERT INTO reminder_services(
						reminder_id,
						notification_service_id
					)
					VALUES (?,?);
					""",
					((self.id, s) for s in notification_services)
				)
				cursor.execute("COMMIT;")

			except IntegrityError:
				cursor.execute("ROLLBACK;")
				raise NotificationServiceNotFound

			finally:
				cursor.connection.isolation_level = ""

		# Recalculate instead of passing next_time: if this was the soonest
		# reminder and it moved later, the timer has to move too.
		ReminderHandler().find_next_reminder()
		return self.get()

	def delete(self) -> None:
		"""Delete the reminder
		"""
		LOGGER.info(f'Deleting reminder {self.id}')
		get_db().execute("DELETE FROM reminders WHERE id = ?", (self.id,))
		ReminderHandler().find_next_reminder()
		return

class Reminders:
	"""Represents the reminder library of the user account
	"""

	def __init__(self, user_id: int) -> None:
		"""Create an instance.

		Args:
			user_id (int): The ID of the user.
		"""
		self.user_id = user_id
		return

	def fetchall(
		self,
		sort_by: SortingMethod = SortingMethod.TIME
	) -> List[dict]:
		"""Get all reminders

		Args:
			sort_by (SortingMethod, optional): How to sort the result.
				Defaults to SortingMethod.TIME.

		Returns:
			List[dict]: The id, title, text, time and color of each reminder
		"""
		reminders = [
			dict(r)
			for r in get_db(dict).execute("""
				SELECT
					id,
					title, text,
					time,
					repeat_quantity,
					repeat_interval,
					weekdays,
					color
				FROM reminders
				WHERE user_id = ?;
				""",
				(self.user_id,)
			)
		]
		for r in reminders:
			r["weekdays"] = [
				int(n)
				for n in r["weekdays"].split(",")
				if n
			] if r["weekdays"] else None

		# Sort result
		reminders.sort(key=sort_by.value[0], reverse=sort_by.value[1])

		return reminders

	def search(
		self,
		query: str,
		sort_by: SortingMethod = SortingMethod.TIME) -> List[dict]:
		"""Search for reminders

		Args:
			query (str): The term to search for.
			sort_by (SortingMethod, optional): How to sort the result.
				Defaults to SortingMethod.TIME.

		Returns:
			List[dict]: All reminders that match. Similar output to self.fetchall
		"""
		reminders = [
			r for r in self.fetchall(sort_by)
			if search_filter(query, r)
		]
		return reminders

	def fetchone(self, id: int) -> Reminder:
		"""Get one reminder

		Args:
			id (int): The id of the reminder to fetch

		Returns:
			Reminder: A Reminder instance
		"""		
		return Reminder(self.user_id, id)

	def add(
		self,
		title: str,
		time: int,
		notification_services: List[int],
		text: str = '',
		repeat_quantity: Union[None, RepeatQuantity] = None,
		repeat_interval: Union[None, int] = None,
		weekdays: Union[None, List[int]] = None,
		color: Union[None, str] = None
	) -> Reminder:
		"""Add a reminder

		Args:
			title (str): The title of the entry.

			time (int): The UTC epoch timestamp the the reminder should be send.

			notification_services (List[int]): The id's of the notification services
			to use to send the reminder.

			text (str, optional): The body of the reminder.
				Defaults to ''.

			repeat_quantity (Union[None, RepeatQuantity], optional): The quantity
			of the repeat specified for the reminder.
				Defaults to None.

			repeat_interval (Union[None, int], optional): The amount of repeat_quantity,
			like "5" (hours).
				Defaults to None.

			weekdays (Union[None, List[int]], optional): The indexes of the days
			of the week that the reminder should run.
				Defaults to None.

			color (Union[None, str], optional): The hex code of the color of the
			reminder, which is shown in the web-ui.
				Defaults to None.

		Note about args:
			Either repeat_quantity and repeat_interval are given,
			weekdays is given or neither, but not both.

		Raises:
			NotificationServiceNotFound: One of the notification services was not found.
			InvalidKeyValue: The value of one of the keys is not valid
			or the "Note about args" is violated.

		Returns:
			dict: The info about the reminder.
		"""
		LOGGER.info(
			f'Adding reminder with {title=}, {time=}, {notification_services=}, '
			+ f'{text=}, {repeat_quantity=}, {repeat_interval=}, {weekdays=}, {color=}'
		)
		
		if time < datetime.utcnow().timestamp():
			raise InvalidTime
		time = round(time)

		if repeat_quantity is None and repeat_interval is not None:
			raise InvalidKeyValue('repeat_quantity', repeat_quantity)
		elif repeat_quantity is not None and repeat_interval is None:
			raise InvalidKeyValue('repeat_interval', repeat_interval)
		elif (
			weekdays is not None
			and repeat_quantity is not None
			and repeat_interval is not None
		):
			raise InvalidKeyValue('weekdays', weekdays)

		cursor = get_db()
		check_notification_services(self.user_id, notification_services)

		# Prepare args
		if any((repeat_quantity, weekdays)):
			original_time = time
			time = _find_next_time(
				original_time,
				repeat_quantity,
				repeat_interval,
				weekdays
			)
		else:
			original_time = None

		weekdays_str = when_not_none(
			weekdays,
			lambda w: ",".join(map(str, sorted(w)))
		)
		repeat_quantity_str = when_not_none(
			repeat_quantity,
			lambda q: q.value
		)

		cursor.connection.isolation_level = None
		cursor.execute("BEGIN TRANSACTION;")

		id = cursor.execute("""
			INSERT INTO reminders(
				user_id,
				title, text,
				time,
				repeat_quantity, repeat_interval,
				weekdays,
				original_time,
				color
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
			""", (
				self.user_id,
				title, text,
				time,
				repeat_quantity_str,
				repeat_interval,
				weekdays_str,
				original_time,
				color
		)).lastrowid

		try:
			cursor.executemany("""
				INSERT INTO reminder_services(
					reminder_id,
					notification_service_id
				)
				VALUES (?, ?);
				""",
				((id, service) for service in notification_services)
			)
			cursor.execute("COMMIT;")

		except IntegrityError:
			cursor.execute("ROLLBACK;")
			raise NotificationServiceNotFound

		finally:
			cursor.connection.isolation_level = ''
		
		ReminderHandler().find_next_reminder(time)

		return self.fetchone(id)

	def test_reminder(
		self,
		title: str,
		notification_services: List[int],
		text: str = ''
	) -> None:
		"""Test send a reminder draft.

		Args:
			title (str): Title title of the entry.

			notification_service (int): The id of the notification service to
			use to send the reminder.

			text (str, optional): The body of the reminder.
				Defaults to ''.
		"""
		LOGGER.info(f'Testing reminder with {title=}, {notification_services=}, {text=}')
		a = Apprise()
		cursor = get_db(dict)

		for service in notification_services:
			url = cursor.execute("""
				SELECT url
				FROM notification_services
				WHERE id = ?
					AND user_id = ?
				LIMIT 1;
				""",
				(service, self.user_id)
			).fetchone()
			if not url:
				raise NotificationServiceNotFound
			a.add(url[0])

		a.notify(title=title, body=text or '\u200B')
		return


class ReminderHandler(metaclass=Singleton):
	"""Handle set reminders.
	
	Note: Singleton.
	"""	
	def __init__(
		self,
		context: Callable[[], AppContext]
	) -> None:
		"""Create instance of handler.

		Args:
			context (Optional[AppContext], optional): `Flask.app_context`.
				Defaults to None.
		"""
		self.context = context
		self.thread: Union[Timer, None] = None
		self.time: Union[int, None] = None
		self.lock = RLock()
		"Guards `self.thread` and `self.time`"
		return

	def __send_reminder(self, reminder: dict) -> None:
		"""Send the notification of a reminder.

		Args:
			reminder (dict): The reminder, with at least the keys `id`,
			`title` and `text`.
		"""
		# Fetch all rows at once: `get_db()` returns a cursor that is shared
		# within the app context, so it must not be iterated while other
		# queries run on it.
		urls = [
			r[0]
			for r in get_db().execute("""
				SELECT url
				FROM reminder_services rs
				INNER JOIN notification_services ns
				ON rs.notification_service_id = ns.id
				WHERE rs.reminder_id = ?;
				""",
				(reminder['id'],)
			).fetchall()
		]

		a = Apprise()
		for url in urls:
			a.add(url)
		a.notify(title=reminder["title"], body=reminder["text"] or '\u200B')
		return

	def __move_along(self, reminder: dict) -> None:
		"""After a reminder has been sent, delete it (one-off) or set it to its
		next occurrence (repeating).

		Args:
			reminder (dict): The reminder, with at least the keys `id`,
			`repeat_quantity`, `repeat_interval`, `weekdays` and
			`original_time`.
		"""
		if (reminder['repeat_quantity'], reminder['weekdays']) == (None, None):
			LOGGER.info(f'Deleting reminder {reminder["id"]}')
			get_db().execute(
				"DELETE FROM reminders WHERE id = ?;",
				(reminder['id'],)
			)
			return

		new_time = _find_next_time(
			reminder['original_time'],
			when_not_none(
				reminder["repeat_quantity"],
				lambda q: RepeatQuantity(q)
			),
			reminder['repeat_interval'],
			when_not_none(
				reminder["weekdays"],
				lambda w: [int(d) for d in w.split(',')]
			)
		)
		get_db().execute(
			"UPDATE reminders SET time = ? WHERE id = ?;",
			(new_time, reminder['id'])
		)
		return

	def __trigger_reminders(self, time: int) -> None:
		"""Trigger all reminders that are set for a certain time

		Args:
			time (int): The time of the reminders to trigger
		"""
		try:
			with self.context():
				cursor = get_db(dict)
				reminders = [
					dict(r)
					for r in cursor.execute("""
						SELECT
							id, user_id,
							title, text,
							repeat_quantity, repeat_interval,
							weekdays,
							original_time
						FROM reminders
						WHERE time = ?;
						""",
						(time,)
					).fetchall()
				]

				for reminder in reminders:
					try:
						self.__send_reminder(reminder)
					except Exception:
						# Still move the reminder along below, so that one
						# failing reminder doesn't fire over and over again
						LOGGER.exception(
							f'Failed to send reminder {reminder["id"]}'
						)

					try:
						self.__move_along(reminder)
					except Exception:
						LOGGER.exception(
							f'Failed to reschedule reminder {reminder["id"]}'
						)

		finally:
			# The timer that brought us here has fired. Always arm the next
			# one, also when no reminder had this time anymore (it was
			# deleted or moved) or when something went wrong. Only once the
			# whole batch is done though: arming earlier would start a timer
			# for the rest of this batch, sending it twice.
			with self.lock:
				if (
					self.thread is None
					or self.thread is current_thread()
					or not self.thread.is_alive()
				):
					self.thread = None
					self.time = None
			self.find_next_reminder()

			with self.lock:
				if self.time is not None and self.time <= time:
					# A reminder of this batch couldn't be moved along (the
					# error is logged above). Don't fire again right away
					# in a loop; retry in a minute.
					LOGGER.warning(
						'Reminders could not be rescheduled; retrying in 60 seconds'
					)
					self.__arm(self.time, delay=60.0)

			if current_thread() is not main_thread():
				# Every trigger runs in a new thread; don't leave its
				# database connection open.
				key = f'{DBConnection}{current_thread()}'
				connection = DB_Singleton._instances.pop(key, None)
				if connection is not None and not connection.closed:
					connection.close()
		return

	def __get_soonest_time(self) -> Union[int, None]:
		"""Get the time of the soonest reminder.

		Returns:
			Union[int, None]: The timestamp, or `None` if there are no
			reminders.
		"""
		query = "SELECT MIN(time) FROM reminders;"
		if has_app_context():
			return get_db().execute(query).fetchone()[0]

		with self.context():
			return get_db().execute(query).fetchone()[0]

	def __arm(self, time: int, delay: Optional[float] = None) -> None:
		"""Replace the current timer (if any) with one for `time`.

		Args:
			time (int): The timestamp of the reminders to trigger.
			delay (Optional[float], optional): Trigger after this many
			seconds instead of at `time`.
				Defaults to None.
		"""
		if self.thread is not None:
			self.thread.cancel()

		t = (
			delay
			if delay is not None else
			time - datetime.utcnow().timestamp()
		)
		self.thread = Timer(
			t,
			self.__trigger_reminders,
			(time,)
		)
		self.thread.name = "ReminderHandler"
		self.thread.start()
		self.time = time
		return

	def find_next_reminder(self, time: Optional[int] = None) -> None:
		"""Determine when the soonest reminder is and set the timer to that time

		Args:
			time (Optional[int], optional): The timestamp of a reminder that
			was just added. The timer is moved if it's earlier than the
			current one. Otherwise the soonest time in the database is used,
			and the timer always follows it, also when it's later (because
			the soonest reminder was deleted or moved).
				Defaults to None.
		"""
		with self.lock:
			if time is None:
				soonest_time = self.__get_soonest_time()
				if soonest_time is None:
					# No reminders left
					self.stop_handling()
					self.thread = None
					self.time = None

				elif self.thread is None or soonest_time != self.time:
					self.__arm(soonest_time)

			elif (
				self.thread is None
				or self.time is None
				or time < self.time
			):
				self.__arm(time)

		return
	
	def stop_handling(self) -> None:
		"""Stop the timer if it's active
		"""
		if self.thread is not None:
			self.thread.cancel()
		return
