CREATE TABLE `canonical_event_topics` (
	`event` text NOT NULL,
	`topic` text NOT NULL,
	PRIMARY KEY(`event`, `topic`),
	FOREIGN KEY (`event`) REFERENCES `canonical_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `canonical_events` (
	`id` text PRIMARY KEY NOT NULL,
	`timestamp` integer NOT NULL,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`initiator` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `canonical_events_sent_to_users` (
	`event` text NOT NULL,
	`user` text NOT NULL,
	PRIMARY KEY(`event`, `user`),
	FOREIGN KEY (`event`) REFERENCES `canonical_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `event_log` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`timestamp` integer NOT NULL,
	`local_status` text NOT NULL,
	`remote_status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL
);
