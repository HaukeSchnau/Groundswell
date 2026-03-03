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

const isDatabaseError = (error: unknown): boolean =>
	typeof error === "object" && error !== null && "_tag" in error && error._tag === "DatabaseError";

const clientApplicatorsLive = Layer.effect(
	DomainApplicator,
	Effect.gen(function* () {
		const db = yield* Database;
		return DomainApplicator.of({
			verify: (event: DomainEvent) =>
				Effect.provideService(
					Effect.mapError(
						applicator.verify(event, {
							initiatorId: "1",
						}),
						(error) => {
							if (error instanceof ValidationError) {
								return error;
							}
							const cause = error instanceof ApplicatorError ? error.cause : error;
							return new ValidationError({
								cause,
								reason: isDatabaseError(cause) ? "INVALID" : "UNKNOWN",
							});
						},
					),
					Database,
					db,
				) as Effect.Effect<void, ValidationError>,
			apply: (event: DomainEvent) =>
				Effect.provideService(
					Effect.mapError(
						applicator.apply(event, {
							initiatorId: "1",
						}),
						(error) =>
							error instanceof ApplicatorError ? error : new ApplicatorError({ cause: error }),
					),
					Database,
					db,
				) as Effect.Effect<void, ApplicatorError>,
		});
	}),
);

export const WasmDatabaseLive = Layer.succeed(
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
	baseUrl: "/api",
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
