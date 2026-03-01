# @groundswell/adapter-sse-client

Transport adapter for `@groundswell/core` using HTTP publish + SSE listen.

## Exports

- Root package:
  - `createSseTransportLayer`
  - `HonoTransportConfig`
- Subpaths:
  - `@groundswell/adapter-sse-client/browser` -> `BrowserEventSourceServiceLive`
  - `@groundswell/adapter-sse-client/react-native` -> `ReactNativeEventSourceServiceLive`

## What It Implements

This package provides a `Transport<TEvent>` implementation:

- `publish(event)` -> `POST ${baseUrl}/events`
- `listen(options?)` -> connects to `${baseUrl}/events` via SSE

Payload format uses `superjson` for both publish and listen.

## Configuration

```ts
type HonoTransportConfig<TEvent> = {
  baseUrl: string;
  eventSchema: z.Schema<TEvent>;
  headers?: () => Record<string, string>;
};
```

## Usage (Browser)

```ts
import { createSseTransportLayer } from "@groundswell/adapter-sse-client";
import { BrowserEventSourceServiceLive } from "@groundswell/adapter-sse-client/browser";

const TransportLive = createSseTransportLayer(DomainTransport, {
  baseUrl: "http://localhost:3000/api",
  eventSchema: DomainEvent,
}).pipe(Layer.provide(BrowserEventSourceServiceLive));
```

## Error Mapping

`publish`:
- `409` -> `DuplicateEventError`
- Other non-OK statuses -> `TransportError`
- Retryability inferred from status (`>=500` retryable)

`listen`:
- SSE/network/parsing/schema errors -> `TransportError`

## Platform Notes

- Browser implementation uses `eventsource` package.
- React Native implementation uses `react-native-sse`.

## Known Limitations

- Current browser event-source wrapper merges headers from `options.headers` but does not invoke the function in one path, which can affect custom auth headers.
- `EventSourceService` is internal to this package export surface.
- No built-in heartbeat/event-id replay semantics in the transport contract.

## Related Packages

- Runtime consumer: [`@groundswell/core`](../core/README.md)
- Compatible server adapters:
  - [`@groundswell/adapter-hono-server`](../adapter-hono-server/README.md)
  - [`@groundswell/adapter-bun-server`](../adapter-bun-server/README.md)
