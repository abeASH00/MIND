# Codebase Atlas

A guided tour of how MIND works on the inside, written for contributors. It
covers the architecture, the data model, the time model, the scheduler, the
migration history, how to test, and a report of bugs found during a full
audit (each with a test that reproduces it).

!!! info "Scope"
	Written against MIND V1.4.x (database version 10). File and line
	references are to that version.

## 1. The big picture

MIND is a single Python process that does two things at once:

1. **Serve a web app.** A Flask app, served by waitress, provides the web-UI
   (three HTML pages plus static JS/CSS) and a JSON API under `/api`.
2. **Send reminders on time.** A scheduler (`ReminderHandler`) keeps one
   `threading.Timer` armed for the soonest reminder. When it fires, MIND sends
   the notification through [Apprise](https://github.com/caronc/apprise),
   then deletes the reminder or moves it to its next occurrence.

Everything is stored in one SQLite database file (`db/MIND.db`). There is no
other state, except API keys, which live in memory only.

```
                      +--------------------------- MIND.py process ----------------------------+
 Browser              |                                                                         |
 (reminders.html,  ---+--> waitress (10 threads) --> DispatcherMiddleware(url_prefix) --> Flask  |
  admin.html,         |                                                              |          |
  login.html)         |      frontend/ui.py   (3 HTML pages)                         |          |
                      |      frontend/api.py  (JSON API, /api and /api/admin) <------+          |
                      |            |  endpoint_wrapper: auth() -> input_validation()           |
                      |            v                                                            |
                      |      backend/users.py ----> Reminders / Templates / StaticReminders /   |
                      |                             NotificationServices (one per user)         |
                      |            |                                                            |
                      |            v                                                            |
                      |      backend/db.py: one sqlite3 connection per thread --> db/MIND.db    |
                      |            ^                                                            |
                      |      ReminderHandler (Timer thread) --- Apprise ---> Telegram, mail, ... |
                      +-------------------------------------------------------------------------+
```

## 2. Repository map

| Path | Lines | Responsibility |
| ---- | ----: | -------------- |
| `MIND.py` | 65 | Entry point: logging, Python version check, flags, DB setup, start server, restart loop. |
| `backend/server.py` | 264 | `Server` singleton: creates the Flask app, URL prefix, waitress, shutdown/restart (`execv`), revert timers. |
| `backend/db.py` | 521 | Per-thread connections, schema, migrations (v1 → v10), DB import/revert. |
| `backend/settings.py` | 245 | Config table: defaults, validation/formatting, hosting-setting backup/restore, PWA manifest. |
| `backend/users.py` | 235 | `Users` (register, login, list) and `User` (one account, lazy access to its libraries). |
| `backend/reminders.py` | 796 | Reminders library, repeat/weekday math (`_find_next_time`), the `ReminderHandler` scheduler. |
| `backend/static_reminders.py` | 356 | Static reminders: reminders without a time, sent when triggered by hand. |
| `backend/templates.py` | 311 | Templates: presets to fill the "add reminder" form. |
| `backend/notification_service.py` | 404 | Notification services (Apprise URLs) and the Apprise service catalogue for the UI. |
| `backend/custom_exceptions.py` | 138 | Exceptions; each carries its own API response (`api_response`). |
| `backend/helpers.py` | 116 | Paths, search filter, enums (sorting, repeat quantity, restart flags), `Singleton`. |
| `backend/security.py` | 40 | PBKDF2-SHA256 password hashing (100 000 iterations). |
| `backend/logging.py` | 141 | Logging config; DEBUG level additionally logs to `MIND_debug.log`. |
| `frontend/api.py` | 850 | All API endpoints, API key handling, the endpoint wrapper. |
| `frontend/input_validation.py` | 588 | One class per API input variable; parses and validates requests; collects API docs. |
| `frontend/ui.py` | 21 | The three HTML routes. |
| `frontend/static/js/*.js` | ~2000 | The web-UI. Vanilla JS, no build step. |
| `frontend/templates/*.html` | ~750 | Jinja templates for the pages. |
| `project_management/generate_api_docs.py` | 156 | Generates `docs/other_docs/api.md` from the registry in `input_validation.py` (run in CI). |
| `tests/` | — | Test suite, see [section 11](#11-testing). |

## 3. Process lifecycle

`MIND.py` → `MIND()`:

1. `setup_logging()` and `check_python_version()` (≥ 3.8).
2. `handle_flags(argv[1])`: if MIND was restarted with the `db_import` or
   `host_change` flag, a 60-second **revert timer** starts (see
   [section 9](#9-settings-hosting-changes-and-database-import)).
3. `setup_db_location()`: renames the legacy `db/Noted.db` (MIND's old name)
   and points `DBConnection.file` at `db/MIND.db`.
4. `SERVER.create_app()`: builds the Flask app and registers the blueprints
   `ui`, `api` (at `/api`) and `admin_api` (at `/api/admin`), plus JSON
   error handlers for 400/404/405/500.
5. Inside an app context: `setup_db()` (create tables, insert default
   settings, migrate, ensure the `admin` user), read the hosting settings,
   apply the URL prefix and arm the scheduler.
6. `SERVER.run(host, port)` blocks in waitress.
7. When waitress stops: stop the scheduler and, if a restart was requested,
   `execv` the interpreter with the restart flags. A restart is a real
   process replacement, so **all API keys are lost on restart**.

The web server uses a custom `ThreadedTaskDispatcher` that closes a worker
thread's database connection when the thread ends.

## 4. Anatomy of an API request

Every API endpoint is declared with `APIBlueprint.route(rule, description,
Methods(...), requires_auth=..., methods=[...])`. Besides registering the
Flask route, this stores an `ApiDocEntry` in `api_docs`, which is the single
source of truth for input validation and for the generated API docs.

The endpoint function is wrapped by `endpoint_wrapper`:

```
request
  └─ endpoint_wrapper
       ├─ get_api_docs(request)         look up the ApiDocEntry for this rule
       ├─ auth()                        if requires_auth: check api_key (see §5)
       ├─ input_validation()            parse + validate + convert all inputs
       ├─ endpoint(inputs, **url_vars)  do the work
       └─ except <MIND exception> as e: return e.api_response  (error, result, code)
```

Inputs come from three sources (`DataSource`): `DATA` (the JSON body),
`VALUES` (query string, plus form fields except for GET) and `FILES`
(multipart uploads). Each input is a small class, e.g. `TitleVariable`,
whose `validate()` checks the raw value and may convert it, e.g.
`SortByVariable` turns `"title"` into `SortingMethod.TITLE`. The "Edit"
variants (`EditTitleVariable`, ...) are optional versions of required ones.

Responses always look like `{"error": null | "<ErrorName>", "result": ...}`.
Unhandled exceptions become `{"error": "Internal error", "result": {}}` with
status 500.

| Exception | Code | Raised when |
| --------- | ---: | ----------- |
| `KeyNotFound` | 400 | A required input is missing |
| `InvalidKeyValue` | 400 | An input has an invalid value |
| `InvalidTime` | 400 | A (non-repeating) reminder time is in the past |
| `UsernameInvalid` / `UsernameTaken` | 400 | Registration problems |
| `NotificationServiceInUse` | 400 | Deleting a service that is still used (`result.type` says by what) |
| `InvalidDatabaseFile` | 400 | Uploaded database can't be imported |
| `AccessUnauthorized` | 401 | Wrong password |
| `APIKeyInvalid` / `APIKeyExpired` | 401 | Authentication problems |
| `NewAccountsNotAllowed` | 403 | Registration is disabled by the admin |
| `UserNotFound`, `ReminderNotFound`, `TemplateNotFound`, `NotificationServiceNotFound`, `LogFileNotFound` | 404 | Missing, or not owned by the user |

## 5. Authentication

- `POST /api/auth/login` checks the password and generates a random 32-hex
  API key. The map `api_key_map` stores `hash(api_key) → ApiKeyEntry(exp,
  user)` **in memory only**.
- The key is sent as the `api_key` URL parameter (or a form field). The
  web-UI keeps it in `localStorage`.
- Keys expire after `login_time` seconds (default 3600). With
  `login_time_reset` on (the default), every request pushes the expiry
  forward again.
- Admin keys only work on `/api/admin/*` and `/api/auth/*`; user keys never
  work on `/api/admin/*`. The admin therefore cannot have reminders.
- The default admin account is `admin` / `admin`.

## 6. Data model

```
users ───────────────┬──────────────┬────────────────┬──────────────────┐
 id, username,       │              │                │                  │
 salt, hash, admin   │              │                │                  │
                     v              v                v                  v
            notification_services  reminders       templates       static_reminders
             id, user_id,          id, user_id,    id, user_id,    id, user_id,
             title, url            title, text,    title, text,    title, text,
                  ^                time, color,    color           color
                  │                repeat_quantity,    ^                ^
                  │                repeat_interval,    │                │
                  │                original_time,      │                │
                  │                weekdays  ^         │                │
                  │                          │         │                │
                  └──────────── reminder_services ─────┴────────────────┘
                                 reminder_id | template_id | static_reminder_id   (one of the three)
                                 notification_service_id
config: key → value  (settings, database_version, *_backup hosting settings)
```

- `reminder_services` is the many-to-many link between anything that sends
  and the services it sends through. Exactly one of the three entry columns
  is set per row. Links cascade on delete of the entry, but a notification
  service that is still linked cannot be deleted (the foreign key forbids
  it; MIND reports `NotificationServiceInUse`).
- `reminders.time` is the next time the reminder fires. For repeating
  reminders, `original_time` is the anchor of the series and `time` is
  recomputed from it. One of the following is set, or neither:
	- `repeat_quantity` (`minutes`, `hours`, `days`, `weeks`, `months`,
	  `years`) plus `repeat_interval` (a positive int);
	- `weekdays`, a comma-separated sorted list of day indexes, Monday = 0.
- `config.value` is a BLOB. Booleans are stored as 0/1 (see
  `settings._format_setting`).

### How the database layer works

- `DBConnection` is a `sqlite3.Connection` subclass with a per-thread
  singleton metaclass (`DB_Singleton`): each thread reuses one connection.
  Foreign keys are switched on for every connection, and the database runs
  in WAL mode.
- `get_db()` returns **one shared cursor per Flask app context**
  (`flask.g.cursor`). `get_db(dict)` sets `row_factory = Row` on that same
  cursor; `get_db()` sets it back to tuples. Calling `get_db()` therefore
  changes the row type for every other user of that cursor (see BUG-04).
- Nothing is committed until the app context ends: `close_db()` (the
  teardown handler) commits. On the main thread it also closes the
  connection; other threads keep theirs.
- Multi-statement writes switch the connection to autocommit
  (`isolation_level = None`) and issue `BEGIN TRANSACTION` / `COMMIT`
  themselves.

## 7. The time model

!!! warning "MIND's timestamps are not plain UTC epochs"
	Server and browser both shift times by their own UTC offsets. The shifts
	only cancel out when **the server's timezone equals the browser's**. That
	is why the installation docs ask you to set `TZ`.

- **"Now" on the server** is `datetime.utcnow().timestamp()`. That reads
  the UTC *wall clock* but converts it to an epoch *as if it were local
  time*. With a server UTC offset of `S` hours, MIND's "now" equals the true
  epoch minus `S` hours.
- **The browser** converts the picked local date-time with
  `new Date(value) / 1000 + getTimezoneOffset() * 60`. With a browser UTC
  offset of `C` hours, this is the true epoch minus `C` hours.
- A reminder therefore fires when `true_now − S = picked − C`, i.e. at
  `picked + (S − C)`. It fires at the right moment only if `S = C`.
- The browser displays times by adding its own offset again, so the list
  always *looks* right, even when the server's timezone is wrong.
- API clients: the API docs say "UTC epoch timestamp". That is only exact
  for a server running in UTC. On a server in UTC+2, send the true epoch
  minus 2 hours.
- Repeats are computed on naive local datetimes (`datetime.fromtimestamp`),
  so a daily 09:00 reminder stays at 09:00 wall-clock time across daylight
  saving changes. This is tested in
  `tests/reminders_extended_test.py::Test_FindNextTime_DST`.

## 8. The scheduler

`ReminderHandler` (a `Singleton`) holds at most one `threading.Timer`
(`self.thread`) and the timestamp it waits for (`self.time`).

- **`find_next_reminder(time)`** is called after adding a reminder. It only
  moves the timer if `time` is earlier than the armed one.
- **`find_next_reminder()`** (no argument) is called after updates and
  deletes (of reminders, notification services with their reminders, and
  users). It looks up the soonest `reminders.time` and makes the timer
  follow it, also when it's *later* than the armed time (the soonest
  reminder was deleted or moved). With no reminders left, the timer is
  stopped.
- Both run under a lock, so requests and the timer thread can't arm two
  timers.
- **`__trigger_reminders(time)`** runs in the timer thread. For every
  reminder whose `time` equals the fired time: collect the Apprise URLs of
  its services, send `title`/`text` (an empty text becomes U+200B, because
  some services reject empty bodies), then delete the reminder (one-off) or
  set `time` to `_find_next_time(original_time, ...)` (repeating). A failure
  in one reminder is logged and doesn't stop the others. Only when the
  whole batch is done, the next timer is armed, always, even when nothing
  matched. If a reminder of the batch couldn't be moved along, the slot is
  retried after 60 seconds instead of in a tight loop. Finally the timer
  thread closes its database connection.
- **`_find_next_time(original, quantity, interval, weekdays)`**:
	- Repeat: the first `original + n × relativedelta(**{quantity:
	  interval})` strictly after now. Always counted from `original`, so a
	  monthly reminder on the 31st fires on the last day of shorter months
	  and returns to the 31st afterwards.
	- Weekdays: if the start date isn't a selected weekday, it moves to the
	  next selected one first. Then it keeps moving to the next selected
	  weekday until strictly after now.

Static reminders and templates don't involve the scheduler. A static
reminder is sent with `POST /api/staticreminders/<id>`.

## 9. Settings, hosting changes and database import

| Key | Default | Notes |
| --- | ------- | ----- |
| `allow_new_accounts` | `true` | The admin can always add users. |
| `login_time` | `3600` | 60 … 2 592 000 seconds. |
| `login_time_reset` | `true` | Extend the expiry on every request. |
| `host` / `port` / `url_prefix` | `0.0.0.0` / `8080` / `""` | Hosting settings: changing them restarts MIND. `url_prefix` is normalised to `""` or `/x`. |
| `log_level` | `20` (INFO) | `10` (DEBUG) also writes `MIND_debug.log`. |
| `database_version` | `10` | Internal. |

**Hosting change safety net.** `PUT /api/admin/settings` with a hosting
value first copies the current values to `host_backup` / `port_backup` /
`url_prefix_backup`, saves the new ones and restarts with the `host_change`
flag. The new process starts a 60-second timer. If the admin logs in within
that minute, the timer is cancelled. Otherwise MIND restores the backups
and restarts again, so a typo can't lock you out.

**Database import** (`POST /api/admin/database`) works the same way: the
upload is validated, the current database is copied to
`db/MIND_original.db`, the upload is copied into the live database and MIND
restarts with the `db_import` flag. Logging in as admin within a minute keeps
the import; otherwise `revert_db_import(swap=True)` copies the original back.
All copies use SQLite's backup API, never file moves, because the database
runs in WAL mode with open connections (see BUG-16).

**Database export** (`GET /api/admin/database`) runs `VACUUM INTO` a
temporary file and streams it as `MIND_<date>.db`.

## 10. The web-UI

- `login.html` + `login.js`: log in or register, then redirect to
  `/reminders` or `/admin` depending on `result.admin`.
- `reminders.html` loads, in order: `general.js` (helpers, `localStorage`,
  `url_prefix`, `api_key`, and a redirect to login without a key),
  `library.js` (the three tabs and search), `window.js` (the add/edit form),
  `templates.js`, `show.js` (opening the form), `notification.js` (services,
  and the Apprise URL builder) and `settings.js` (locale, default service,
  password, delete account).
- `admin.html` + `admin.js`: settings, hosting, users, database
  import/export, restart/shutdown.
- `localStorage['MIND']` holds `api_key`, `locale`, `default_service` and
  the sort order per tab.
- **The Apprise URL builder.** `GET /api/notificationservices/available`
  returns every Apprise service with its URL templates (e.g.
  `{schema}://{botToken}/{targets}`), tokens and arguments, all
  post-processed by `get_apprise_services()`: tokens are sorted
  required-first, list tokens are grouped, and Python named groups are
  stripped from regexes for JavaScript. The UI renders a form, collects the
  values by `map_to`, picks the first template whose placeholders exactly
  match the filled tokens and adds the advanced arguments as a query string.

## 11. Testing

```bash
pip install -r requirements.txt
mkdir -p db
python3 -m unittest discover -s ./tests -p '*.py'
```

The suite has about 500 tests, runs in about 30 seconds and passes on
Python 3.8 to 3.13. With Playwright installed, 32 browser tests run as well
(about one more minute):

```bash
pip install playwright && python3 -m playwright install chromium
python3 -m unittest discover -s ./tests -p '*.py'
# or skip them: MIND_SKIP_BROWSER_TESTS=1 python3 -m unittest ...
```

| File | What it covers |
| ---- | -------------- |
| `_harness.py` | Shared base class and helpers (not a test file). |
| `_legacy_schemas.py` | Frozen schemas of database versions 1–7, for migration tests. |
| `helpers_extended_test.py` | Helpers, enums, sorting, hashing, logging. |
| `settings_test.py` | Setting validation, storage, hosting backups, manifest. |
| `db_migration_test.py` | Connections, schema, migrations from every old version, import/export. |
| `users_extended_test.py` | Usernames, registration, login, password, account deletion. |
| `notification_services_test.py` | Services, "in use" protection, the Apprise catalogue. |
| `reminders_extended_test.py` | Repeat/weekday math, the reminder library, the scheduler (fake and real time). |
| `library_test.py` | Templates and static reminders. |
| `input_validation_test.py` | Every input variable, the API docs registry, request parsing. |
| `api_endpoints_test.py` | Every endpoint end-to-end via Flask's test client. |
| `frontend_static_test.py` | JS ↔ API consistency (endpoints, error names), templates. |
| `browser_e2e_test.py` | The real web-UI in headless Chromium against MIND's waitress server (Playwright). Skipped without Playwright. |
| `*_test.py` (older) | The original tests. |

**`MindTestCase`** (in `_harness.py`) gives every test:

- a fresh SQLite database in a temp dir (`setup_db()` already run; set
  `SETUP_DB = False` to skip);
- a fresh Flask app (`self.app`, `self.client`) and `ReminderHandler`
  (`self.handler`);
- `FakeApprise` in place of Apprise: everything "sent" is recorded in
  `RECORDER.sent`;
- mocks for `SERVER.restart` / `SERVER.shutdown` and the manifest writer;
- helpers: `self.ctx()` (an app context that commits on exit),
  `self.sql()`, `self.api()`, `self.login()`, `self.user_key()`,
  `self.add_service()`, `self.add_reminder()`, `assertApiError()`;
- production-like error handling: crashes become MIND's JSON 500 and are
  captured in `self.server_errors`.

For the scheduler, patch `backend.reminders.datetime` with
`MindClock(...).datetime` and `backend.reminders.Timer` with `FakeTimer`.
Then call `timer.fire()` to run a trigger synchronously, on a separate
thread like a real Timer.

**`@known_bug('BUG-NN')`** marks a test that reproduces a bug from the list
below. It describes the correct behaviour and is an expected failure. When
the bug is fixed, the test passes, unittest reports an "unexpected
success" (which fails the run), and you remove the marker.

## 12. Known bugs

Found during the audit. Each had at least one reproducing test, marked
`@known_bug`. **All 16 are fixed**, and those tests now guard against
regressions (search for the bug ID in `tests/` to find them).

### BUG-01 — The scheduler stops for good after the soonest reminder is deleted or moved later

*Severity: high. Status: fixed.* `backend/reminders.py`, `find_next_reminder` and
`__trigger_reminders`.

When the soonest reminder is deleted or moved to a later time, the timer
stays armed for the old time, because later times never replace the armed
timer. When that timer fires, no reminder has that time. The loop body,
which is the only place that resets `self.thread` / `self.time` and calls
`find_next_reminder()`, never runs. From then on `self.time` holds a past
timestamp and nothing re-arms the timer, because every real reminder is
later than it. **No reminder is ever sent again until MIND restarts.**

*Reproduce:* add reminders A (in 1 min) and B (in 2 min) and delete A. B
never arrives. Tests: `Test_Scheduler.test_deleting_soonest_reminder_keeps_schedule_alive`
and the real-time `Test_Scheduler_RealTime.test_deleted_soonest_does_not_stall`.

*Fix:* in `__trigger_reminders`, always clear `self.thread` / `self.time`
and call `find_next_reminder()` after processing, even when no reminder
matched. Better still, let deletes and later times re-arm the timer when
they affect the armed reminder.

### BUG-02 — Users can link other users' notification services

*Severity: high (security). Status: fixed.* `Reminder.update`, `Templates.add` / `Template.update`,
`StaticReminders.add` / `StaticReminder.update`.

Only `Reminders.add` and `test_reminder` check that a notification service
belongs to the user. The other paths only rely on the foreign key, which
merely checks that the ID exists. A user can attach someone else's service
by ID (IDs are sequential). The reminder is then sent through the victim's
service (their Telegram bot, mailbox, ...), and the victim can no longer
delete their own service, or deletes the attacker's entries with it.

*Reproduce:* `PUT /api/reminders/<own id>` with
`notification_services: [<another user's service id>]`, then trigger it.
Tests: `test_update_with_service_of_other_user`,
`test_add_with_service_of_other_user`,
`test_trigger_never_uses_other_users_services`,
`test_cannot_attach_other_users_service_on_update`.

*Fix:* check ownership (`notification_services.user_id = ?`) before linking,
in one shared helper.

### BUG-03 — A failed save still writes part of the change

*Severity: medium. Status: fixed.* Same functions as BUG-02.

When linking fails (`IntegrityError` → `NotificationServiceNotFound`), the
open transaction is neither rolled back nor finished. The teardown's
`commit()` then saves what was already done:

- `Templates.add` / `StaticReminders.add`: the entry is created **without
  services**, even though the API answered 404.
- `*.update`: the other field changes are kept, and the existing service
  links are **deleted**.

Tests: `test_add_unknown_service_creates_nothing`,
`test_failed_update_changes_nothing` (in both `library_test.py` and
`reminders_extended_test.py`).

*Fix:* validate the service IDs before writing anything, and `ROLLBACK` on
failure.

### BUG-04 — Reminders at the same time crash the trigger or are sent twice

*Severity: medium. Status: fixed.* `ReminderHandler.__trigger_reminders`.

Two separate problems, both when several reminders share a timestamp (for
example two users who both picked 09:00):

1. Deleting a one-off reminder calls `get_db()`, which switches the shared
   cursor back to tuples. The next reminder's `url['url']` then raises
   `TypeError`, and the trigger thread dies.
2. After the first reminder, `find_next_reminder()` sees the rest of the
   batch still at the same timestamp and starts a new timer for it. Because
   `self.thread` was set to `None` just before, the duplicate timer is never
   cancelled. It fires immediately in a second thread and sends the
   remaining reminders again.

The two problems partly mask each other in production, but which outcome
you get depends on the order of the batch: a crash, or a double send.
Tests: `test_same_time_one_offs_are_all_sent_once`,
`test_same_time_batch_does_not_rearm_for_itself`,
`test_reminders_of_different_users_at_same_time`,
`Test_Scheduler_RealTime.test_same_time_batch_is_not_sent_twice`.

*Fix:* collect the URLs with their own cursor/rows (or `get_db(dict)`
before each use), and arm the next timer once, after the whole batch.

### BUG-05 — Monthly and yearly repeats drift

*Severity: medium. Status: fixed.* `_find_next_time`, the `while new_time <= current_time:
new_time += td` loop.

Adding one month at a time clamps and then stays clamped: Jan 31 → Feb 28 →
Mar 28 → Apr 28 … A reminder "every month on the 31st" fires on the 28th
from March on. Yearly reminders on Feb 29 move to Feb 28 for good.

Tests: `test_month_end_does_not_drift`, `test_leap_day_yearly_does_not_drift`.

*Fix:* compute `original + n × delta` for increasing `n` instead of
accumulating.

### BUG-06 — Weekday repeats skip the first occurrence

*Severity: low. Status: fixed.* `_find_next_time`, `one_to_go = True`.

The weekday loop always moves at least one step, even when the chosen
start date is itself one of the selected weekdays. "Every day, starting
today at 09:00" first fires tomorrow; "Wednesdays, starting this
Wednesday" first fires next week.

Tests: `test_first_occurrence_on_selected_day_is_kept`,
`test_every_day_starting_today_fires_today`.

*Fix:* only force the first step when the start date isn't a selected
weekday.

### BUG-07 — Databases from version 5 or older can't be migrated

*Severity: high. Status: fixed.* `backend/db.py`, migration V5 → V6.

The step removes the old default account with `User('User1',
'Password1').delete()`, but `User.__init__` now takes a single user ID. The
upgrade crashes with `TypeError`. Every earlier step has already been
committed, so the database is left half-migrated, and the next start
re-runs steps on it (e.g. `ALTER TABLE ... ADD color` fails as a duplicate).
`User()` couldn't be used here anyway: it reads the `admin` column, which
only exists from V8.

Every installation still running a release from before July 2023
(database versions 1–5) is affected. Tests: `Test_Migration.test_migrate_from_v1` … `v5`, which
build a database exactly as those releases left it.

*Fix:* delete `User1` (after checking the password hash) and its data with
plain SQL in the migration.

### BUG-08 — Importing a non-SQLite file crashes

*Severity: medium. Status: fixed.* `backend/db.py`, `import_db`.

Only `OperationalError` is caught. A file that isn't a database raises
`sqlite3.DatabaseError` (its parent class), and a `config` table without a
`database_version` row raises `TypeError`. The admin gets a 500 instead of
`InvalidDatabaseFile`, and the upload and its connection are left open.
Tests: `test_import_non_sqlite_file_rejected`,
`test_import_without_version_row_rejected`, `test_upload_garbage_file`.

*Fix:* catch `sqlite3.DatabaseError` and a missing row, and always close the
connection.

### BUG-09 — Wrong upload type reports the wrong error

*Severity: low. Status: fixed.* `frontend/input_validation.py`, `input_validation()`.

`noted_var.__class__.__name__ == DatabaseFileVariable.__name__` compares
the *metaclass* name (`ABCMeta`), so the branch never runs. Uploading
`backup.txt` returns `InvalidKeyValue` instead of `InvalidDatabaseFile`.
Tests: `test_wrong_file_type_is_invalid_database_file`,
`test_upload_wrong_extension`.

*Fix:* `if noted_var is DatabaseFileVariable` (or `issubclass`).

### BUG-10 — Color validation accepts more than a color

*Severity: low. Status: fixed.* `color_regex = compile(r'#[0-9a-f]{6}')` used with
`.search()`.

The pattern isn't anchored, so `#abcdef00`, `x#abcdef` and
`#abcdef;background:url(...)` all pass and are stored. The value ends up in
an inline CSS custom property in the web-UI.
Test: `test_color_must_be_exactly_one_hex_code`.

*Fix:* use `fullmatch`.

### BUG-11 — The frontend checks for error names that don't exist

*Severity: low. Status: fixed.* `admin.js` (lines 82, 122) and `notification.js` (line 174)
compare against `ApiKeyInvalid` / `ApiKeyExpired`. The API sends
`APIKeyInvalid` / `APIKeyExpired`, so an expired session in those places
doesn't send you back to the login page.
Test: `test_frontend_only_checks_for_existing_errors` (it checks every
error name the JS compares against).

### BUG-12 — The library search query isn't URL-encoded

*Severity: low. Status: fixed.* `library.js` line 109: `&query=${query}`.

Searching for `a&b`, `50%` or `#1` sends a broken query (`&` starts a new
parameter, `#` cuts the URL).
Test: `test_search_query_is_url_encoded`.

*Fix:* `encodeURIComponent(query)`.

### BUG-13 — `NaN` / `Infinity` times crash

*Severity: low. Status: fixed.* Python's JSON parser accepts `NaN` and `Infinity`.
`TimeVariable` accepts any float, and `round(nan)` then raises, giving a
500. Tests: `test_time_rejects_non_finite`,
`test_non_finite_time_is_rejected`.

*Fix:* require `math.isfinite`.

### BUG-14 — Deleting an account leaves its other sessions alive

*Severity: medium. Status: fixed.* `frontend/api.py`, `api_manage_user` (DELETE) and
`api_admin_user` (DELETE).

Self-deletion only removes the API key that made the request. Admin
deletion removes only the *first* key of that user (`break`). Other keys
keep working: reads return empty lists, and writes crash with an
`IntegrityError` (500) because the user no longer exists.
Tests: `test_delete_account_invalidates_all_sessions`,
`test_admin_delete_user_invalidates_all_sessions`.

*Fix:* remove every entry whose `user_data.user_id` matches.

### BUG-15 — The "add notification service" list crashes with current Apprise

*Severity: high. Status: fixed.* `backend/notification_service.py`,
`get_apprise_services()`.

`requirements.txt` allows `apprise~=1.4`, i.e. any 1.x. Newer versions
(seen with 1.13) use `frozenset`s for some choice values (e.g. Pingram's
`mode`). They are passed through to Flask's JSON encoder unchanged, so
`GET /api/notificationservices/available` returns 500, and the UI can't
list any service to add. Only the "Custom URL" route keeps working.
Test: `test_frozenset_choices_are_serialisable`.

*Fix:* convert `values` to a list.

### BUG-16 — Database import moves the file without its WAL files

*Severity: high. Status: fixed.* `backend/db.py`, `import_db` / `revert_db_import`.

The database runs in WAL mode, so recent writes live in `MIND.db-wal`, and
`MIND.db-shm` indexes them. The import renames only the main files while
connections are still open:

- The current database becomes `MIND_original.db`, but its `-wal`/`-shm`
  stay behind as `MIND.db-wal`/`-shm`, now paired with the *imported*
  file. SQLite then applies the old database's pages to the imported one.
  In the test, a few requests served during the one-second restart window
  were enough for the imported data to disappear from `MIND.db`. SQLite
  lists this mispairing as a way to corrupt a database.
- On Python 3.11 the import connection isn't really closed (an unfinished
  statement keeps it alive), so its own write, the copied hosting settings,
  stays in `MIND_upload.db-wal` and is lost: "Keep Hosting Settings" is
  silently ignored.

Tests: `test_import_survives_writes_during_restart_window`,
`test_import_copies_hosting_settings` (Python 3.11),
`test_import_leaves_no_stray_upload_files` (Python 3.11).

*Fix:* don't move live database files. Copy with SQLite's backup API
(`Connection.backup`): back up the live database to `MIND_original.db`,
then back up the upload into the live database. Revert the same way.

## 13. Smaller findings and observations

Not bugs as such, but worth knowing.

- **`BaseEnum` members are unhashable.** Overriding `__eq__` without
  `__hash__` sets `__hash__` to `None`, so sorting methods and repeat
  quantities can't be used in sets or as dict keys.
- **Timer threads didn't close their database connection** (fixed). Every
  trigger runs in a new thread with its own connection. The leak was
  bounded only because the OS reuses thread IDs, which happen to be the
  cache key.
- **`set_log_level(DEBUG)` leaked a file handle** each time (fixed):
  `setStream()` returns the previous stream, which was never closed.
- **One Apprise template can't be built from the UI.** ntfy's
  `{schema}://{topic}`: `topic` is folded into the `targets` list token, so
  the form never offers it by itself. Its other templates work.
- **`GET /api/settings` needs no login** and shows the hosting settings and
  log level. The login page only needs `allow_new_accounts`.
- **API keys travel in the URL**, so they end up in proxy and access logs.
  There is no rate limiting on login, and the default admin password is
  `admin`. Change it right after installing.
- **PUT semantics.** Updating a reminder/template/static reminder clears
  `color` (and `text`, which defaults to `""`) when they're omitted, and a
  reminder loses its repetition when the repeat fields are omitted. The
  web-UI always sends everything, so it's only visible to API users.
- **`weekdays` accepts duplicates** (`[1, 1]` is stored as `"1,1"`).
  Harmless.
- **The log line in `Reminder.update`** said "Updating notification
  service" instead of "Updating reminder" (fixed).
- **"Works cross-timezone" (README)** only holds when the server's `TZ`
  matches the users' timezone, see [section 7](#7-the-time-model).

## 14. Migration history

| Version | Introduced by (release) | Change |
| ------: | ----------------------- | ------ |
| 1 | Jan 2023 | First version with a version number. Times stored as local time. |
| 2 | Jan 2023 (V1.0.1) | Times converted to UTC (`time − utc_offset`), for cross-timezone clients. |
| 3 | Jan 2023 | `color` on reminders and templates. |
| 4 | Mar 2023 | Repeat quantities made plural (`day` → `days`). |
| 5 | May 2023 | `reminder_services` link table: multiple services per entry. Static reminders. |
| 6 | Jun 2023 | Remove the default `User1` account (the migration step that fails, BUG-07). |
| 7 | Jul 2023 (V1.3.3) | `weekdays` on reminders. |
| 8 | Jan 2024 | Admin account and admin settings; config values become BLOBs. |
| 9 | Feb 2024 | Hosting settings move from `MIND.py` into the database. |
| 10 | Mar 2024 (V1.4.0) | Rewrite the PWA manifest for the URL prefix. |
