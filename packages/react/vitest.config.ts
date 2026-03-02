import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		environment: "jsdom",
		exclude: ["**/dist/**"],
		setupFiles: ["../../tests/setup/no-external-network.ts"],
	},
});
