CREATE TABLE `agent_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_memories_user_idx` ON `agent_memories` (`user_email`);
