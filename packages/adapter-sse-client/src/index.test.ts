import { DuplicateEventError, TransportError, type Transport } from "@groundswell/core";
import { Effect, Layer, Option, ServiceMap, Stream } from "effect";
import superjson from "superjson";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
	EventSourceError,
	EventSourceService,
	type EventSourceMessage,
} from "./event-source/index.js";
import { createSseTransportLayer } from "./index.js";

type DomainEvent = {
	id: string;
	timestamp: Date;
	type: "note.created";
	data: { content: string };
};

const DomainEventSchema = z.object({
	id: z.string(),
	timestamp: z.date(),
	type: z.literal("note.created"),
	data: z.object({ content: z.string() }),
});

class DomainTransport extends ServiceMap.Service<DomainTransport, Transport<DomainEvent>>()(
	"DomainTransport",
) {}

const makeEvent = (): DomainEvent => ({
	id: crypto.randomUUID(),
	timestamp: new Date(),
	type: "note.created",
	data: { content: "hello" },
});

const makeEventSourceLayer = (
	messagesOrError: Stream.Stream<EventSourceMessage, EventSourceError>,
) =>
	Layer.succeed(
		EventSourceService,
		EventSourceService.of({
			connect: () => messagesOrError,
		}),
	);

const makeTransport = (messagesOrError: Stream.Stream<EventSourceMessage, EventSourceError>) =>
	Layer.provide(
		createSseTransportLayer(DomainTransport, {
			baseUrl: "http://localhost:3000/api",
			eventSchema: DomainEventSchema,
			headers: () => ({ Authorization: "Bearer token" }),
		}),
		makeEventSourceLayer(messagesOrError),
	);

describe("sse transport layer", () => {
	it("maps publish status codes into success and typed failures", async () => {
		const event = makeEvent();
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response(null, { status: 200 }))
			.mockResolvedValueOnce(new Response(null, { status: 409 }))
			.mockResolvedValueOnce(new Response(null, { status: 400 }))
			.mockResolvedValueOnce(new Response(null, { status: 503 }));
		vi.stubGlobal("fetch", fetchMock);

		const program = Effect.gen(function* () {
			const transport = yield* DomainTransport;

			yield* transport.publish(event);

			const duplicate = yield* Effect.flip(transport.publish(event));
			expect(duplicate).toBeInstanceOf(DuplicateEventError);

			const clientError = yield* Effect.flip(transport.publish(event));
			expect(clientError).toMatchObject({
				_tag: "TransportError",
				isRetryable: false,
			});

			const serverError = yield* Effect.flip(transport.publish(event));
			expect(serverError).toBeInstanceOf(TransportError);
			expect(serverError).toMatchObject({
				_tag: "TransportError",
				isRetryable: true,
			});
		});

		await Effect.runPromise(program.pipe(Effect.provide(makeTransport(Stream.empty))));

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"http://localhost:3000/api/events",
			expect.objectContaining({
				headers: expect.objectContaining({
					"Content-Type": "application/json",
					Authorization: "Bearer token",
				}),
			}),
		);
	});

	it("parses listen messages and maps schema/parse failures", async () => {
		const validEvent = makeEvent();
		const validMessage: EventSourceMessage = {
			data: superjson.stringify(validEvent),
			id: Option.none(),
			event: Option.none(),
			retry: Option.none(),
		};
		const invalidMessage: EventSourceMessage = {
			data: "not-json",
			id: Option.none(),
			event: Option.none(),
			retry: Option.none(),
		};

		const program = Effect.gen(function* () {
			const transport = yield* DomainTransport;

			const stream = yield* transport.listen();
			const first = yield* stream.pipe(Stream.take(1), Stream.runCollect);
			expect(first[0]?.id).toBe(validEvent.id);

			const failed = yield* Effect.flip(
				transport
					.listen()
					.pipe(Effect.flatMap((badStream) => badStream.pipe(Stream.drop(1), Stream.runDrain))),
			);
			expect(failed).toMatchObject({
				_tag: "TransportError",
				isRetryable: false,
			});
		});

		await Effect.runPromise(
			program.pipe(
				Effect.provide(makeTransport(Stream.fromIterable([validMessage, invalidMessage]))),
			),
		);
	});

	it("maps EventSourceError reason to retryable transport errors", async () => {
		const networkFailure = Stream.fail(
			new EventSourceError({
				reason: "NetworkError",
				originalError: new Error("network"),
			}),
		);
		const parsingFailure = Stream.fail(
			new EventSourceError({
				reason: "ParsingError",
				originalError: new Error("parse"),
			}),
		);

		const networkProgram = Effect.gen(function* () {
			const transport = yield* DomainTransport;
			const error = yield* Effect.flip(
				transport.listen().pipe(Effect.flatMap((stream) => stream.pipe(Stream.runDrain))),
			);
			expect(error).toMatchObject({
				_tag: "TransportError",
				isRetryable: true,
			});
		});

		const parsingProgram = Effect.gen(function* () {
			const transport = yield* DomainTransport;
			const error = yield* Effect.flip(
				transport.listen().pipe(Effect.flatMap((stream) => stream.pipe(Stream.runDrain))),
			);
			expect(error).toMatchObject({
				_tag: "TransportError",
				isRetryable: false,
			});
		});

		await Effect.runPromise(networkProgram.pipe(Effect.provide(makeTransport(networkFailure))));
		await Effect.runPromise(parsingProgram.pipe(Effect.provide(makeTransport(parsingFailure))));
	});
});
