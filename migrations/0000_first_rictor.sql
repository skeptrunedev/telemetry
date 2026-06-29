CREATE TABLE `ingest_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`label` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `measurements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`site` text NOT NULL,
	`value_cm` real NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `nutrition_days` (
	`date` text PRIMARY KEY NOT NULL,
	`kcal` integer,
	`protein_g` integer,
	`hit_protein` integer,
	`adherence` text
);
--> statement-breakpoint
CREATE TABLE `photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`r2_key` text NOT NULL,
	`pose` text,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`goal_weight_kg` real,
	`target_date` integer,
	`start_weight_kg` real,
	`start_date` integer,
	`daily_kcal_target` integer DEFAULT 1850,
	`protein_target_g` integer DEFAULT 160
);
--> statement-breakpoint
CREATE TABLE `weight_readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`weight_kg` real NOT NULL,
	`body_fat_pct` real,
	`source` text DEFAULT 'manual' NOT NULL,
	`raw_payload` text
);
