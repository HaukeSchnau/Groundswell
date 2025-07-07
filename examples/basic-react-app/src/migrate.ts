// @ts-nocheck

import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql/wasm";
import journalRaw from "../drizzle/meta/_journal.json" with { type: "text" };

const migrations = {
	"0000_conscious_northstar": await import(
		"../drizzle/0000_conscious_northstar.sql"
	).then((m) => m.default),
};

const journal = JSON.parse(journalRaw);

const migrationQueries = [];
for (const journalEntry of journal.entries) {
	// const query = migrations[journalEntry.tag];
	const query = await fetch(migrations[journalEntry.tag]).then((r) => r.text());
	const result = query.split("--> statement-breakpoint").map((it) => {
		return it;
	});
	migrationQueries.push({
		sql: result,
		bps: journalEntry.breakpoints,
		folderMillis: journalEntry.when,
		hash: await window.crypto.subtle
			.digest("SHA-256", new TextEncoder().encode(query))
			.then((hash) => {
				return Array.from(new Uint8Array(hash))
					.map((b) => b.toString(16).padStart(2, "0"))
					.join("");
			}),
	});
}

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
