import { QueryClientProvider, type QueryKey, useQuery } from "@tanstack/react-query";
import { type Effect, Layer, ManagedRuntime } from "effect";
import { type FormEvent, use, useState } from "react";
import { clientSyncEngine, type DomainSyncEngine } from "./boilerplate";
import type { Database } from "./domain/db/contract";
import { getNotes } from "./domain/queries";
import { SyncEngineLive, WasmDatabaseLive } from "./live/client";
import { runMigrations } from "./migrate";
import { queryClient } from "./query-client";

const { SyncEngineProvider, useIngest, useSyncStatus, useRuntime } = clientSyncEngine;

const StatusBar = () => {
	const { queueSize } = useSyncStatus();
	return (
		<div className="text-center py-2 text-gray-600">
			{queueSize > 0 ? `Syncing ${queueSize} items...` : "✨ Synced"}
		</div>
	);
};

const useEffectQuery = <A, E>(
	effect: Effect.Effect<A, E, DomainSyncEngine | Database>,
	queryKey: QueryKey,
) => {
	const runtime = useRuntime();
	return useQuery({
		queryKey,
		queryFn: async () => {
			try {
				return await runtime.runPromise(effect);
			} catch (error) {
				throw error instanceof Error ? error : new Error(String(error));
			}
		},
	});
};

const NoteInput = () => {
	const [content, setContent] = useState("");
	const ingest = useIngest();

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		if (!content) return;
		const result = await ingest({
			type: "note.created",
			data: { id: crypto.randomUUID(), content },
		});

		if (result._tag === "Failure") {
			console.error("Failed to ingest note:", result.cause);
		}

		setContent("");
	};

	return (
		<form
			onSubmit={(event) => {
				void handleSubmit(event);
			}}
			className="flex gap-3 p-3 border-b border-gray-200"
		>
			<input
				type="text"
				value={content}
				onChange={(e) => setContent(e.target.value)}
				placeholder="Write a new note..."
				className="flex-1 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
			/>
			<button
				type="submit"
				className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
			>
				Add
			</button>
		</form>
	);
};

const AllNotes = () => {
	const notes = useEffectQuery(getNotes, ["notes"]);
	const ingest = useIngest();

	const handleArchive = async (noteId: string) => {
		const result = await ingest({
			type: "note.archived",
			data: { noteId },
		});

		if (result._tag === "Failure") {
			console.error("Failed to archive note:", result.cause);
		}
	};

	if (notes.isPending) {
		return <div>Loading...</div>;
	}

	if (notes.isError) {
		return <div>Error: {notes.error.message}</div>;
	}

	if (notes.data.length === 0) {
		return <div>No notes</div>;
	}

	return (
		<div className="p-4">
			{notes.data
				.filter((n) => !n.isArchived)
				.map((note) => (
					<div
						key={note.id}
						className="bg-white p-4 mb-3 rounded-lg shadow-sm border border-gray-200"
					>
						<div className="flex justify-between items-start">
							<p className="text-gray-800 flex-1">{note.content}</p>
							<button
								type="button"
								onClick={() => {
									void handleArchive(note.id);
								}}
								className="ml-3 bg-gray-500 text-white px-3 py-1 rounded text-sm hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
							>
								Archive
							</button>
						</div>
					</div>
				))}
		</div>
	);
};

const MainScreen = () => {
	const notes = useEffectQuery(getNotes, ["notes"]);

	if (notes.isPending) {
		return <div>Loading...</div>;
	}

	return (
		<div className="min-h-screen bg-gray-50">
			<StatusBar />
			<NoteInput />
			<AllNotes />
		</div>
	);
};

const migrationPromise = runMigrations();

const RuntimeLive: Layer.Layer<DomainSyncEngine | Database> = SyncEngineLive.pipe(
	Layer.provideMerge(WasmDatabaseLive),
	Layer.orDie,
) as Layer.Layer<DomainSyncEngine | Database>;

const runtime = ManagedRuntime.make(RuntimeLive);

export function App() {
	use(migrationPromise);

	return (
		<QueryClientProvider client={queryClient}>
			<SyncEngineProvider value={runtime}>
				<MainScreen />
			</SyncEngineProvider>
		</QueryClientProvider>
	);
}
