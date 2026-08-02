PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_public_profile` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`union_id` text NOT NULL,
	`slug` text NOT NULL,
	`slug_source` text DEFAULT 'email' NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`avatar_url` text DEFAULT '' NOT NULL,
	`bio` text,
	`visibility_mode` text DEFAULT 'semi_public' NOT NULL,
	`show_branding` integer DEFAULT 1 NOT NULL,
	`social_links` text,
	`website_url` text DEFAULT '' NOT NULL,
	`theme_key` text DEFAULT 'default' NOT NULL,
	`status` integer DEFAULT 97 NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_public_profile`("id", "project_id", "union_id", "slug", "slug_source", "display_name", "avatar_url", "bio", "visibility_mode", "show_branding", "social_links", "website_url", "theme_key", "status", "created_at", "updated_at") SELECT "id", "project_id", "union_id", "slug", "slug_source", "display_name", "avatar_url", "bio", "visibility_mode", "show_branding", "social_links", "website_url", "theme_key", "status", "created_at", "updated_at" FROM `public_profile`;--> statement-breakpoint
DROP TABLE `public_profile`;--> statement-breakpoint
ALTER TABLE `__new_public_profile` RENAME TO `public_profile`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `public_profile_owner_uidx` ON `public_profile` (`project_id`,`union_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `public_profile_slug_uidx` ON `public_profile` (`project_id`,`slug`);--> statement-breakpoint
CREATE INDEX `public_profile_status_idx` ON `public_profile` (`project_id`,`status`);--> statement-breakpoint
ALTER TABLE `project_list` DROP COLUMN `access_type`;--> statement-breakpoint
ALTER TABLE `project_list` DROP COLUMN `access_password`;