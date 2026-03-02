import type { Applicator, Storage, SyncEngine, Transport } from "@groundswell/core";
import {
	ingestEngineLive,
	type Broadcast,
	type CanonicalStorage,
	type IngestEngine,
	type ServerApplicator,
} from "@groundswell/core-server";
import { syncEngineFactory } from "@groundswell/react";
import { ServiceMap } from "effect";
import { Database } from "./domain/db/contract";
import type { DomainEvent } from "./domain/events";

export class DomainApplicator extends ServiceMap.Service<
	DomainApplicator,
	Applicator<DomainEvent>
>()("Applicator") {}

export class DomainStorage extends ServiceMap.Service<DomainStorage, Storage<DomainEvent>>()(
	"Storage",
) {}

export class DomainCanonicalStorage extends ServiceMap.Service<
	DomainCanonicalStorage,
	CanonicalStorage<DomainEvent>
>()("CanonicalStorage") {}

export class DomainTransport extends ServiceMap.Service<
	DomainTransport,
	Transport<DomainEvent>
>()("Transport") {}

export class DomainSyncEngine extends ServiceMap.Service<
	DomainSyncEngine,
	SyncEngine<DomainEvent>
>()("SyncEngine") {}

export class DomainServerApplicator extends ServiceMap.Service<
	DomainServerApplicator,
	ServerApplicator<DomainEvent>
>()("ServerApplicator") {}

export class DomainBroadcast extends ServiceMap.Service<
	DomainBroadcast,
	Broadcast<DomainEvent>
>()("Broadcast") {}

export class DomainIngestEngine extends ServiceMap.Service<
	DomainIngestEngine,
	IngestEngine<DomainEvent>
>()("IngestEngine") {}

export const ingestEngine = ingestEngineLive(
	DomainIngestEngine,
	DomainServerApplicator,
	DomainCanonicalStorage,
	DomainBroadcast,
);

export const clientSyncEngine = syncEngineFactory(DomainSyncEngine, Database);
