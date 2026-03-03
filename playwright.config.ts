import { defineConfig, devices } from "@playwright/test";

const E2E_PORT = Number(process.env.GROUNDSWELL_E2E_PORT ?? "3000");
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
const isCi = process.env.CI !== undefined;

export default defineConfig({
	testDir: "./e2e",
	timeout: 30_000,
	expect: {
		timeout: 10_000,
	},
	fullyParallel: false,
	workers: 1,
	retries: isCi ? 1 : 0,
	reporter: isCi ? [["github"], ["html", { open: "never" }]] : [["list"]],
	outputDir: "test-results/playwright",
	use: {
		baseURL: BASE_URL,
		trace: "retain-on-failure",
		video: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command: `GROUNDSWELL_SERVER_DB_PATH=:memory: GROUNDSWELL_SERVER_PORT=${E2E_PORT} bun --cwd examples/basic-react-app --hot src/index.ts`,
		url: BASE_URL,
		timeout: 180_000,
		reuseExistingServer: !isCi,
		stdout: "pipe",
		stderr: "pipe",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
});
