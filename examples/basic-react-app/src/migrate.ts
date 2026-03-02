import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql/wasm";

type JournalEntry = {
	tag: keyof typeof migrations;
	breakpoints: boolean;
	when: number;
};

type Journal = {
	entries: JournalEntry[];
};

const migrations = {
	"0000_conscious_northstar": new URL(
		"../drizzle/0000_conscious_northstar.sql",
		import.meta.url,
	).toString(),
};

const journalData: unknown = await fetch(
	new URL("../drizzle/meta/_journal.json", import.meta.url),
).then((response) => response.json());
const journal = journalData as Journal;

const migrationQueries = await Promise.all(
	journal.entries.map(async (journalEntry) => {
		const query = await fetch(migrations[journalEntry.tag]).then((r) => r.text());
		const hashBuffer = await window.crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(query),
		);
		return {
			sql: query.split("--> statement-breakpoint"),
			bps: journalEntry.breakpoints,
			folderMillis: journalEntry.when,
			hash: [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, "0")).join(""),
		};
	}),
);

export const runMigrations = async () => {
	const db = drizzle({
		connection: {
			url: "file:./db.sqlite",
		},
	});
	await migrate(db, {
		migrations: migrationQueries,
	});
};
