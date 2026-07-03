CREATE TABLE `billing` (
	`user_email` text PRIMARY KEY NOT NULL,
	`stripe_customer_id` text,
	`subscription_id` text,
	`status` text,
	`current_period_end` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `billing_customer_idx` ON `billing` (`stripe_customer_id`);
--> statement-breakpoint
CREATE INDEX `billing_subscription_idx` ON `billing` (`subscription_id`);
