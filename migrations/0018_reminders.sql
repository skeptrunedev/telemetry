ALTER TABLE `text_me_requests` ADD COLUMN `message` text;
--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`instruction` text NOT NULL,
	`hour` integer NOT NULL,
	`minute` integer NOT NULL,
	`days` text DEFAULT 'daily' NOT NULL,
	`once_date` text,
	`tz` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`next_fire_at` integer NOT NULL,
	`last_sent_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reminders_user_idx` ON `reminders` (`user_email`);
--> statement-breakpoint
CREATE INDEX `reminders_next_fire_idx` ON `reminders` (`enabled`,`next_fire_at`);
