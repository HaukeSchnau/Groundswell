import { expect, test } from "@playwright/test";
import superjson from "superjson";

type DomainEvent = {
	id: string;
	timestamp: Date;
	type: "note.created" | "note.archived";
	data: { id?: string; content?: string; noteId?: string };
};

const BASE_URL = "http://127.0.0.1:3000";

const resolveBaseUrl = (baseURL: string | undefined): string =>
	baseURL === undefined ? BASE_URL : baseURL;

const createEvent = (
	type: DomainEvent["type"],
	data: DomainEvent["data"],
	overrides?: Partial<DomainEvent>,
): DomainEvent => ({
	id: crypto.randomUUID(),
	timestamp: new Date(),
	type,
	data,
	...overrides,
});

const postEvent = async (baseUrl: string, event: DomainEvent) => {
	const response = await fetch(`${baseUrl}/api/events`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: superjson.stringify(event),
	});
	return response;
};

const parseSseBlock = (block: string): DomainEvent | null => {
	const line = block.split("\n").find((candidate) => candidate.startsWith("data: "));
	if (line === undefined) {
		return null;
	}
	const payload = line.slice(6);
	return superjson.parse<DomainEvent>(payload);
};

const containsEventIds = (events: DomainEvent[], expectedIds: string[]): boolean => {
	const ids = new Set(events.map((event) => event.id));
	return expectedIds.every((id) => ids.has(id));
};

const collectSseEvents = async ({
	baseUrl,
	count,
	offset,
	timeoutMs = 10_000,
	until,
}: {
	baseUrl: string;
	count: number;
	offset?: number;
	timeoutMs?: number;
	until?: (events: DomainEvent[]) => boolean;
}): Promise<DomainEvent[]> => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	const url = new URL(`${baseUrl}/api/events`);
	if (offset !== undefined) {
		url.searchParams.set("offset", String(offset));
	}

	const response = await fetch(url, {
		signal: controller.signal,
		headers: {
			Accept: "text/event-stream",
		},
	});
	if (!response.ok || response.body == null) {
		clearTimeout(timeout);
		throw new Error(`SSE connection failed with status ${response.status}`);
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const events: DomainEvent[] = [];

	const readChunks = async (): Promise<void> => {
		if (events.length >= count) {
			return;
		}
		const next = await reader.read();
		if (next.done) {
			return;
		}

		const chunk = next.value;
		if (!(chunk instanceof Uint8Array)) {
			return;
		}

		buffer += decoder.decode(chunk, { stream: true });
		const blocks = buffer.split("\n\n");
		buffer = blocks.pop() ?? "";

		for (const block of blocks) {
			const event = parseSseBlock(block);
			if (event === null) {
				continue;
			}
			events.push(event);
			if (until?.(events) === true || events.length >= count) {
				return;
			}
		}

		return readChunks();
	};

	try {
		await readChunks();
	} finally {
		clearTimeout(timeout);
		controller.abort();
		reader.releaseLock();
	}

	return events;
};

test("accepts create and archive events through ingest endpoint", async ({ baseURL }) => {
	const baseUrl = resolveBaseUrl(baseURL);
	const noteId = crypto.randomUUID();

	const created = createEvent("note.created", { id: noteId, content: `e2e-${Date.now()}` });
	const archived = createEvent("note.archived", { noteId });

	const createdResponse = await postEvent(baseUrl, created);
	const archivedResponse = await postEvent(baseUrl, archived);

	expect(createdResponse.status).toBe(200);
	expect(await createdResponse.text()).toContain("Event ingested");
	expect(archivedResponse.status).toBe(200);
});

test("streams live events over SSE", async ({ baseURL }) => {
	const baseUrl = resolveBaseUrl(baseURL);
	const first = createEvent("note.created", {
		id: crypto.randomUUID(),
		content: `live-a-${Date.now()}`,
	});
	const second = createEvent("note.created", {
		id: crypto.randomUUID(),
		content: `live-b-${Date.now()}`,
	});

	const collecting = collectSseEvents({
		baseUrl,
		count: 2,
		offset: 10_000,
	});

	await Promise.all([postEvent(baseUrl, first), postEvent(baseUrl, second)]);
	const events = await collecting;

	expect(events.map((event) => event.id)).toEqual(expect.arrayContaining([first.id, second.id]));
});

test("replays missed events after reconnect", async ({ baseURL }) => {
	const baseUrl = resolveBaseUrl(baseURL);
	const first = createEvent("note.created", {
		id: crypto.randomUUID(),
		content: `replay-a-${Date.now()}`,
	});
	const second = createEvent("note.created", {
		id: crypto.randomUUID(),
		content: `replay-b-${Date.now()}`,
	});

	await postEvent(baseUrl, first);
	await postEvent(baseUrl, second);

	const replayAfterReconnect = await collectSseEvents({
		baseUrl,
		count: 50,
		offset: 0,
		until: (events) => containsEventIds(events, [first.id, second.id]),
	});
	const replayIds = replayAfterReconnect.map((event) => event.id);

	expect(replayIds).toContain(first.id);
	expect(replayIds).toContain(second.id);
});
