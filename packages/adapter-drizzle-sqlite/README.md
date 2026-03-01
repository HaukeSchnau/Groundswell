# @groundswell/adapter-drizzle-sqlite

SQLite Drizzle adapters for Groundswell storage contracts.

## What This Package Provides

- Client storage adapter for `@groundswell/core` (`Storage<TEvent>`)
- Canonical storage adapter for `@groundswell/core-server` (`CanonicalStorage<TEvent>`)
- Exported table definitions for schema composition

Exports are namespaced:
- `ClientStorage.*`
- `CanonicalStorage.*`

## Table Definitions

### Client tables

- `ClientStorage.EventsTable` (`event_log`)
  - `id`
  - `type`
  - `data` (serialized)
  - `timestamp`
  - `local_status`
  - `remote_status`

### Canonical tables

- `CanonicalStorage.CanonicalEventsTable`
- `CanonicalStorage.CanonicalEventTopicsTable`
- `CanonicalStorage.CanonicalEventsSentToUsersTable`

## Layer Factories

### Client storage layer

```ts
ClientStorage.createDrizzleStorageLayer(StorageTag, {
  db: DatabaseTag,
  eventSchema: DomainEvent,
})
```

### Canonical storage layer

```ts
CanonicalStorage.createDrizzleCanonicalStorageLayer(CanonicalStorageTag, {
  db: DatabaseTag,
  eventSchema: DomainEvent,
})
```

## Schema Wiring Pattern

Reuse exported tables in your schema module:

```ts
export const eventLog = ClientStorage.EventsTable;
export const canonicalEvents = CanonicalStorage.CanonicalEventsTable;
export const canonicalEventTopics = CanonicalStorage.CanonicalEventTopicsTable;
export const canonicalEventsSentToUsers = CanonicalStorage.CanonicalEventsSentToUsersTable;
```

## Serialization and Parsing

- Event payloads are persisted with `superjson.stringify(event.data)`.
- Retrieval parses via `superjson.parse(...)` + `eventSchema.parse(...)`.
- Parse failures are dropped/filtered in query result flows (`Effect.allSuccesses` or null-filtering).

## Error Mapping

- Client layer maps DB unique violation on save to `DuplicateEventError`.
- Other DB errors map to `StorageError` / `CanonicalStorageError`.

## Query Semantics Highlights

- Client pending replay query returns events with `local_status='pending'` OR `remote_status='pending'`, ordered by timestamp ascending.
- Canonical missing-events query joins topic and sent-marker tables, filtering unsent events for user topics.

## Related Packages

- Client runtime: [`@groundswell/core`](../core/README.md)
- Server runtime: [`@groundswell/core-server`](../core-server/README.md)
- Postgres canonical alternative: [`@groundswell/adapter-drizzle-postgres`](../adapter-drizzle-postgres/README.md)
