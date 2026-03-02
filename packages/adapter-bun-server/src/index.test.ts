import { ApplicatorError, DuplicateEventError, ValidationError } from "@groundswell/core";
import { UserNotFoundError, type Broadcast, type IngestEngine } from "@groundswell/core-server";
import { Effect, Stream } from "effect";
import superjson from "superjson";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { syncServer } from "./index.js";

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

const makeServer = ({
	ingest,
	subscribe,
	getUserId,
}: {
	ingest?: IngestEngine<DomainEvent>["ingest"];
	subscribe?: Broadcast<DomainEvent>["subscribe"];
	getUserId?: () => Promise<string | null>;
}) => {
	const ingestEngine: IngestEngine<DomainEvent> = {
		ingest: ingest ?? (() => Effect.void),
	};
	const broadcast: Broadcast<DomainEvent> = {
		publishToUser: () => Effect.void,
		subscribe: subscribe ?? ((_) => Stream.fromIterable([makeValidEvent()])),
	};

	return syncServer({
		ingestEngine,
		broadcast,
		getUserId: getUserId ?? (() => Promise.resolve("user-1")),
		eventSchema: DomainEvent,
	});
};

const readStreamBody = async (response: Response): Promise<string> => {
	if (response.body == null) {
		return "";
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let body = "";
	const readChunk = async (): Promise<void> => {
		const next = await reader.read();
		if (next.done) {
			return;
		}
		const chunk = next.value;
		if (typeof chunk === "string") {
			body += chunk;
			return readChunk();
		}
		if (chunk instanceof Uint8Array) {
			body += decoder.decode(chunk, { stream: true });
			return readChunk();
		}
		if (chunk instanceof ArrayBuffer) {
			body += decoder.decode(new Uint8Array(chunk), { stream: true });
			return readChunk();
		}
		return readChunk();
	};
	await readChunk();
	body += decoder.decode();
	return body;
};

describe("sync server adapter", () => {
	it("returns 400 for invalid schema payloads", async () => {
		const server = makeServer({});
		const response = await server.POST(
			new Request("http://localhost/events", {
				method: "POST",
				body: superjson.stringify({ type: "invalid" }),
			}),
		);

		expect(response.status).toBe(400);
		await expect(response.text()).resolves.toBe("Invalid event");
	});

	it("returns 401 when user is missing", async () => {
		const server = makeServer({
			getUserId: () => Promise.resolve(null),
		});
		const response = await server.POST(
			new Request("http://localhost/events", {
				method: "POST",
				body: superjson.stringify(makeValidEvent()),
			}),
		);

		expect(response.status).toBe(401);
	});

	it("maps known ingest errors to HTTP statuses", async () => {
		const duplicate = makeServer({
			ingest: () => Effect.fail(new DuplicateEventError({ eventId: "x" })),
		});
		const duplicateRes = await duplicate.POST(
			new Request("http://localhost/events", {
				method: "POST",
				body: superjson.stringify(makeValidEvent()),
			}),
		);
		expect(duplicateRes.status).toBe(409);

		const validation = makeServer({
			ingest: () => Effect.fail(new ValidationError({ cause: "bad", reason: "INVALID" })),
		});
		const validationRes = await validation.POST(
			new Request("http://localhost/events", {
				method: "POST",
				body: superjson.stringify(makeValidEvent()),
			}),
		);
		expect(validationRes.status).toBe(400);

		const userNotFound = makeServer({
			ingest: () => Effect.fail(new UserNotFoundError({ userId: "user-1" })),
		});
		const userNotFoundRes = await userNotFound.POST(
			new Request("http://localhost/events", {
				method: "POST",
				body: superjson.stringify(makeValidEvent()),
			}),
		);
		expect(userNotFoundRes.status).toBe(403);
	});

	it("returns 500 for unmapped ingest failures", async () => {
		const server = makeServer({
			ingest: () => Effect.fail(new ApplicatorError({ cause: "boom" })),
		});
		const response = await server.POST(
			new Request("http://localhost/events", {
				method: "POST",
				body: superjson.stringify(makeValidEvent()),
			}),
		);
		expect(response.status).toBe(500);
	});

	it("returns 200 and calls ingest on success", async () => {
		const ingest = vi.fn(() => Effect.void);
		const server = makeServer({ ingest });
		const event = makeValidEvent();
		const response = await server.POST(
			new Request("http://localhost/events", {
				method: "POST",
				body: superjson.stringify(event),
			}),
		);
		expect(response.status).toBe(200);
		expect(ingest).toHaveBeenCalledWith(event, { initiatorId: "user-1" });
	});

	it("returns 401 for unauthorized GET /events", async () => {
		const server = makeServer({
			getUserId: () => Promise.resolve(null),
		});
		const response = await server.GET(new Request("http://localhost/events"));
		expect(response.status).toBe(401);
	});

	it("streams SSE responses and normalizes invalid offset", async () => {
		const subscribe = vi.fn((_: string, options?: { offset?: number }) => {
			expect(options).toStrictEqual({ offset: 0 });
			return Stream.fromIterable([makeValidEvent()]);
		});
		const server = makeServer({ subscribe });

		const response = await server.GET(new Request("http://localhost/events?offset=bad"));
		const body = await readStreamBody(response);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("text/event-stream");
		expect(body).toContain("data:");
		expect(subscribe).toHaveBeenCalledWith("user-1", { offset: 0 });
	});
});
