# @groundswell/adapter-drizzle-postgres

PostgreSQL Drizzle adapter for canonical server storage.

## What This Package Provides

- Canonical storage adapter for `@groundswell/core-server` (`CanonicalStorage<TEvent>`)
- Exported Postgres table definitions for schema composition

Exports are namespaced under:

- `CanonicalStorage.*`

## Table Definitions

- `CanonicalStorage.CanonicalEventsTable`
- `CanonicalStorage.CanonicalEventTopicsTable`
- `CanonicalStorage.CanonicalEventsSentToUsersTable`

Postgres-specific details include:

- UUID columns for IDs/user references
- Sent timestamp (`sent_at`) defaulting to `now`
- Join-path indexes on topic/sent marker tables

## Layer Factory

```ts
CanonicalStorage.createDrizzleCanonicalStorageLayer(CanonicalStorageTag, {
	db: DatabaseTag,
	eventSchema: DomainEvent,
});
```

## Canonical Storage Responsibilities

Implements:

- `isEventUnique(eventId)`
- `saveEvent(event, metaWithTopics)`
- `getMissingEventsForUser(userId, topics)`
- `getEventsSentToUser(userId)`
- `markEventAsSentToUser(eventId, userId)`

## Serialization and Parsing

- Stores payload using `superjson.stringify(event.data)`.
- Parses on read using `superjson.parse(...)` + `eventSchema.parse(...)`.
- Parse failures are dropped from aggregate query results via `Effect.allSuccesses`.

## Error Mapping

- Database failures are mapped to `CanonicalStorageError`.
- Duplicate handling semantics at engine level still rely on `isEventUnique` and/or DB constraints.

## Related Packages

- Server runtime: [`@groundswell/core-server`](../core-server/README.md)
- SQLite canonical alternative: [`@groundswell/adapter-drizzle-sqlite`](../adapter-drizzle-sqlite/README.md)
