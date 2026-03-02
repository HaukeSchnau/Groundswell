import type { SyncEngine } from "@groundswell/core";
import { Effect, Exit, Layer, ManagedRuntime, PubSub, ServiceMap } from "effect";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { syncEngineFactory } from "./index.js";

type DomainEvent = {
	id: string;
	timestamp: Date;
	type: "note.created";
	data: { content: string };
};

class DomainSyncEngine extends ServiceMap.Service<DomainSyncEngine, SyncEngine<DomainEvent>>()(
	"DomainSyncEngine",
) {}

class DomainContext extends ServiceMap.Service<DomainContext, { name: string }>()(
	"DomainContext",
) {}

const makeRuntime = () => {
	const ingest = vi.fn(() => Effect.void);
	const statusPubSub = Effect.runSync(PubSub.unbounded<{ queueSize: number }>());
	const eventsPubSub = Effect.runSync(
		PubSub.unbounded<{
			event: DomainEvent;
			status: { local: "pending" | "success" | "error"; remote: "pending" | "success" | "error" };
		}>(),
	);

	const engine = DomainSyncEngine.of({
		ingest,
		status: statusPubSub,
		events: eventsPubSub,
	});

	const runtime = ManagedRuntime.make(
		Layer.merge(
			Layer.succeed(DomainSyncEngine, engine),
			Layer.succeed(DomainContext, DomainContext.of({ name: "ctx" })),
		),
	);

	return {
		runtime,
		ingest,
		statusPubSub,
	};
};

describe("react sync engine factory", () => {
	it("throws when hooks are used outside provider", () => {
		const { useIngest, useSyncStatus, useRuntime } = syncEngineFactory(
			DomainSyncEngine,
			DomainContext,
		);

		expect(() => renderHook(() => useIngest())).toThrow(
			"useIngest hooks must be used within a SyncEngineProvider.",
		);
		expect(() => renderHook(() => useSyncStatus())).toThrow(
			"useSyncStatus hooks must be used within a SyncEngineProvider.",
		);
		expect(() => renderHook(() => useRuntime())).toThrow(
			"useRuntime must be used within a SyncEngineProvider.",
		);
	});

	it("useIngest runs ingest through runtime and returns an Exit", async () => {
		const { runtime, ingest } = makeRuntime();
		const { SyncEngineProvider, useIngest } = syncEngineFactory(DomainSyncEngine, DomainContext);
		const wrapper = ({ children }: { children: ReactNode }) => (
			<SyncEngineProvider value={runtime}>{children}</SyncEngineProvider>
		);

		const { result } = renderHook(() => useIngest(), { wrapper });

		const exit = await result.current({
			type: "note.created",
			data: { content: "hello" },
		});

		expect(Exit.isSuccess(exit)).toBe(true);
		expect(ingest).toHaveBeenCalledWith({
			type: "note.created",
			data: { content: "hello" },
		});
	});

	it("useSyncStatus subscribes to status updates", async () => {
		const { runtime, statusPubSub } = makeRuntime();
		const { SyncEngineProvider, useSyncStatus } = syncEngineFactory(
			DomainSyncEngine,
			DomainContext,
		);
		const wrapper = ({ children }: { children: ReactNode }) => (
			<SyncEngineProvider value={runtime}>{children}</SyncEngineProvider>
		);

		const { result } = renderHook(() => useSyncStatus(), { wrapper });
		expect(result.current.queueSize).toBe(0);

		await Effect.runPromise(PubSub.publish(statusPubSub, { queueSize: 3 }));
		await waitFor(() => {
			expect(result.current.queueSize).toBe(3);
		});
	});

	it("interrupts subscription fiber on unmount", () => {
		const { runtime } = makeRuntime();
		const runForkSpy = vi.spyOn(runtime, "runFork");
		const { SyncEngineProvider, useSyncStatus } = syncEngineFactory(
			DomainSyncEngine,
			DomainContext,
		);
		const wrapper = ({ children }: { children: ReactNode }) => (
			<SyncEngineProvider value={runtime}>{children}</SyncEngineProvider>
		);

		const { unmount } = renderHook(() => useSyncStatus(), { wrapper });
		unmount();

		expect(runForkSpy).toHaveBeenCalledTimes(2);
	});
});
