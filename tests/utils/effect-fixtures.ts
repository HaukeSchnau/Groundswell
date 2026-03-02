import { Effect, Layer, Ref, type ServiceMap } from "effect";

export const makeRef = <A>(value: A): Ref.Ref<A> => Effect.runSync(Ref.make(value));

export const makeLayer = <Id, Service>(
	tag: ServiceMap.Service<Id, Service>,
	service: Service,
): Layer.Layer<Id> => Layer.succeed(tag, tag.of(service));
