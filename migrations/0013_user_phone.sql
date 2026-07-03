ALTER TABLE `user` ADD COLUMN `phone_number` text;
--> statement-breakpoint
ALTER TABLE `user` ADD COLUMN `phone_number_verified` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX `user_phone_number_unique` ON `user` (`phone_number`);
