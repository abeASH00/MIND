#-*- coding: utf-8 -*-

"""
Frozen copies of the database schemas of older MIND releases.

Each schema is the exact `CREATE TABLE` script that `setup_db()` ran in the
commit noted next to it, copied out of the git history, so that migrations can
be tested against databases as real users have them, without needing git at
test time.

`config.value` was TEXT up to V7 and the database version was stored as text.
From V8 on, `config.value` is a BLOB and the settings are stored natively.
"""

from typing import Dict

# Database version 1: last commit with database version 1 (f4436c9)
SCHEMA_V1 = """
		CREATE TABLE IF NOT EXISTS users(
			id INTEGER PRIMARY KEY,
			username VARCHAR(255) UNIQUE NOT NULL,
			salt VARCHAR(40) NOT NULL,
			hash VARCHAR(100) NOT NULL
		);
		CREATE TABLE IF NOT EXISTS notification_services(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255),
			url TEXT,

			FOREIGN KEY (user_id) REFERENCES users(id)
		);
		CREATE TABLE IF NOT EXISTS reminders(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255) NOT NULL,
			text TEXT,
			time INTEGER NOT NULL,
			notification_service INTEGER NOT NULL,

			repeat_quantity VARCHAR(15),
			repeat_interval INTEGER,
			original_time INTEGER,

			FOREIGN KEY (user_id) REFERENCES users(id),
			FOREIGN KEY (notification_service) REFERENCES notification_services(id)
		);
		CREATE TABLE IF NOT EXISTS templates(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255) NOT NULL,
			text TEXT,
			notification_service INTEGER NOT NULL,

			FOREIGN KEY (user_id) REFERENCES users(id),
			FOREIGN KEY (notification_service) REFERENCES notification_services(id)
		);
		CREATE TABLE IF NOT EXISTS config(
			key VARCHAR(255) PRIMARY KEY,
			value TEXT NOT NULL
		);
"""

# Database version 2: release V1.0.1 (d1d39a9)
SCHEMA_V2 = """
		CREATE TABLE IF NOT EXISTS users(
			id INTEGER PRIMARY KEY,
			username VARCHAR(255) UNIQUE NOT NULL,
			salt VARCHAR(40) NOT NULL,
			hash VARCHAR(100) NOT NULL
		);
		CREATE TABLE IF NOT EXISTS notification_services(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255),
			url TEXT,

			FOREIGN KEY (user_id) REFERENCES users(id)
		);
		CREATE TABLE IF NOT EXISTS reminders(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255) NOT NULL,
			text TEXT,
			time INTEGER NOT NULL,
			notification_service INTEGER NOT NULL,

			repeat_quantity VARCHAR(15),
			repeat_interval INTEGER,
			original_time INTEGER,

			FOREIGN KEY (user_id) REFERENCES users(id),
			FOREIGN KEY (notification_service) REFERENCES notification_services(id)
		);
		CREATE TABLE IF NOT EXISTS templates(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255) NOT NULL,
			text TEXT,
			notification_service INTEGER NOT NULL,

			FOREIGN KEY (user_id) REFERENCES users(id),
			FOREIGN KEY (notification_service) REFERENCES notification_services(id)
		);
		CREATE TABLE IF NOT EXISTS config(
			key VARCHAR(255) PRIMARY KEY,
			value TEXT NOT NULL
		);
"""

# Database version 3: release merge #35 (73e8935)
SCHEMA_V3 = """
		CREATE TABLE IF NOT EXISTS users(
			id INTEGER PRIMARY KEY,
			username VARCHAR(255) UNIQUE NOT NULL,
			salt VARCHAR(40) NOT NULL,
			hash VARCHAR(100) NOT NULL
		);
		CREATE TABLE IF NOT EXISTS notification_services(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255),
			url TEXT,

			FOREIGN KEY (user_id) REFERENCES users(id)
		);
		CREATE TABLE IF NOT EXISTS reminders(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255) NOT NULL,
			text TEXT,
			time INTEGER NOT NULL,
			notification_service INTEGER NOT NULL,

			repeat_quantity VARCHAR(15),
			repeat_interval INTEGER,
			original_time INTEGER,

			color VARCHAR(7),

			FOREIGN KEY (user_id) REFERENCES users(id),
			FOREIGN KEY (notification_service) REFERENCES notification_services(id)
		);
		CREATE TABLE IF NOT EXISTS templates(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255) NOT NULL,
			text TEXT,
			notification_service INTEGER NOT NULL,

			color VARCHAR(7),

			FOREIGN KEY (user_id) REFERENCES users(id),
			FOREIGN KEY (notification_service) REFERENCES notification_services(id)
		);
		CREATE TABLE IF NOT EXISTS config(
			key VARCHAR(255) PRIMARY KEY,
			value TEXT NOT NULL
		);
"""

