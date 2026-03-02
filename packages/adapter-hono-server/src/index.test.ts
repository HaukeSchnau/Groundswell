import { ApplicatorError, DuplicateEventError, ValidationError } from "@groundswell/core";
import type { Broadcast, IngestEngine } from "@groundswell/core-server";
import { Effect, Stream } from "effect";
import { Hono } from "hono";
import superjson from "superjson";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { attachSyncServer } from "./index.js";

const DomainEvent = z.object({
	id: z.string(),
	timestamp: z.date(),
	type: z.literal("note.created"),
	data: z.object({
		content: z.string(),
	}),
});

type DomainEvent = z.infer<typeof DomainEvent>;

const makeValidEvent = (): DomainEvent => ({
	id: crypto.randomUUID(),
	timestamp: new Date(),
	type: "note.created",
	data: {
		content: "hello",
	},
});

const makeApp = ({
	ingest,
	broadcast,
	getUserId,
}: {
	ingest?: IngestEngine<DomainEvent>["ingest"];
	broadcast?: Broadcast<DomainEvent>["subscribe"];
	getUserId?: () => Promise<string | null>;
}) => {
	const app = new Hono();
	const ingestEngine: IngestEngine<DomainEvent> = {
		ingest: ingest ?? (() => Effect.void),
	};
	const subscribe = broadcast ?? ((_) => Stream.fromIterable([makeValidEvent()]));
	const broadcastService: Broadcast<DomainEvent> = {
		publishToUser: () => Effect.void,
		subscribe,
	};

	attachSyncServer(app, {
		ingestEngine,
		broadcast: broadcastService,
		getUserId: getUserId ?? (() => Promise.resolve("user-1")),
		eventSchema: DomainEvent,
	});

	return app;
};

describe("hono sync server", () => {
	it("returns 400 for schema-invalid payloads", async () => {
		const app = makeApp({});
		const payload = superjson.stringify({ type: "invalid" });

		const response = await app.request("http://localhost/events", {
			method: "POST",
			body: payload,
		});

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toStrictEqual({ error: "Invalid event" });
	});

	it("returns 401 when user cannot be resolved", async () => {
		const app = makeApp({
			getUserId: () => Promise.resolve(null),
		});

		const response = await app.request("http://localhost/events", {
			method: "POST",
			body: superjson.stringify(makeValidEvent()),
		});

		expect(response.status).toBe(401);
	});

	it("maps DuplicateEventError to 409", async () => {
		const app = makeApp({
			ingest: () => Effect.fail(new DuplicateEventError({ eventId: "x" })),
		});

		const response = await app.request("http://localhost/events", {
			method: "POST",
			body: superjson.stringify(makeValidEvent()),
		});

		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toStrictEqual({ error: "Duplicate event" });
	});

	it("maps ValidationError to 400", async () => {
		const app = makeApp({
			ingest: () => Effect.fail(new ValidationError({ cause: "bad", reason: "INVALID" })),
		});

		const response = await app.request("http://localhost/events", {
			method: "POST",
			body: superjson.stringify(makeValidEvent()),
		});

		expect(response.status).toBe(400);
	});

	it("returns 500 for non-mapped ingest failures", async () => {
		const app = makeApp({
			ingest: () => Effect.fail(new ApplicatorError({ cause: "boom" })),
		});

		const response = await app.request("http://localhost/events", {
			method: "POST",
			body: superjson.stringify(makeValidEvent()),
		});

		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toStrictEqual({ error: "Failed to ingest event" });
	});

	it("returns 200 on successful ingest", async () => {
		const ingest = vi.fn(() => Effect.void);
		const app = makeApp({ ingest });
		const event = makeValidEvent();

		const response = await app.request("http://localhost/events", {
			method: "POST",
			body: superjson.stringify(event),
		});

		expect(response.status).toBe(200);
		expect(ingest).toHaveBeenCalledWith(event, { initiatorId: "user-1" });
	});

	it("returns 401 for unauthorized GET /events", async () => {
		const app = makeApp({
			getUserId: () => Promise.resolve(null),
		});

		const response = await app.request("http://localhost/events");
		expect(response.status).toBe(401);
	});

	it("streams SSE and normalizes invalid offset query to zero", async () => {
		const subscribe = vi.fn((_: string, options?: { offset?: number }) => {
			expect(options).toStrictEqual({ offset: 0 });
			return Stream.fromIterable([makeValidEvent()]);
		});
		const app = makeApp({ broadcast: subscribe });

		const response = await app.request("http://localhost/events?offset=not-a-number");
		const body = await response.text();

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		expect(body).toContain("data:");
		expect(subscribe).toHaveBeenCalledWith("user-1", { offset: 0 });
	});
});
