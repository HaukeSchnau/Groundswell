import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type CliOptions = {
	effectDrizzleRoot: string;
	skipBuild: boolean;
	skipInstall: boolean;
};

type PackedArtifact = {
	filename: string;
	path: string;
};

type PackageJsonShape = {
	devDependencies?: Record<string, string>;
	overrides?: Record<string, string>;
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_JSON_PATH = resolve(ROOT, "package.json");

const parseArgs = (args: string[]): CliOptions => {
	const options: CliOptions = {
		effectDrizzleRoot: resolve(ROOT, "../effect-drizzle"),
		skipBuild: false,
		skipInstall: false,
	};

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--effect-drizzle-root") {
			const root = args[index + 1];
			if (!root) {
				throw new Error("Missing value for --effect-drizzle-root");
			}
			options.effectDrizzleRoot = resolve(process.cwd(), root);
			index += 1;
			continue;
		}
		if (arg === "--skip-build") {
			options.skipBuild = true;
			continue;
		}
		if (arg === "--skip-install") {
			options.skipInstall = true;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}

	return options;
};

const run = (command: string, args: string[], cwd: string) => {
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});

	if (result.status !== 0) {
		const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
		throw new Error(`Command failed (${command} ${args.join(" ")}):\n${output}`);
	}

	return result.stdout;
};

const repackLocalEffectDrizzle = (options: CliOptions): PackedArtifact => {
	const args = ["scripts/pack-local.ts", "--destination", resolve(ROOT, "vendor"), "--json"];
	if (options.skipBuild) {
		args.push("--skip-build");
	}

	const stdout = run("bun", args, options.effectDrizzleRoot).trim();
	return JSON.parse(stdout) as PackedArtifact;
};

const updateManifest = (filename: string) => {
	const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as PackageJsonShape;
	const dependencySpec = `file:./vendor/${filename}`;

	if (!packageJson.devDependencies || !packageJson.overrides) {
		throw new Error("Expected devDependencies and overrides in package.json");
	}

	packageJson.devDependencies["@schnau/effect-drizzle"] = dependencySpec;
	packageJson.overrides["@schnau/effect-drizzle"] = dependencySpec;

	writeFileSync(PACKAGE_JSON_PATH, `${JSON.stringify(packageJson, null, "\t")}\n`);
};

const clearShadowedLocalPackageInstalls = () => {
	const shadowPaths = [
		resolve(ROOT, "examples/basic-react-app/node_modules/@schnau/effect-drizzle"),
		resolve(ROOT, "examples/basic-react-app/node_modules/drizzle-orm"),
		resolve(ROOT, "examples/basic-react-app/node_modules/effect"),
	];

	for (const shadowPath of shadowPaths) {
		if (!existsSync(shadowPath)) {
			continue;
		}
		rmSync(shadowPath, { recursive: true, force: true });
	}
};

const installWorkspaceDependencies = () => {
	run("bun", ["install"], ROOT);
};

const main = () => {
	const options = parseArgs(process.argv.slice(2));
	const artifact = repackLocalEffectDrizzle(options);

	updateManifest(artifact.filename);
	clearShadowedLocalPackageInstalls();

	if (!options.skipInstall) {
		installWorkspaceDependencies();
	}

	process.stdout.write(`Synced local effect-drizzle tarball: ${artifact.path}\n`);
};

main();
