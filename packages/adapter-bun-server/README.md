# @groundswell/adapter-bun-server

Bun adapter that returns route handlers for sync ingest/stream endpoints.

## Export

- `syncServer(config)`

## Config

```ts
type Config<TEvent> = {
	ingestEngine: IngestEngine<TEvent>;
	broadcast: Broadcast<TEvent>;
	getUserId: (request: Request) => Promise<string | null>;
	eventSchema: z.Schema<TEvent>;
};
```

## Return Shape

`syncServer(config)` returns:

- `POST(request)` handler
- `GET(request)` handler

Mount these in Bun routes (example: `/api/events`).

## Endpoint Behavior

### `POST`

- Parses `superjson` payload
- Validates event schema
- Resolves user ID
- Calls `ingestEngine.ingest`

Typical statuses:

- `200` event ingested
- `400` invalid event
- `401` unauthorized
- `403` user not found path
- `409` duplicate
- `500` failure

### `GET`

- Resolves user ID
- Parses optional `offset`
- Streams `broadcast.subscribe(...)` as `text/event-stream`

## Minimal Integration

```ts
routes: {
  "/api/events": syncServer({
    ingestEngine,
    broadcast,
    getUserId: () => Promise.resolve("user-id"),
    eventSchema: DomainEvent,
  })
}
```

## Notes

- SSE framing is `data: <superjson-payload>\n\n`.
- Route path is controlled by where you mount the handlers.

## Related Packages

- Server runtime: [`@groundswell/core-server`](../core-server/README.md)
- Client transport counterpart: [`@groundswell/adapter-sse-client`](../adapter-sse-client/README.md)
