import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyLocalEffectDrizzle } from "./verify-local-effect-drizzle.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASIC_REACT_APP_DIR = join(ROOT, "examples/basic-react-app");
const BASIC_REACT_APP_SRC = join(BASIC_REACT_APP_DIR, "src");

const findGeneratedJavaScriptFiles = (directory: string): string[] => {
	const entries = readdirSync(directory, { withFileTypes: true });
	const matches: string[] = [];

	for (const entry of entries) {
		const fullPath = join(directory, entry.name);
		if (entry.isDirectory()) {
			matches.push(...findGeneratedJavaScriptFiles(fullPath));
			continue;
		}
		if (entry.isFile() && fullPath.endsWith(".js")) {
			matches.push(relative(ROOT, fullPath));
		}
	}

	return matches;
};

const main = () => {
	const errors: string[] = [];

	const generatedJavaScriptFiles = findGeneratedJavaScriptFiles(BASIC_REACT_APP_SRC);
	if (generatedJavaScriptFiles.length > 0) {
		errors.push(
			`Generated JavaScript files found in examples/basic-react-app/src: ${generatedJavaScriptFiles.join(", ")}`,
		);
	}

	const shadowNodeModulesPath = join(BASIC_REACT_APP_DIR, "node_modules");
	if (existsSync(shadowNodeModulesPath)) {
		errors.push(
			`Shadow node_modules detected: ${relative(ROOT, shadowNodeModulesPath)}. Remove it and use workspace-level installs only.`,
		);
	}

	errors.push(...verifyLocalEffectDrizzle());

	if (errors.length > 0) {
		throw new Error(`Repo hygiene check failed:\n- ${errors.join("\n- ")}`);
	}

	process.stdout.write("Repo hygiene OK.\n");
};

main();
