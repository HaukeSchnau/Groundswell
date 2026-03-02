# Event Lifecycle

This document traces how a domain event moves through Groundswell.

## 1. Local Ingest (Client)

When an app calls `SyncEngine.ingest(...)`:

1. The engine assigns `id` and `timestamp`.
2. The event is saved to local storage with status:
   - `local: pending`
   - `remote: pending`
3. The event is verified and applied locally.
4. Local status becomes `local: success` on success.
5. The event is queued for remote publication.

Primary implementation: `packages/core/src/live.ts`.

## 2. Remote Publish (Client -> Server)

Queued events with `remote: pending` are published through `Transport.publish`:

- Retry behavior:
  - Retryable `TransportError` is retried with exponential backoff and jitter.
  - Non-retryable failures become `remote: error`.
- Duplicate remote events (`DuplicateEventError`) are treated as success (`remote: success`).

Primary implementation: `packages/core/src/live.ts`.

## 3. Canonical Ingest (Server)

On server ingest (`IngestEngine.ingest`):

1. Check uniqueness (`CanonicalStorage.isEventUnique`).
2. Verify event business rules (`ServerApplicator.verify`).
3. Compute event topics (`ServerApplicator.getEventTopics`).
4. Persist canonical event and topic mappings (`CanonicalStorage.saveEvent`).
5. Apply server-side business effects (`ServerApplicator.apply`).
6. Resolve subscriber topics for initiator (`ServerApplicator.getUserTopics`).
7. Query missing events for initiator (`getMissingEventsForUser`).
8. Publish missing events and the current event to the initiator (`Broadcast.publishToUser`).

Primary implementation: `packages/core-server/src/live.ts`.

## 4. Broadcast Stream (Server -> Client)

Clients subscribe through `GET /events` (SSE):

- Server adapters (`adapter-hono-server`, `adapter-bun-server`) expose SSE streams.
- Events are emitted as serialized payloads (`superjson.stringify`).
- Client transport parses and schema-validates each message.

Primary implementations:

- `packages/adapter-hono-server/src/index.ts`
- `packages/adapter-bun-server/src/index.ts`
- `packages/adapter-sse-client/src/index.ts`

## 5. Remote Event Apply (Client)

For each event from `Transport.listen(...)`:

1. Save event to local storage as:
   - `local: pending`
   - `remote: success`
2. Ignore if duplicate in local storage.
3. Queue for local apply.
4. Verify and apply locally.
5. Update `local: success` or `local: error`.

Primary implementation: `packages/core/src/live.ts`.

## 6. Startup Recovery

On startup, the client engine:

1. Loads pending events from storage (`Storage.getPendingEvents`).
2. Re-queues them for processing.
3. Starts remote listener stream.

This enables recovery after restarts, offline windows, or partial failures.

## Status Transition Reference

| Situation                            | Before            | After                          |
| ------------------------------------ | ----------------- | ------------------------------ |
| Fresh local ingest                   | `pending/pending` | queued + local apply attempted |
| Local apply success                  | `pending/*`       | `success/*`                    |
| Local verify/apply failure           | `pending/*`       | `error/*`                      |
| Remote publish success               | `*/pending`       | `*/success`                    |
| Remote publish non-retryable failure | `*/pending`       | `*/error`                      |
| Remote duplicate                     | `*/pending`       | `*/success`                    |
| Remote inbound event saved           | n/a               | `pending/success`              |

`status` format above is `local/remote`.

## Operational Notes

- Delivery and eventual consistency depend on transport connectivity and broadcast implementation.
- Some advanced semantics (heartbeats, per-event IDs for resumable SSE) are not part of current transport contracts.
- Canonical storage includes sent-marking interfaces; usage depends on your broadcast integration choices.
