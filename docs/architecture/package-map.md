# Package Map

This is a quick reference for package boundaries and responsibilities.

## Foundation

### `@groundswell/zod-helpers`

Defines reusable schema helpers for event modeling:

- `BaseEventSchema`
- `createDomainEvent`
- `createEventUnion`

Used by nearly all packages that validate or infer event types.

## Core Runtime

### `@groundswell/core`

Client-side synchronization runtime:

- Contracts: `Applicator`, `Storage`, `Transport`, `SyncEngine`
- Runtime: `syncEngineLive`
- Utilities: applicator map/tree factories

### `@groundswell/core-server`

Server-side ingest orchestration:

- Contracts: `ServerApplicator`, `CanonicalStorage`, `Broadcast`, `IngestEngine`
- Runtime: `ingestEngineLive`

## Transport Adapters

### `@groundswell/adapter-sse-client`

Implements `Transport` via:

- `POST /events` for publish
- `GET /events` SSE for listen

Subpath exports:

- `@groundswell/adapter-sse-client/browser`
- `@groundswell/adapter-sse-client/react-native`

### `@groundswell/adapter-hono-server`

Mounts sync endpoints directly onto a Hono app:

- `POST /events`
- `GET /events`

### `@groundswell/adapter-bun-server`

Returns Bun route handlers (`GET`/`POST`) with equivalent sync behavior.

## Storage Adapters

### `@groundswell/adapter-drizzle-sqlite`

Provides both:

- Client storage adapter (`event_log` table)
- Canonical storage adapter (`canonical_*` tables)

### `@groundswell/adapter-drizzle-postgres`

Provides canonical storage adapter for PostgreSQL (`canonical_*` tables).

## UI Integration

### `@groundswell/react`

Factory for React integration around a `SyncEngine`:

- Provider
- `useIngest`
- `useSyncStatus`
- `useRuntime`

## Example Integration

### `examples/basic-react-app`

Demonstrates end-to-end composition across client, server, transport, and storage layers.

## Choosing A Minimal Stack

Typical minimum for a web app:

- Client: `core` + `react` + `adapter-sse-client` + `adapter-drizzle-sqlite`
- Server: `core-server` + one server adapter + one canonical storage adapter
- Shared: `zod-helpers` for event schema contract

## Suggested Reading Order

1. `packages/zod-helpers/README.md`
2. `packages/core/README.md`
3. `packages/core-server/README.md`
4. Transport and storage adapter READMEs
5. `examples/basic-react-app/README.md`
