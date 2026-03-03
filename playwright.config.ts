import { defineConfig, devices } from "@playwright/test";

const E2E_PORT = Number(process.env.GROUNDSWELL_E2E_PORT ?? "3000");
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
const isCi = process.env.CI !== undefined;
const dbPath = `/tmp/groundswell-e2e-${E2E_PORT}.sqlite`;

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
		command: `rm -f ${dbPath} && GROUNDSWELL_SERVER_DB_PATH=${dbPath} GROUNDSWELL_SERVER_PORT=${E2E_PORT} bun run --filter basic-react-app dev`,
		url: BASE_URL,
		timeout: 180_000,
		reuseExistingServer: !isCi,
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
});
