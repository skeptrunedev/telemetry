CREATE TABLE `agent_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`messages` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_threads_phone_idx` ON `agent_threads` (`phone`);
