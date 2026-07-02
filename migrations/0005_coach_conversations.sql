CREATE TABLE `coach_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text DEFAULT '' NOT NULL,
	`title` text DEFAULT 'New chat' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `coach_conversations_user_idx` ON `coach_conversations` (`user_email`);
--> statement-breakpoint
CREATE TABLE `coach_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `coach_messages_conversation_idx` ON `coach_messages` (`conversation_id`);
