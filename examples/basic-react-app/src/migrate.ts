import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql/wasm";

const MIGRATION_SQL = String.raw`CREATE TABLE \`canonical_event_topics\` (
	\`event\` text NOT NULL,
	\`topic\` text NOT NULL,
	PRIMARY KEY(\`event\`, \`topic\`),
	FOREIGN KEY (\`event\`) REFERENCES \`canonical_events\`(\`id\`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE \`canonical_events\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`timestamp\` integer NOT NULL,
	\`type\` text NOT NULL,
	\`data\` text NOT NULL,
	\`initiator\` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE \`canonical_events_sent_to_users\` (
	\`event\` text NOT NULL,
	\`user\` text NOT NULL,
	PRIMARY KEY(\`event\`, \`user\`),
	FOREIGN KEY (\`event\`) REFERENCES \`canonical_events\`(\`id\`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE \`event_log\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`type\` text NOT NULL,
	\`data\` text NOT NULL,
	\`timestamp\` integer NOT NULL,
	\`local_status\` text NOT NULL,
	\`remote_status\` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE \`notes\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`content\` text NOT NULL,
	\`is_archived\` integer DEFAULT false NOT NULL
);`;

const buildMigrationQueries = async () => {
	const hashBuffer = await window.crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(MIGRATION_SQL),
	);

	return [
		{
			sql: MIGRATION_SQL.split("--> statement-breakpoint"),
			bps: true,
			folderMillis: 1751801486689,
			hash: [...new Uint8Array(hashBuffer)]
				.map((byte) => byte.toString(16).padStart(2, "0"))
				.join(""),
		},
	];
};

export const runMigrations = async () => {
	const db = drizzle({
		connection: {
			url: "file:./db.sqlite",
		},
	});

	await migrate(db, {
		migrations: await buildMigrationQueries(),
	});
};
