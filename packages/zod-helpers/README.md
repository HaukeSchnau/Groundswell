# @groundswell/zod-helpers

Helpers for defining strongly-typed domain-event schemas with Zod.

## Exports

- `BaseEventSchema`
- `createDomainEvent(name, dataShape)`
- `createEventUnion(eventSchemas)`
- Types:
  - `UnknownEvent`
  - `EventMeta`

## Event Shape Convention

All events are expected to include:
- `id: string` (UUID)
- `timestamp: Date`
- `type: string` (event discriminator)
- `data: object` (event payload)

`BaseEventSchema` defines `id` and `timestamp`. `createDomainEvent` adds literal `type` and `data` payload schema.

## Usage

```ts
import { createDomainEvent, createEventUnion } from "@groundswell/zod-helpers";
import { z } from "zod";

const noteCreated = createDomainEvent("note.created", {
  id: z.string().uuid(),
  content: z.string().min(1),
});

const noteArchived = createDomainEvent("note.archived", {
  noteId: z.string().uuid(),
});

export const DomainEvent = createEventUnion([noteCreated, noteArchived]);
export type DomainEvent = z.infer<typeof DomainEvent>;
```

## Important Note About `createDomainEvent`

`createDomainEvent(name, dataShape)` expects a raw object shape (`z.ZodRawShape`), not a `z.object(...)` instance.

Correct:

```ts
createDomainEvent("x.y", { value: z.string() })
```

## Where It Is Used

- Client and server adapters for schema validation
- Shared event type definitions in applications
- Storage adapters when parsing event payloads

## Related Packages

- Client runtime: [`@groundswell/core`](../core/README.md)
- Server runtime: [`@groundswell/core-server`](../core-server/README.md)
