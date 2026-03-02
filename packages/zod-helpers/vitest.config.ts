import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		exclude: ["**/dist/**"],
		setupFiles: ["../../tests/setup/no-external-network.ts"],
	},
});
