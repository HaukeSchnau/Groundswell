# @groundswell/react

React integration helpers for a `@groundswell/core` sync engine runtime.

## Export

- `syncEngineFactory(syncEngineTag, contextTag)`

The factory returns:
- `SyncEngineProvider`
- `useIngest`
- `useSyncStatus`
- `useRuntime`

## What It Solves

This package bridges Effect runtime and React components so UI code can:
- Trigger domain event ingest
- Observe sync queue state
- Access runtime for Effect-based queries

## Factory Pattern

```ts
const { SyncEngineProvider, useIngest, useSyncStatus, useRuntime } =
  syncEngineFactory(DomainSyncEngine, DatabaseTag);
```

## Hook Behavior

### `useIngest`

Returns a callback that calls `engine.ingest(...)` through runtime and returns `runPromiseExit(...)`.

Important: callsites should handle `Exit` success/failure explicitly.

### `useSyncStatus`

Subscribes to `engine.status` pubsub and returns latest queue size state.

### `useRuntime`

Returns the runtime from context for custom Effect integrations.

## Provider Setup

```tsx
const runtime = ManagedRuntime.make(SyncEngineLiveLayer);

<SyncEngineProvider value={runtime}>
  <App />
</SyncEngineProvider>
```

Hooks throw if used outside the provider.

## Typical Integration Pattern

- Build a managed runtime with your live sync layer.
- Provide it via `SyncEngineProvider`.
- Use `useIngest` in mutation handlers.
- Use `useSyncStatus` for UX feedback (`Syncing ...`, `Synced`).

## Related Packages

- Runtime: [`@groundswell/core`](../core/README.md)
- Example integration: [`examples/basic-react-app`](../../examples/basic-react-app/README.md)