# Database version 4: release merge #45 (29449c1)
SCHEMA_V4 = """
		CREATE TABLE IF NOT EXISTS users(
			id INTEGER PRIMARY KEY,
			username VARCHAR(255) UNIQUE NOT NULL,
			salt VARCHAR(40) NOT NULL,
			hash VARCHAR(100) NOT NULL
		);
		CREATE TABLE IF NOT EXISTS notification_services(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255),
			url TEXT,

			FOREIGN KEY (user_id) REFERENCES users(id)
		);
		CREATE TABLE IF NOT EXISTS reminders(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255) NOT NULL,
			text TEXT,
			time INTEGER NOT NULL,
			notification_service INTEGER NOT NULL,

			repeat_quantity VARCHAR(15),
			repeat_interval INTEGER,
			original_time INTEGER,

			color VARCHAR(7),

			FOREIGN KEY (user_id) REFERENCES users(id),
			FOREIGN KEY (notification_service) REFERENCES notification_services(id)
		);
		CREATE TABLE IF NOT EXISTS templates(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255) NOT NULL,
			text TEXT,
			notification_service INTEGER NOT NULL,

			color VARCHAR(7),

			FOREIGN KEY (user_id) REFERENCES users(id),
			FOREIGN KEY (notification_service) REFERENCES notification_services(id)
		);
		CREATE TABLE IF NOT EXISTS config(
			key VARCHAR(255) PRIMARY KEY,
			value TEXT NOT NULL
		);
"""

# Database version 5: release merge #52 (3efb08c)
SCHEMA_V5 = """
		CREATE TABLE IF NOT EXISTS users(
			id INTEGER PRIMARY KEY,
			username VARCHAR(255) UNIQUE NOT NULL,
			salt VARCHAR(40) NOT NULL,
			hash VARCHAR(100) NOT NULL
		);
		CREATE TABLE IF NOT EXISTS notification_services(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255),
			url TEXT,

			FOREIGN KEY (user_id) REFERENCES users(id)
		);
		CREATE TABLE IF NOT EXISTS reminders(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255) NOT NULL,
			text TEXT,
			time INTEGER NOT NULL,

			repeat_quantity VARCHAR(15),
			repeat_interval INTEGER,
			original_time INTEGER,

			color VARCHAR(7),

			FOREIGN KEY (user_id) REFERENCES users(id)
		);
		CREATE TABLE IF NOT EXISTS templates(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255) NOT NULL,
			text TEXT,

			color VARCHAR(7),

			FOREIGN KEY (user_id) REFERENCES users(id)
		);
		CREATE TABLE IF NOT EXISTS static_reminders(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255) NOT NULL,
			text TEXT,

			color VARCHAR(7),

			FOREIGN KEY (user_id) REFERENCES users(id)
		);
		CREATE TABLE IF NOT EXISTS reminder_services(
			reminder_id INTEGER,
			static_reminder_id INTEGER,
			template_id INTEGER,
			notification_service_id INTEGER NOT NULL,

			FOREIGN KEY (reminder_id) REFERENCES reminders(id)
				ON DELETE CASCADE,
			FOREIGN KEY (static_reminder_id) REFERENCES static_reminders(id)
				ON DELETE CASCADE,
			FOREIGN KEY (template_id) REFERENCES templates(id)
				ON DELETE CASCADE,
			FOREIGN KEY (notification_service_id) REFERENCES notification_services(id)
		);
		CREATE TABLE IF NOT EXISTS config(
			key VARCHAR(255) PRIMARY KEY,
			value TEXT NOT NULL
		);
"""

