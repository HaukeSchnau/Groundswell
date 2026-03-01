# @groundswell/core-server

Server-side synchronization ingest runtime and contracts.

## What This Package Provides

- Service contracts:
  - `ServerApplicator<TEvent>`
  - `CanonicalStorage<TEvent>`
  - `Broadcast<TEvent>`
  - `IngestEngine<TEvent>`
- Live runtime layer:
  - `ingestEngineLive(...)`
- Error types:
  - `CanonicalStorageError`
  - `BroadcastError`
  - `UserNotFoundError`

## Main Runtime API

```ts
ingestEngineLive(
  ingestEngineTag,
  serverApplicatorTag,
  canonicalStorageTag,
  broadcastTag
)
```

The returned layer provides `IngestEngine.ingest(event, { initiatorId })`.

## Ingest Pipeline

`IngestEngine.ingest` performs:

1. Duplicate guard via `CanonicalStorage.isEventUnique(event.id)`
2. Domain validation via `ServerApplicator.verify(event, meta)`
3. Topic derivation via `ServerApplicator.getEventTopics(event)`
4. Canonical persistence via `CanonicalStorage.saveEvent(event, { ...meta, topics })`
5. Domain apply via `ServerApplicator.apply(event, meta)`
6. User-topic resolution via `ServerApplicator.getUserTopics(meta.initiatorId)`
7. Backfill query via `CanonicalStorage.getMissingEventsForUser(...)`
8. Broadcast missing + current event via `Broadcast.publishToUser(...)`

## Contracts You Implement

### `ServerApplicator`

- `verify(event, meta)`
- `apply(event, meta)`
- `getEventTopics(event)`
- `getUserTopics(userId)`

### `CanonicalStorage`

- Uniqueness checks
- Canonical event persistence
- Missing/sent event queries
- Sent marker writes

### `Broadcast`

- `publishToUser(userId, events)`
- `subscribe(userId, options?)`

## Integration Targets

Use this package with:
- `@groundswell/adapter-hono-server`
- `@groundswell/adapter-bun-server`
- canonical storage adapters (`adapter-drizzle-*`)

## Related Packages

- Client engine: [`@groundswell/core`](../core/README.md)
- Hono adapter: [`@groundswell/adapter-hono-server`](../adapter-hono-server/README.md)
- Bun adapter: [`@groundswell/adapter-bun-server`](../adapter-bun-server/README.md)
- SQLite canonical storage: [`@groundswell/adapter-drizzle-sqlite`](../adapter-drizzle-sqlite/README.md)
- Postgres canonical storage: [`@groundswell/adapter-drizzle-postgres`](../adapter-drizzle-postgres/README.md)
