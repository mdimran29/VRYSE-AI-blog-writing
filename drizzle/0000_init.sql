CREATE TABLE `articles` (
	`id` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`title` text NOT NULL,
	`source_path` text NOT NULL,
	`meta` text,
	`ast` text NOT NULL,
	`markdown` text NOT NULL,
	`content_hash` text NOT NULL,
	`split` text DEFAULT 'train' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`iteration_id` text NOT NULL,
	`overall` real NOT NULL,
	`dimensions` text NOT NULL,
	`report` text NOT NULL,
	`judge_model` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`iteration_id`) REFERENCES `iterations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`iteration_id` text NOT NULL,
	`rating` integer,
	`text` text,
	`section_notes` text,
	`selected_recommendations` text,
	`compiled_instructions` text,
	`decision` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`iteration_id`) REFERENCES `iterations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `iterations` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`version` integer NOT NULL,
	`parent_iteration_id` text,
	`mode` text NOT NULL,
	`outline` text,
	`markdown` text NOT NULL,
	`instructions` text,
	`approved` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `llm_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stage` text NOT NULL,
	`role` text NOT NULL,
	`model` text NOT NULL,
	`run_id` text,
	`iteration_id` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`latency_ms` integer NOT NULL,
	`cost_usd` real,
	`dev_cache_hit` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`generation_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memory` (
	`id` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`instruction` text NOT NULL,
	`source_feedback_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company` text NOT NULL,
	`version` integer NOT NULL,
	`profile` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`brief` text NOT NULL,
	`profile_version` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
