# Sync Engine Design Notes

This document captures the current sync-engine design implemented in this repository.

It replaces older ad-hoc root-level notes and keeps the architecture details maintained in one place.

## Design Intent

Groundswell treats domain events as the source of synchronization instead of directly syncing mutable records.

Benefits:
- Append-only history and clear causality
- Deterministic replay of pending work
- Separation of domain logic from transport/storage implementations

## Core Data Structures

### Client Local Event

A client event is represented as:
- `event`: the domain event payload
- `status.local`: local apply state
- `status.remote`: remote publish state

`status` values:
- `pending`
- `success`
- `error`

### Canonical Event Metadata

Server ingest receives `EventMeta`:
- `initiatorId`

Canonical storage tracks:
- event payload
- topic mappings
- sent markers (per user)

## Client Engine Responsibilities

`@groundswell/core` runtime (`syncEngineLive`) manages:
- In-memory queue for processing
- Startup replay from storage pending events
- Remote listener ingestion
- Local verify/apply and remote publish paths
- Event and queue-status pubsub streams

### Retry Model

Remote publish retry applies only to retryable `TransportError` values.

Retry behavior:
- Exponential backoff
- Delay cap
- Jitter

Duplicate remote events are treated as successful remote completion.

## Server Engine Responsibilities

`@groundswell/core-server` runtime (`ingestEngineLive`) manages:
- Duplicate detection
- Server-side validation
- Canonical persistence
- Domain apply
- Per-user catch-up query + publish

## Separation of Concerns

Groundswell does not hardcode:
- Domain rules
- Concrete database clients
- Network frameworks
- Auth/user resolution strategy

These are injected via service contracts and adapters.

## Typical Composition

### Client composition

- `Applicator` implementation (domain-specific)
- `Storage` adapter (for event log/status)
- `Transport` adapter (publish/listen)
- `syncEngineLive(...)`

### Server composition

- `ServerApplicator` implementation
- `CanonicalStorage` adapter
- `Broadcast` implementation
- `ingestEngineLive(...)`
- HTTP framework adapter (Hono or Bun)

## Known Non-Goals (Current State)

Not currently built into core contracts:
- Built-in conflict resolution beyond validation/duplicate semantics
- Multiple serializer strategies in adapters (current adapters use `superjson`)
- Heartbeat/event-id/replay token semantics in SSE transport contracts

## Verification Surface

Current repository tests cover core runtime behavior and portions of adapter behavior, but coverage instrumentation is not configured globally.

Recommended checks for future updates:
- End-to-end client/server integration tests
- Failure-path tests for each adapter
- Contract tests for HTTP + SSE compatibility between server and client adapters
