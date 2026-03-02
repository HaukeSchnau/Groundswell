import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyLocalEffectDrizzle } from "./verify-local-effect-drizzle.ts";

type CliOptions = {
	effectDrizzleRoot: string;
	skipBuild: boolean;
	skipInstall: boolean;
	verifyOnly: boolean;
};

type PackedArtifact = {
	filename: string;
	path: string;
	version: string;
	sha256: string;
	metadataPath: string;
};

type PackageJsonShape = {
	devDependencies?: Record<string, string>;
	overrides?: Record<string, string>;
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_JSON_PATH = resolve(ROOT, "package.json");
const BUN_LOCK_PATH = resolve(ROOT, "bun.lock");
const VENDOR_DIR = resolve(ROOT, "vendor");
const VERSIONED_TARBALL_PATTERN = /^effect-drizzle-local-v.+\.tgz$/;
const LOCK_REFERENCE_REGEX = /vendor\/(effect-drizzle-local-v[^"\\/\s]+\.tgz)/g;

const parseArgs = (args: string[]): CliOptions => {
	const options: CliOptions = {
		effectDrizzleRoot: resolve(ROOT, "../effect-drizzle"),
		skipBuild: false,
		skipInstall: false,
		verifyOnly: false,
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
		if (arg === "--verify-only") {
			options.verifyOnly = true;
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

const ensureLockReferencedTarballsExist = (fallbackFilename: string) => {
	const lockContent = readFileSync(BUN_LOCK_PATH, "utf8");
	const fallbackTarballPath = join(VENDOR_DIR, fallbackFilename);
	const aliasTarballPath = join(VENDOR_DIR, "effect-drizzle-local.tgz");

	for (const match of lockContent.matchAll(LOCK_REFERENCE_REGEX)) {
		const filename = match[1];
		if (!filename) {
			continue;
		}
		const path = join(VENDOR_DIR, filename);
		if (existsSync(path)) {
			continue;
		}

		if (existsSync(aliasTarballPath)) {
			copyFileSync(aliasTarballPath, path);
			continue;
		}

		if (existsSync(fallbackTarballPath)) {
			copyFileSync(fallbackTarballPath, path);
		}
	}
};

const pruneVersionedTarballs = (activeFilename: string) => {
	for (const entry of readdirSync(VENDOR_DIR)) {
		if (!VERSIONED_TARBALL_PATTERN.test(entry)) {
			continue;
		}
		if (entry === activeFilename) {
			continue;
		}
		rmSync(join(VENDOR_DIR, entry), { force: true });
	}
};

const assertVerified = () => {
	const errors = verifyLocalEffectDrizzle();
	if (errors.length > 0) {
		throw new Error(`Local effect-drizzle verification failed:\n- ${errors.join("\n- ")}`);
	}
};

const main = () => {
	const options = parseArgs(process.argv.slice(2));
	if (options.verifyOnly) {
		assertVerified();
		process.stdout.write("Local effect-drizzle integration verified.\n");
		return;
	}

	const artifact = repackLocalEffectDrizzle(options);

	updateManifest(artifact.filename);
	clearShadowedLocalPackageInstalls();

	if (!options.skipInstall) {
		ensureLockReferencedTarballsExist(artifact.filename);
		installWorkspaceDependencies();
		pruneVersionedTarballs(artifact.filename);
		assertVerified();
	} else {
		process.stdout.write(
			`Repacked local effect-drizzle tarball: ${artifact.path}. Run 'bun install' and 'bun run local:effect-drizzle:verify' to finish synchronization.\n`,
		);
		return;
	}

	process.stdout.write(
		`Synced local effect-drizzle tarball: ${artifact.path} (version ${artifact.version}, sha256 ${artifact.sha256})\n`,
	);
};

main();
