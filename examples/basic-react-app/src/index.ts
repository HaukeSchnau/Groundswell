import { BunRuntime } from "@effect/platform-bun";
import { syncServer } from "@groundswell/adapter-bun-server";
import type { GenericDatabaseService } from "@schnau/effect-drizzle/generic-sqlite";
import { makeService } from "@schnau/effect-drizzle/bun-sqlite";
import { serve } from "bun";
import { Effect, Layer } from "effect";
import { DomainBroadcast, DomainIngestEngine } from "./boilerplate";
import { Database } from "./domain/db/contract";
import * as Schema from "./domain/db/schema";
import { DomainEvent } from "./domain/events";
import index from "./index.html";
import { appServerLayer, canonicalStorageLive, memoryBroadcastLive } from "./live/server";

const ensurePromise = <T>(value: T | Promise<T>): Promise<T> => {
	if (value instanceof Promise) {
		return value;
	}
	return Promise.resolve(value);
};

const runServerMigrations = (db: GenericDatabaseService<typeof Schema>) =>
	Effect.gen(function* () {
		const migrationSql = yield* Effect.promise(() =>
			Bun.file("./drizzle/0000_conscious_northstar.sql").text(),
		);
		const statements = migrationSql
			.split("--> statement-breakpoint")
			.map((statement) => statement.trim())
			.filter((statement) => statement.length > 0);

		for (const statement of statements) {
			const normalized = statement.replace(/^CREATE TABLE /u, "CREATE TABLE IF NOT EXISTS ");
			yield* db.execute((client) => ensurePromise(client.run(normalized)));
		}
	});

const BunDatabaseLive = Layer.effect(
	Database,
	makeService(
		{
			url: `file:${process.env.GROUNDSWELL_SERVER_DB_PATH ?? "./db.sqlite"}`,
			schema: Schema,
		},
		Database,
	),
);

const server = Effect.gen(function* () {
	const db = yield* Database;
	yield* runServerMigrations(db);

	const ingestEngine = yield* DomainIngestEngine;
	const broadcast = yield* DomainBroadcast;

	// simulate events in background
	// yield* Effect.gen(function* () {
	// 	while (true) {
	// 		yield* Effect.sleep(1000);
	// 		yield* Effect.log("Publishing event");
	// 		yield* broadcast.publishToTopics(["all_notes"], {
	// 			type: "note.created",
	// 			id: "1",
	// 			timestamp: new Date(),
	// 			data: {
	// 				id: "1",
	// 				content: "Hello, world!",
	// 			},
	// 		});
	// 	}
	// }).pipe(Effect.forkDaemon);

	const server = serve({
		idleTimeout: 255,
		routes: {
			"/drizzle/meta/_journal.json": {
				GET: () => new Response(Bun.file("./drizzle/meta/_journal.json")),
			},
			"/drizzle/0000_conscious_northstar.sql": {
				GET: () => new Response(Bun.file("./drizzle/0000_conscious_northstar.sql")),
			},
			"/src/drizzle/meta/_journal.json": {
				GET: () => new Response(Bun.file("./drizzle/meta/_journal.json")),
			},
			"/src/drizzle/0000_conscious_northstar.sql": {
				GET: () => new Response(Bun.file("./drizzle/0000_conscious_northstar.sql")),
			},

			// Serve index.html for all unmatched routes.
			"/*": index,

			"/sqlite3.wasm": {
				GET: () => new Response(Bun.file("./sqlite3.wasm")),
			},

			"/api/events": syncServer({
				ingestEngine: ingestEngine,
				broadcast: broadcast,
				getUserId: () => Promise.resolve("1"),
				eventSchema: DomainEvent,
			}),
		},

		development: process.env.NODE_ENV !== "production" && {
			// Enable browser hot reloading in development
			hmr: true,

			// Echo console logs from the browser to the server
			console: true,
		},
	});

	yield* Effect.log(`🚀 Server running at ${server.url}`);
	yield* Effect.never;
});

const serverLive = server.pipe(
	Effect.provide(appServerLayer),
	Effect.provide(memoryBroadcastLive),
	Effect.provide(canonicalStorageLive),
	Effect.provide(BunDatabaseLive),
);

BunRuntime.runMain(serverLive);
