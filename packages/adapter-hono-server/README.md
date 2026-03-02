# @groundswell/adapter-hono-server

Hono adapter that attaches sync ingest/stream endpoints to a Hono app.

## Export

- `attachSyncServer(hono, config)`

## Config

```ts
type HonoServerConfig<TEvent> = {
	ingestEngine: IngestEngine<TEvent>;
	broadcast: Broadcast<TEvent>;
	getUserId: (c: Context) => Promise<string | null>;
	eventSchema: z.Schema<TEvent>;
};
```

## Mounted Endpoints

- `POST /events`
- `GET /events`

## Endpoint Behavior

### `POST /events`

1. Read raw body text
2. Parse `superjson`
3. Validate with `eventSchema.safeParse`
4. Resolve initiator user via `getUserId`
5. Call `ingestEngine.ingest(event, { initiatorId })`

Response patterns:

- `200` `{ success: true }`
- `400` invalid event
- `401` unauthorized
- `409` duplicate event
- `500` generic ingest failure

### `GET /events`

1. Resolve user via `getUserId`
2. Parse optional `offset` query
3. Stream `broadcast.subscribe(userId, { offset })` via SSE

Response patterns:

- `401` unauthorized
- `200` SSE stream on success

## Minimal Integration

```ts
attachSyncServer(app, {
	ingestEngine,
	broadcast,
	getUserId: async (c) => c.get("userId") ?? null,
	eventSchema: DomainEvent,
});
```

## Related Packages

- Server runtime: [`@groundswell/core-server`](../core-server/README.md)
- Client transport counterpart: [`@groundswell/adapter-sse-client`](../adapter-sse-client/README.md)
