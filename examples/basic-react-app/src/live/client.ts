import { ClientStorage } from "@groundswell/adapter-drizzle-sqlite";
import { createSseTransportLayer } from "@groundswell/adapter-sse-client";
import { BrowserEventSourceServiceLive } from "@groundswell/adapter-sse-client/browser";
import { ApplicatorError, syncEngineLive, ValidationError } from "@groundswell/core";
import { makeService } from "@schnau/effect-drizzle/libsql-wasm";
import { Effect, Layer } from "effect";
import { DomainApplicator, DomainStorage, DomainSyncEngine, DomainTransport } from "../boilerplate";
import { applicator } from "../domain/applicators";
import { Database } from "../domain/db/contract";
import * as Schema from "../domain/db/schema";
import { DomainEvent } from "../domain/events";

const clientApplicatorsLive = Layer.effect(
	DomainApplicator,
	Effect.gen(function* () {
		const db = yield* Database;
		return DomainApplicator.of({
			verify: (event: DomainEvent) =>
				applicator
					.verify(event, {
						initiatorId: "1",
					})
					.pipe(
						Effect.provideService(Database, db),
						Effect.catchTags({
							DatabaseError: (error) =>
								Effect.fail(new ValidationError({ cause: error, reason: "INVALID" })),
							UnknownException: (error) =>
								Effect.fail(new ValidationError({ cause: error, reason: "UNKNOWN" })),
						}),
					),
			apply: (event: DomainEvent) =>
				applicator
					.apply(event, {
						initiatorId: "1",
					})
					.pipe(
						Effect.provideService(Database, db),
						Effect.catchTags({
							DatabaseError: (error) => Effect.fail(new ApplicatorError({ cause: error })),
							UnknownException: (error) => Effect.fail(new ApplicatorError({ cause: error })),
						}),
					),
		});
	}),
);

export const WasmDatabaseLive = Layer.effect(
	Database,
	makeService(
		{
			url: "file:./db.sqlite",
			schema: Schema,
		},
		Database,
	),
);

const StorageLive = ClientStorage.createDrizzleStorageLayer(DomainStorage, {
	db: Database,
	eventSchema: DomainEvent,
});

const TransportLive = createSseTransportLayer(DomainTransport, {
	baseUrl: "http://localhost:3000/api",
	eventSchema: DomainEvent,
}).pipe(Layer.provide(BrowserEventSourceServiceLive));

export const SyncEngineLive = syncEngineLive(
	DomainSyncEngine,
	DomainApplicator,
	DomainStorage,
	DomainTransport,
	{ offset: 0 },
).pipe(
	Layer.provide(clientApplicatorsLive),
	Layer.provide(StorageLive),
	Layer.provide(TransportLive),
);
