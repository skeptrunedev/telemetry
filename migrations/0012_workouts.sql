CREATE TABLE `workouts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`external_id` text,
	`activity_type` text,
	`summary` text NOT NULL,
	`description` text NOT NULL,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`duration_s` integer,
	`moving_duration_s` integer,
	`distance_m` real,
	`elevation_gain_m` real,
	`energy_kcal` real,
	`avg_hr` integer,
	`max_hr` integer,
	`avg_power_w` real,
	`avg_cadence` real,
	`details` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workouts_user_idx` ON `workouts` (`user_email`);
--> statement-breakpoint
CREATE INDEX `workouts_user_started_idx` ON `workouts` (`user_email`,`started_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `workouts_source_external_idx` ON `workouts` (`source`,`external_id`);
