# basic-react-app

End-to-end example showing Groundswell client/server sync in a single Bun application.

## What This Example Demonstrates

- Domain event modeling with `@groundswell/zod-helpers`
- Client runtime via `@groundswell/core` + `@groundswell/react`
- Server ingest runtime via `@groundswell/core-server`
- Bun HTTP adapter via `@groundswell/adapter-bun-server`
- Client transport via `@groundswell/adapter-sse-client`
- SQLite storage via `@groundswell/adapter-drizzle-sqlite`

## Architecture

- One Bun process serves:
  - API routes (`/api/events`)
  - Static frontend
  - `sqlite3.wasm`
- Client and server both use Effect layers and shared event schema.

Key files:
- Server entry: `src/index.ts`
- Server composition: `src/live/server.ts`
- Client composition: `src/live/client.ts`
- Shared tags/factory wiring: `src/boilerplate.ts`
- Domain events: `src/domain/events.ts`
- Domain applicators: `src/domain/applicators.ts`
- DB schema: `src/domain/db/schema.ts`

## Run

From repository root:

```bash
bun install
bun run --filter basic-react-app dev
```

Then open:
- `http://localhost:3000`

Production-style start:

```bash
bun run --filter basic-react-app start
```

## Sync Flow In This Example

1. UI calls `useIngest` from `@groundswell/react`.
2. Client sync engine persists + applies events locally.
3. Client transport publishes to `POST /api/events`.
4. Server ingest engine validates, stores canonical event, and broadcasts.
5. Client listens on SSE (`GET /api/events`) and applies inbound events.

## Data Model and Migrations

This example uses a shared SQLite schema for:
- Domain table: `notes`
- Client event log table
- Canonical server tables

Browser-side migrations run before render (`src/migrate.ts`).

## Known Simplifications

This is a learning/integration example and intentionally keeps some shortcuts:
- Hardcoded user identity (`"1"`) in client and server paths
- Broadcast implementation uses in-memory pubsub and static topics
- `todo.created` applicator is currently a no-op
- API base URL is hardcoded for localhost development

## Where To Go Next

For productionizing this pattern:
- Replace hardcoded user IDs with real auth/session integration
- Replace in-memory broadcast with durable message transport
- Add full topic routing strategy per tenant/user scope
- Externalize base URL/auth headers in client transport config
