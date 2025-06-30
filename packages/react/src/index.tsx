import type { SyncEngine } from "@groundswell/core";
import { Effect, Exit, Fiber, Layer, Scope, Stream } from "effect";
import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

// --- Context Setup ---

// The context will hold the live SyncEngine service instance.
const SyncEngineContext = createContext<SyncEngine<any> | null>(null);

export interface SyncEngineProviderProps<TEvent> {
  /**
   * The fully composed Layer for the SyncEngine. This should include the
   * core engine layer, plus the consumer's provided applicator and adapter layers.
   */
  layer: Layer.Layer<SyncEngine<TEvent>>;
  /** A fallback component to render while the engine is initializing. */
  loadingFallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Provides the SyncEngine service to its children.
 * This component manages the entire lifecycle of the sync engine,
 * starting it on mount and gracefully shutting it down on unmount.
 */
export function SyncEngineProvider<TEvent>({
  layer,
  loadingFallback = null,
  children,
}: SyncEngineProviderProps<TEvent>) {
  const [engine, setEngine] = useState<SyncEngine<TEvent> | null>(null);

  useEffect(() => {
    // Layer.launch creates a Scoped effect and returns a handle to its Scope.
    const program = Layer.launch(layer).pipe(
      Effect.flatMap((scope) =>
        // Once the scope is created, we can get the live service from it.
        Effect.map(
          Effect.service(SyncEngine<TEvent>()),
          (engineService) => ({ engine: engineService, scope } as const)
        )
      )
    );

    let scope: Scope.Scope;

    Effect.runPromise(program)
      .then(({ engine: liveEngine, scope: liveScope }) => {
        scope = liveScope;
        setEngine(liveEngine);
      })
      .catch((error) => {
        console.error("Failed to launch SyncEngine layer:", error);
        // Handle initialization error appropriately
      });

    // The cleanup function is critical. It closes the scope, which
    // gracefully interrupts all background fibers managed by the engine.
    return () => {
      if (scope) {
        Effect.runPromise(Scope.close(scope, Exit.unit));
      }
    };
  }, [layer]); // Re-launch if the layer definition changes.

  if (!engine) {
    return <>{loadingFallback}</>;
  }

  return (
    <SyncEngineContext.Provider value={engine}>
      {children}
    </SyncEngineContext.Provider>
  );
}

// --- Hooks ---

/**
 * A helper hook to safely access the SyncEngine from context.
 * Throws an error if used outside of a SyncEngineProvider.
 */
function useSyncEngineContext<TEvent>(): SyncEngine<TEvent> {
  const context = useContext(SyncEngineContext);
  if (!context) {
    throw new Error(
      "useSyncEngine hooks must be used within a SyncEngineProvider."
    );
  }
  return context;
}

/**
 * Returns the raw SyncEngine service instance.
 * Useful for advanced use cases that require direct interaction with the engine.
 */
export const useSyncEngine = <TEvent,>() => useSyncEngineContext<TEvent>();

/**
 * Returns a memoized, async function to ingest a new event.
 * This is the primary hook for creating new events from the UI.
 *
 * @example
 * const ingest = useIngest();
 * await ingest({ type: 'note.created', data: { ... } });
 */
export function useIngest<TEvent>() {
  const engine = useSyncEngineContext<TEvent>();

  return useCallback(
    (event: Omit<TEvent, "id" | "timestamp">) => {
      // Bridge the Effect world to the Promise world for the UI.
      return Effect.runPromise(engine.ingest(event));
    },
    [engine]
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
export function useSyncStatus() {
  const engine = useSyncEngineContext();
  const [status, setStatus] = useState({ queueSize: 0 });

  useEffect(() => {
    const statusStream = engine.status;
    const fiber = Effect.runFork(
      Stream.runForEach(statusStream, (newStatus) =>
        Effect.sync(() => setStatus(newStatus))
      )
    );
    // On unmount, interrupt the subscription fiber.
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [engine]);

  return status;
}
