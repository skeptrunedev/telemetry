CREATE TABLE `linked_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`verified_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `linked_channels_user_idx` ON `linked_channels` (`user_email`);
--> statement-breakpoint
CREATE UNIQUE INDEX `linked_channels_value_idx` ON `linked_channels` (`kind`,`value`);
