CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`scopes` text DEFAULT '["*"]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE INDEX `api_keys_token_hash_idx` ON `api_keys` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `api_keys_user_idx` ON `api_keys` (`user_email`);
