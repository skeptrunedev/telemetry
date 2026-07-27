-- Add `source` to billing and widen the primary key to (user_email, source) so
-- an Apple StoreKit subscription and a Stripe subscription can coexist on one
-- account instead of overwriting each other. Every existing row is Stripe.
--
-- SQLite cannot widen a primary key in place, so the table is rebuilt. No
-- foreign keys point at billing, so no PRAGMA dance is needed.
CREATE TABLE `__new_billing` (
	`user_email` text NOT NULL,
	`source` text DEFAULT 'stripe' NOT NULL,
	`stripe_customer_id` text,
	`subscription_id` text,
	`status` text,
	`current_period_end` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`user_email`, `source`)
);
--> statement-breakpoint
INSERT INTO `__new_billing` (`user_email`, `source`, `stripe_customer_id`, `subscription_id`, `status`, `current_period_end`, `updated_at`) SELECT `user_email`, 'stripe', `stripe_customer_id`, `subscription_id`, `status`, `current_period_end`, `updated_at` FROM `billing`;
--> statement-breakpoint
DROP TABLE `billing`;
--> statement-breakpoint
ALTER TABLE `__new_billing` RENAME TO `billing`;
--> statement-breakpoint
CREATE INDEX `billing_customer_idx` ON `billing` (`stripe_customer_id`);
--> statement-breakpoint
CREATE INDEX `billing_subscription_idx` ON `billing` (`subscription_id`);
