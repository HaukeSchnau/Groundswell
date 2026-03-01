import { DevTools } from "@effect/experimental";
import { BunRuntime, BunSocket } from "@effect/platform-bun";
import { syncServer } from "@groundswell/adapter-bun-server";
import { makeService } from "@schnau/effect-drizzle/bun-sqlite";
import { serve } from "bun";
import { Effect, Layer, Redacted } from "effect";
import { DomainBroadcast, DomainIngestEngine } from "./boilerplate";
import { Database } from "./domain/db/contract";
import * as Schema from "./domain/db/schema";
import { DomainEvent } from "./domain/events";
import index from "./index.html";
import {
	appServerLayer,
	canonicalStorageLive,
	memoryBroadcastLive,
} from "./live/server";

const BunDatabaseLive = Layer.scoped(
	Database,
	makeService(
		{
			url: Redacted.make("file:./db.sqlite"),
			schema: Schema,
		},
		Database,
	),
);

const server = Effect.gen(function* () {
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

const DevToolsLive = DevTools.layerWebSocket().pipe(
	Layer.provide(BunSocket.layerWebSocketConstructor),
);

const serverLive = server.pipe(
	Effect.provide(appServerLayer),
	Effect.provide(memoryBroadcastLive),
	Effect.provide(canonicalStorageLive),
	Effect.provide(BunDatabaseLive),
	Effect.provide(DevToolsLive),
);

BunRuntime.runMain(serverLive);