# Database version 6: release merge #54 (9b86b56)
SCHEMA_V6 = """
		CREATE TABLE IF NOT EXISTS users(
			id INTEGER PRIMARY KEY,
			username VARCHAR(255) UNIQUE NOT NULL,
			salt VARCHAR(40) NOT NULL,
			hash VARCHAR(100) NOT NULL
		);
		CREATE TABLE IF NOT EXISTS notification_services(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255),
			url TEXT,

			FOREIGN KEY (user_id) REFERENCES users(id)
		);
		CREATE TABLE IF NOT EXISTS reminders(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255) NOT NULL,
			text TEXT,
			time INTEGER NOT NULL,

			repeat_quantity VARCHAR(15),
			repeat_interval INTEGER,
			original_time INTEGER,

			color VARCHAR(7),

			FOREIGN KEY (user_id) REFERENCES users(id)
		);
		CREATE TABLE IF NOT EXISTS templates(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255) NOT NULL,
			text TEXT,

			color VARCHAR(7),

			FOREIGN KEY (user_id) REFERENCES users(id)
		);
		CREATE TABLE IF NOT EXISTS static_reminders(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255) NOT NULL,
			text TEXT,

			color VARCHAR(7),

			FOREIGN KEY (user_id) REFERENCES users(id)
		);
		CREATE TABLE IF NOT EXISTS reminder_services(
			reminder_id INTEGER,
			static_reminder_id INTEGER,
			template_id INTEGER,
			notification_service_id INTEGER NOT NULL,

			FOREIGN KEY (reminder_id) REFERENCES reminders(id)
				ON DELETE CASCADE,
			FOREIGN KEY (static_reminder_id) REFERENCES static_reminders(id)
				ON DELETE CASCADE,
			FOREIGN KEY (template_id) REFERENCES templates(id)
				ON DELETE CASCADE,
			FOREIGN KEY (notification_service_id) REFERENCES notification_services(id)
		);
		CREATE TABLE IF NOT EXISTS config(
			key VARCHAR(255) PRIMARY KEY,
			value TEXT NOT NULL
		);
"""

# Database version 7: release V1.3.3 (94c48f4)
SCHEMA_V7 = """
		CREATE TABLE IF NOT EXISTS users(
			id INTEGER PRIMARY KEY,
			username VARCHAR(255) UNIQUE NOT NULL,
			salt VARCHAR(40) NOT NULL,
			hash VARCHAR(100) NOT NULL
		);
		CREATE TABLE IF NOT EXISTS notification_services(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255),
			url TEXT,

			FOREIGN KEY (user_id) REFERENCES users(id)
		);
		CREATE TABLE IF NOT EXISTS reminders(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255) NOT NULL,
			text TEXT,
			time INTEGER NOT NULL,

			repeat_quantity VARCHAR(15),
			repeat_interval INTEGER,
			original_time INTEGER,
			weekdays VARCHAR(13),

			color VARCHAR(7),

			FOREIGN KEY (user_id) REFERENCES users(id)
		);
		CREATE TABLE IF NOT EXISTS templates(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255) NOT NULL,
			text TEXT,

			color VARCHAR(7),

			FOREIGN KEY (user_id) REFERENCES users(id)
		);
		CREATE TABLE IF NOT EXISTS static_reminders(
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			title VARCHAR(255) NOT NULL,
			text TEXT,

			color VARCHAR(7),

			FOREIGN KEY (user_id) REFERENCES users(id)
		);
		CREATE TABLE IF NOT EXISTS reminder_services(
			reminder_id INTEGER,
			static_reminder_id INTEGER,
			template_id INTEGER,
			notification_service_id INTEGER NOT NULL,

			FOREIGN KEY (reminder_id) REFERENCES reminders(id)
				ON DELETE CASCADE,
			FOREIGN KEY (static_reminder_id) REFERENCES static_reminders(id)
				ON DELETE CASCADE,
			FOREIGN KEY (template_id) REFERENCES templates(id)
				ON DELETE CASCADE,
			FOREIGN KEY (notification_service_id) REFERENCES notification_services(id)
		);
		CREATE TABLE IF NOT EXISTS config(
			key VARCHAR(255) PRIMARY KEY,
			value TEXT NOT NULL
		);
"""

LEGACY_SCHEMAS: Dict[int, str] = {
	1: SCHEMA_V1,
	2: SCHEMA_V2,
	3: SCHEMA_V3,
	4: SCHEMA_V4,
	5: SCHEMA_V5,
	6: SCHEMA_V6,
	7: SCHEMA_V7,
}

# Which tables carried a single `notification_service` column before the
# many-to-many `reminder_services` table was introduced in V5.
SINGLE_SERVICE_TABLES: Dict[int, tuple] = {
	1: ('reminders', 'templates'),
	2: ('reminders', 'templates'),
	3: ('reminders', 'templates'),
	4: ('reminders', 'templates'),
	5: (),
	6: (),
	7: (),
}
