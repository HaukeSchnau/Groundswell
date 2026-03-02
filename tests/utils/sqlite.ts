import type { GenericDatabaseService } from "@schnau/effect-drizzle/generic-sqlite";
import { makeService } from "@schnau/effect-drizzle/libsql";
import { Effect, Layer, type ServiceMap } from "effect";

const ensurePromise = <T>(value: T | Promise<T>): Promise<T> => {
	if (value instanceof Promise) {
		return value;
	}
	return Promise.resolve(value);
};

export const makeInMemorySqliteLayer = <TSchema extends Record<string, unknown>, TagId>(
	tag: ServiceMap.Service<TagId, GenericDatabaseService<TSchema>>,
	schema: TSchema,
	ddlStatements: string[],
): Layer.Layer<TagId, unknown> =>
	Layer.effect(
		tag,
		Effect.gen(function* () {
			const service = makeService({ url: ":memory:", schema }, tag);
			for (const statement of ddlStatements) {
				yield* service.execute((db) => ensurePromise(db.run(statement)));
			}
			return service;
		}),
	);
