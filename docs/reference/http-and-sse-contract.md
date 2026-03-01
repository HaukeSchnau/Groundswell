# HTTP + SSE Contract

This document describes the wire contract expected between:
- Client transport adapters (`@groundswell/adapter-sse-client`)
- Server adapters (`@groundswell/adapter-hono-server`, `@groundswell/adapter-bun-server`)

## Endpoints

- `POST /events`
- `GET /events`

## `POST /events`

### Request

- Body: `superjson.stringify(event)`
- Content-Type: `application/json` (current adapters send this header)

### Server behavior

- Parse request body via `superjson.parse`
- Validate event using configured Zod schema
- Resolve initiator user ID via adapter callback
- Run server ingest engine

### Common responses

- `200` success
- `400` invalid event payload/validation failure
- `401` unauthorized (missing user)
- `409` duplicate event
- `500` ingest failure

Note: response body shape differs slightly between server adapters (`JSON` vs plain text).

## `GET /events`

### Request

- Optional query parameter: `offset`

### Semantics

- The server resolves user ID and opens an SSE stream.
- The broadcast stream is serialized with `superjson.stringify(event)`.
- `offset` handling is adapter-defined and passed through to `Broadcast.subscribe(userId, { offset })`.

### Response

- Content-Type: `text/event-stream`
- Data frames:

```text
data: <superjson event payload>

```

## Client Transport Expectations

`@groundswell/adapter-sse-client` expects:
- Publish endpoint at `${baseUrl}/events`
- Listen endpoint at `${baseUrl}/events`
- SSE `data` payload parseable by `superjson.parse`
- Parsed payload valid against provided `eventSchema`

## Error Mapping Notes

- Client transport maps:
  - `409` -> `DuplicateEventError`
  - Other HTTP failures -> `TransportError` with retryability inferred from status (`>=500` retryable)
- SSE/network failures are mapped to `TransportError` from underlying event-source service.

## Compatibility Checklist

To keep adapters interoperable:

1. Preserve `POST/GET /events` behavior.
2. Keep payload format as `superjson` event envelope.
3. Keep schema-compatible event shape (`id`, `timestamp`, `type`, `data`).
4. Keep duplicate and unauthorized response semantics predictable.
