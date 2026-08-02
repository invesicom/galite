CREATE TABLE `instance_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`admin_email` text DEFAULT '' NOT NULL,
	`admin_password_hash` text DEFAULT '' NOT NULL,
	`auth_version` integer DEFAULT 1 NOT NULL,
	`google_client_id` text DEFAULT '' NOT NULL,
	`google_client_secret_enc` text DEFAULT '' NOT NULL,
	`custom_origin` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
