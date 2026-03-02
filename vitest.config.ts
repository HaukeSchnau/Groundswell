import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: ["packages/*"],
		exclude: ["**/dist/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "lcov"],
			include: ["packages/*/src/**/*.ts", "packages/*/src/**/*.tsx"],
			exclude: [
				"**/*.test.ts",
				"**/*.test.tsx",
				"**/dist/**",
				"tests/**",
				"examples/**",
				"packages/*/src/index.ts",
				"packages/*/src/interface.ts",
				"packages/*/src/sample.ts",
			],
			thresholds: {
				"packages/core/src/**": {
					lines: 75,
					branches: 65,
				},
				"packages/core-server/src/**": {
					lines: 75,
					branches: 65,
				},
				"packages/adapter-sse-client/src/**": {
					lines: 75,
					branches: 65,
				},
				"packages/adapter-hono-server/src/**": {
					lines: 70,
					branches: 60,
				},
				"packages/adapter-bun-server/src/**": {
					lines: 70,
					branches: 60,
				},
				"packages/adapter-drizzle-sqlite/src/**": {
					lines: 70,
					branches: 60,
				},
				"packages/adapter-drizzle-postgres/src/**": {
					lines: 65,
					branches: 55,
				},
				"packages/react/src/**": {
					lines: 70,
					branches: 60,
				},
				"packages/zod-helpers/src/**": {
					lines: 90,
					branches: 85,
				},
			},
		},
	},
});
