const originalFetch = globalThis.fetch;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const isLoopbackUrl = (input: URL): boolean => {
	if (input.protocol !== "http:" && input.protocol !== "https:") {
		return true;
	}
	return LOOPBACK_HOSTS.has(input.hostname);
};

const resolveUrl = (input: Parameters<typeof fetch>[0]): URL | null => {
	if (typeof input === "string") {
		return new URL(input, "http://localhost");
	}
	if (input instanceof URL) {
		return input;
	}
	if (typeof Request !== "undefined" && input instanceof Request) {
		return new URL(input.url);
	}
	return null;
};

if (typeof originalFetch === "function") {
	const guardedFetch = ((
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	) => {
		const url = resolveUrl(input);
		if (url !== null && !isLoopbackUrl(url)) {
			throw new Error(
				`External network request blocked during tests: ${url.toString()}. Use localhost fixtures instead.`,
			);
		}
		return originalFetch(input, init);
	}) as typeof fetch;

	Object.assign(guardedFetch, originalFetch);
	globalThis.fetch = guardedFetch;
}

export const noExternalNetworkSetup = true;
