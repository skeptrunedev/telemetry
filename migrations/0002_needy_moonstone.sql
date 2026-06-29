CREATE TABLE `meals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text DEFAULT '' NOT NULL,
	`date` text NOT NULL,
	`note` text,
	`photo_keys` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `nutrition_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_email` text DEFAULT '' NOT NULL,
	`meal_id` text,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`kcal` integer NOT NULL,
	`protein_g` real NOT NULL,
	`source` text DEFAULT 'ai' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
