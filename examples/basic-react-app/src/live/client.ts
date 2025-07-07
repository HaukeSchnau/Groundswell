import { ClientStorage } from "@groundswell/adapter-drizzle-sqlite";
import { createSseTransportLayer } from "@groundswell/adapter-sse-client";
import { BrowserEventSourceServiceLive } from "@groundswell/adapter-sse-client/browser";
import {
	ApplicatorError,
	syncEngineLive,
	ValidationError,
} from "@groundswell/core";
import { makeService } from "@schnau/effect-drizzle/libsql-wasm";
import { Effect, Layer, Redacted } from "effect";
import { queryClient } from "@/App";
import {
	DomainApplicator,
	DomainStorage,
	DomainSyncEngine,
	DomainTransport,
} from "@/boilerplate";
import { apply, verify } from "@/domain/applicators";
import { Database, TransactionContext } from "@/domain/db/contract";
import * as Schema from "@/domain/db/schema";
import { DomainEvent } from "@/domain/events";

const clientApplicatorsLive = Layer.effect(
	DomainApplicator,
	Effect.gen(function* () {
		const db = yield* Database;
		return DomainApplicator.of({
			verify: (event: DomainEvent) =>
				verify(event, db, {
					initiatorId: "1",
				}).pipe(
					Effect.catchTags({
						DatabaseError: (error) =>
							Effect.fail(new ValidationError({ cause: error })),
						ApplicatorError: (error) =>
							Effect.fail(new ValidationError({ cause: error })),
					}),
				),
			apply: (event: DomainEvent) =>
				apply(event, db, {
					initiatorId: "1",
				}).pipe(
					Effect.tap((result) => {
						if (result.invalidatedQueries) {
							result.invalidatedQueries.forEach((queryKey) => {
								queryClient.invalidateQueries({
									queryKey,
								});
							});
						}
					}),
					Effect.catchTag("DatabaseError", (error) =>
						Effect.fail(
							new ApplicatorError({
								cause: error,
							}),
						),
					),
				),
		});
	}),
);

export const WasmDatabaseLive = Layer.scoped(
	Database,
	makeService(
		{
			url: Redacted.make("file:./db.sqlite"),
			schema: Schema,
		},
		TransactionContext,
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
).pipe(
	Layer.provide(clientApplicatorsLive),
	Layer.provide(StorageLive),
	Layer.provide(TransportLive),
);
