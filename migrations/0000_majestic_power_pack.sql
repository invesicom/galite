CREATE TABLE `data_source_auth` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`union_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text DEFAULT '' NOT NULL,
	`account_email` text DEFAULT '',
	`account_name` text DEFAULT '',
	`account_avatar` text DEFAULT '',
	`access_token_enc` text,
	`refresh_token_enc` text,
	`token_expires_at` integer DEFAULT 0,
	`scope` text,
	`last_refreshed_at` integer DEFAULT 0,
	`status` integer DEFAULT 1,
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `data_source_auth_provider_idx` ON `data_source_auth` (`project_id`,`union_id`,`provider`);--> statement-breakpoint
CREATE UNIQUE INDEX `data_source_auth_external_uidx` ON `data_source_auth` (`project_id`,`union_id`,`provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `data_source_auth_status_idx` ON `data_source_auth` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `metrics_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`cache_key` text NOT NULL,
	`payload` text NOT NULL,
	`expires_at` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metrics_cache_key_uidx` ON `metrics_cache` (`project_id`,`cache_key`);--> statement-breakpoint
CREATE INDEX `metrics_cache_expires_idx` ON `metrics_cache` (`expires_at`);--> statement-breakpoint
CREATE INDEX `metrics_cache_updated_idx` ON `metrics_cache` (`updated_at`);--> statement-breakpoint
CREATE TABLE `project_data_source` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`union_id` text NOT NULL,
	`project_key` text NOT NULL,
	`provider` text NOT NULL,
	`auth_id` integer NOT NULL,
	`resource_id` text NOT NULL,
	`resource_label` text DEFAULT '',
	`resource_meta` text,
	`realtime_dashboard` integer DEFAULT 1,
	`status` integer DEFAULT 1,
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_data_source_project_idx` ON `project_data_source` (`project_id`,`project_key`);--> statement-breakpoint
CREATE INDEX `project_data_source_provider_idx` ON `project_data_source` (`project_id`,`union_id`,`provider`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_data_source_resource_uidx` ON `project_data_source` (`project_id`,`project_key`,`provider`,`resource_id`);--> statement-breakpoint
CREATE INDEX `project_data_source_auth_idx` ON `project_data_source` (`auth_id`);--> statement-breakpoint
CREATE TABLE `project_funnel` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`union_id` text NOT NULL,
	`project_key` text NOT NULL,
	`funnel_key` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`steps_config` text,
	`status` integer DEFAULT 1,
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_funnel_key_uidx` ON `project_funnel` (`project_id`,`funnel_key`);--> statement-breakpoint
CREATE INDEX `project_funnel_project_status_idx` ON `project_funnel` (`project_id`,`project_key`,`status`);--> statement-breakpoint
CREATE INDEX `project_funnel_owner_status_idx` ON `project_funnel` (`project_id`,`union_id`,`status`);--> statement-breakpoint
CREATE TABLE `project_list` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`union_id` text NOT NULL,
	`project_key` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`description` text,
	`logo_url` text DEFAULT '',
	`site_url` text DEFAULT '',
	`timezone` text DEFAULT '',
	`access_type` integer DEFAULT 0,
	`access_password` text DEFAULT '',
	`priority` integer DEFAULT 0,
	`status` integer DEFAULT 1,
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_list_project_key_uidx` ON `project_list` (`project_id`,`project_key`);--> statement-breakpoint
CREATE INDEX `project_list_owner_status_idx` ON `project_list` (`project_id`,`union_id`,`status`);--> statement-breakpoint
CREATE INDEX `project_list_priority_idx` ON `project_list` (`project_id`,`priority`);--> statement-breakpoint
CREATE TABLE `public_profile` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`union_id` text NOT NULL,
	`slug` text NOT NULL,
	`slug_source` text DEFAULT 'email' NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`avatar_url` text DEFAULT '/images/logo.svg' NOT NULL,
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
CREATE UNIQUE INDEX `public_profile_owner_uidx` ON `public_profile` (`project_id`,`union_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `public_profile_slug_uidx` ON `public_profile` (`project_id`,`slug`);--> statement-breakpoint
CREATE INDEX `public_profile_status_idx` ON `public_profile` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `public_project_setting` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`union_id` text NOT NULL,
	`project_key` text NOT NULL,
	`public_project_key` text NOT NULL,
	`visibility_mode` text DEFAULT 'inherit' NOT NULL,
	`password_hash` text DEFAULT '' NOT NULL,
	`anonymous_label` text DEFAULT '' NOT NULL,
	`public_title` text DEFAULT '' NOT NULL,
	`public_description` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_project_setting_project_uidx` ON `public_project_setting` (`project_id`,`project_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `public_project_setting_public_uidx` ON `public_project_setting` (`project_id`,`public_project_key`);--> statement-breakpoint
CREATE INDEX `public_project_setting_owner_idx` ON `public_project_setting` (`project_id`,`union_id`);--> statement-breakpoint
CREATE INDEX `public_project_setting_visibility_idx` ON `public_project_setting` (`project_id`,`union_id`,`visibility_mode`);--> statement-breakpoint
CREATE TABLE `public_widget` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`union_id` text NOT NULL,
	`widget_key` text NOT NULL,
	`scope` text DEFAULT 'profile' NOT NULL,
	`project_key` text DEFAULT '' NOT NULL,
	`widget_type` text DEFAULT 'metric_card' NOT NULL,
	`visibility_mode` text DEFAULT 'semi_public' NOT NULL,
	`metric` text DEFAULT 'totalUsers' NOT NULL,
	`period` text DEFAULT '28days' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`theme` text DEFAULT 'light' NOT NULL,
	`accent_color` text DEFAULT '' NOT NULL,
	`config_json` text,
	`status` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_widget_key_uidx` ON `public_widget` (`project_id`,`widget_key`);--> statement-breakpoint
CREATE INDEX `public_widget_owner_idx` ON `public_widget` (`project_id`,`union_id`);--> statement-breakpoint
CREATE INDEX `public_widget_status_idx` ON `public_widget` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `usage_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text DEFAULT 'self-hosted' NOT NULL,
	`key_name` text NOT NULL,
	`date` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_records_key_date_uidx` ON `usage_records` (`key_name`,`date`);--> statement-breakpoint
CREATE INDEX `usage_records_updated_idx` ON `usage_records` (`updated_at`);--> statement-breakpoint
CREATE TABLE `user_api_key` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`union_id` text NOT NULL,
	`key_name` text DEFAULT '' NOT NULL,
	`api_key` text NOT NULL,
	`last_used_at` integer DEFAULT 0,
	`status` integer DEFAULT 1,
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_api_key_value_uidx` ON `user_api_key` (`api_key`);--> statement-breakpoint
CREATE INDEX `user_api_key_owner_status_idx` ON `user_api_key` (`project_id`,`union_id`,`status`);