CREATE TABLE `text_me_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `text_me_requests_status_idx` ON `text_me_requests` (`status`);
--> statement-breakpoint
CREATE INDEX `text_me_requests_phone_idx` ON `text_me_requests` (`phone`);
