import type { SyncEngine } from "@groundswell/core";
import { type Context, Effect, Fiber, type ManagedRuntime, Stream } from "effect";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

// --- Context Setup ---

export const syncEngineFactory = <TEvent, TEngineTag, TContextTag, TContext>(
	syncEngineTag: Context.Tag<TEngineTag, SyncEngine<TEvent>>,
	_contextTag: Context.Tag<TContextTag, TContext>,
) => {
	// The context will hold the live SyncEngine service instance.
	const SyncEngineContext = createContext<ManagedRuntime.ManagedRuntime<
		TEngineTag | TContextTag,
		never
	> | null>(null);

	// --- Hooks ---

	/**
	 * Returns a memoized, async function to ingest a new event.
	 * This is the primary hook for creating new events from the UI.
	 *
	 * @example
	 * const ingest = useIngest();
	 * await ingest({ type: 'note.created', data: { ... } });
	 */
	function useIngest() {
		const runtime = useContext(SyncEngineContext);
		if (!runtime) {
			throw new Error("useIngest hooks must be used within a SyncEngineProvider.");
		}

		return useCallback(
			(event: Omit<TEvent, "id" | "timestamp">) => {
				// Bridge the Effect world to the Promise world for the UI.
				return runtime.runPromiseExit(
					Effect.andThen(syncEngineTag, (engine) => engine.ingest(event)),
				);
			},
			[runtime],
		);
	}

	/**
	 * Subscribes to the engine's status stream and returns the latest status.
	 * The component will re-render whenever the status changes.
	 *
	 * @example
	 * const { queueSize } = useSyncStatus();
	 * return <div>Items to sync: {queueSize}</div>
	 */
	function useSyncStatus() {
		const runtime = useContext(SyncEngineContext);
		if (!runtime) {
			throw new Error("useSyncStatus hooks must be used within a SyncEngineProvider.");
		}
		const [status, setStatus] = useState({ queueSize: 0 });

		useEffect(() => {
			const program = Effect.gen(function* () {
				const engine = yield* syncEngineTag;
				const statusStream = Stream.fromPubSub(engine.status);
				yield* Stream.runForEach(statusStream, (newStatus) =>
					Effect.sync(() => setStatus(newStatus)),
				);
			});
			const fiber = runtime.runFork(program);
			return () => {
				runtime.runFork(Fiber.interrupt(fiber));
			};
		}, [runtime]);

		return status;
	}

	const useRuntime = () => {
		const runtime = useContext(SyncEngineContext);
		if (!runtime) {
			throw new Error("useRuntime must be used within a SyncEngineProvider.");
		}
		return runtime;
	};

	return {
		SyncEngineProvider: SyncEngineContext.Provider,
		useIngest,
		useSyncStatus,
		useRuntime,
	};
};
