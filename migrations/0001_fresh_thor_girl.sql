PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_nutrition_days` (
	`user_email` text DEFAULT '' NOT NULL,
	`date` text NOT NULL,
	`kcal` integer,
	`protein_g` integer,
	`hit_protein` integer,
	`adherence` text,
	PRIMARY KEY(`user_email`, `date`)
);
--> statement-breakpoint
INSERT INTO `__new_nutrition_days`("user_email", "date", "kcal", "protein_g", "hit_protein", "adherence") SELECT '', "date", "kcal", "protein_g", "hit_protein", "adherence" FROM `nutrition_days`;--> statement-breakpoint
DROP TABLE `nutrition_days`;--> statement-breakpoint
ALTER TABLE `__new_nutrition_days` RENAME TO `nutrition_days`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `ingest_tokens` ADD `user_email` text;--> statement-breakpoint
ALTER TABLE `measurements` ADD `user_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `photos` ADD `user_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `targets` ADD `user_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `targets_user_email_unique` ON `targets` (`user_email`);--> statement-breakpoint
ALTER TABLE `weight_readings` ADD `user_email` text DEFAULT '' NOT NULL;