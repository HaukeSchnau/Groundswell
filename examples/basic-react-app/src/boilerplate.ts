import type {
	Applicator,
	Storage,
	SyncEngine,
	Transport,
} from "@groundswell/core";
import type {
	Broadcast,
	CanonicalStorage,
	IngestEngine,
	ServerApplicator,
} from "@groundswell/core-server";
import { ingestEngineLive } from "@groundswell/core-server/live";
import { syncEngineFactory } from "@groundswell/react";
import { Context } from "effect";
import { Database } from "./domain/db/contract";
import type { DomainEvent } from "./domain/events";

export class DomainApplicator extends Context.Tag("Applicator")<
	DomainApplicator,
	Applicator<DomainEvent>
>() {}

export class DomainStorage extends Context.Tag("Storage")<
	DomainStorage,
	Storage<DomainEvent>
>() {}

export class DomainCanonicalStorage extends Context.Tag("CanonicalStorage")<
	DomainCanonicalStorage,
	CanonicalStorage<DomainEvent>
>() {}

export class DomainTransport extends Context.Tag("Transport")<
	DomainTransport,
	Transport<DomainEvent>
>() {}

export class DomainSyncEngine extends Context.Tag("SyncEngine")<
	DomainSyncEngine,
	SyncEngine<DomainEvent>
>() {}

export class DomainServerApplicator extends Context.Tag("ServerApplicator")<
	DomainServerApplicator,
	ServerApplicator<DomainEvent>
>() {}

export class DomainBroadcast extends Context.Tag("Broadcast")<
	DomainBroadcast,
	Broadcast<DomainEvent>
>() {}

export class DomainIngestEngine extends Context.Tag("IngestEngine")<
	DomainIngestEngine,
	IngestEngine<DomainEvent>
>() {}

export const ingestEngine = ingestEngineLive(
	DomainIngestEngine,
	DomainServerApplicator,
	DomainCanonicalStorage,
	DomainBroadcast,
);

export const clientSyncEngine = syncEngineFactory(DomainSyncEngine, Database);
