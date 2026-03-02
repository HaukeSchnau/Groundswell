import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type PackageJsonShape = {
	engines?: {
		bun?: string;
	};
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = resolve(ROOT, "package.json");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJsonShape;
const expectedBunVersion = packageJson.engines?.bun?.trim();

if (!expectedBunVersion) {
	throw new Error("package.json is missing engines.bun");
}

const normalize = (version: string) => version.trim().replace(/^v/, "");
const actualBunVersion = normalize(Bun.version);
const expected = normalize(expectedBunVersion);

if (actualBunVersion !== expected) {
	throw new Error(
		`Unsupported Bun version ${actualBunVersion}. Expected Bun ${expected}. Install the expected version and retry.`,
	);
}

process.stdout.write(`Bun toolchain OK (${actualBunVersion})\n`);
