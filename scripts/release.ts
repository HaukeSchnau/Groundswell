import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DEFAULT_REGISTRY = "https://npm.schnau.dev/";

type Flags = {
	dryRun: boolean;
	registry: string;
	skipBump: boolean;
	skipInstall: boolean;
	skipTests: boolean;
	skipBuild: boolean;
	skipPublish: boolean;
};

function usage(): string {
	return [
		"Usage:",
		"  bun run release <patch|minor|major|prepatch|preminor|premajor|prerelease|<semver>> [flags]",
		"",
		"Flags:",
		"  --registry <url>   Registry to publish to (default: https://npm.schnau.dev/)",
		"  --dry-run          Use npm's --dry-run for publish (still runs bump/build unless skipped)",
		"  --skip-bump        Do not change versions",
		"  --skip-install     Do not run bun install (lockfile may not update)",
		"  --skip-tests       Do not run root tests",
		"  --skip-build       Do not run per-package build",
		"  --skip-publish     Do not publish to the registry",
	].join("\n");
}

function die(msg: string, code = 1): never {
	console.error(msg);
	process.exit(code);
}

function run(cmd: [string, ...string[]], cwd: string): void {
	const pretty = cmd.map((c) => (c.includes(" ") ? JSON.stringify(c) : c)).join(" ");
	console.log(`\n$ (cd ${cwd}) ${pretty}`);

	const r = Bun.spawnSync([...cmd], {
		cwd,
		env: process.env,
		stdin: "ignore",
		stdout: "inherit",
		stderr: "inherit",
	});
	if (r.exitCode !== 0) process.exit(r.exitCode);
}

function readJson(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}

function listPublishablePackages(): {
	dir: string;
	name: string;
	version: string;
}[] {
	const packagesDir = join(ROOT, "packages");
	const entries = readdirSync(packagesDir, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.toSorted();

	const out: { dir: string; name: string; version: string }[] = [];
	for (const entry of entries) {
		const dir = join(packagesDir, entry);
		const pkgPath = join(dir, "package.json");
		try {
			const pkg = readJson(pkgPath);
			if (pkg == null || typeof pkg !== "object") continue;
			const packageJson = pkg as Record<string, unknown>;
			if (packageJson.private) continue;
			if (typeof packageJson.name !== "string" || typeof packageJson.version !== "string") {
				continue;
			}
			out.push({
				dir,
				name: packageJson.name,
				version: packageJson.version,
			});
		} catch {
			// skip
		}
	}
	return out;
}

function parseArgs(argv: string[]): { bump: string; flags: Flags } {
	const flags: Flags = {
		dryRun: false,
		registry: DEFAULT_REGISTRY,
		skipBump: false,
		skipInstall: false,
		skipTests: false,
		skipBuild: false,
		skipPublish: false,
	};

	let bump = "";
	let i = 0;
	while (i < argv.length) {
		const a = argv[i];
		if (a == null) {
			break;
		}
		if (!a.startsWith("-") && bump === "") {
			bump = a;
			i++;
			continue;
		}

		if (a === "--help" || a === "-h") die(usage(), 0);
		if (a === "--dry-run") {
			flags.dryRun = true;
			i++;
			continue;
		}
		if (a === "--skip-bump") {
			flags.skipBump = true;
			i++;
			continue;
		}
		if (a === "--skip-install") {
			flags.skipInstall = true;
			i++;
			continue;
		}
		if (a === "--skip-tests") {
			flags.skipTests = true;
			i++;
			continue;
		}
		if (a === "--skip-build") {
			flags.skipBuild = true;
			i++;
			continue;
		}
		if (a === "--skip-publish") {
			flags.skipPublish = true;
			i++;
			continue;
		}
		if (a === "--registry") {
			const v = argv[i + 1];
			if (!v) die(`Missing value for --registry\n\n${usage()}`);
			flags.registry = v;
			i += 2;
			continue;
		}

		die(`Unknown arg: ${a}\n\n${usage()}`);
	}

	if (!bump) die(`Missing required bump argument.\n\n${usage()}`);
	return { bump, flags };
}

const { bump, flags } = parseArgs(process.argv.slice(2));

const pkgs = listPublishablePackages();
if (pkgs.length === 0) die("No publishable packages found under ./packages/*");

console.log("Release plan:");
console.log(`- Registry: ${flags.registry}`);
console.log(`- Bump: ${flags.skipBump ? "(skipped)" : bump}`);
console.log(`- Packages: ${pkgs.map((p) => `${p.name}@${p.version}`).join(", ")}`);
console.log(
	`- Steps: ${[
		flags.skipTests ? null : "tests",
		flags.skipBump ? null : "bump",
		flags.skipInstall ? null : "install",
		flags.skipBuild ? null : "build",
		flags.skipPublish ? null : flags.dryRun ? "publish(dry-run)" : "publish",
	]
		.filter(Boolean)
		.join(" -> ")}`,
);

// Preflight auth (only if publishing)
if (!flags.skipPublish) {
	run(["npm", "whoami", "--registry", flags.registry], ROOT);
}

if (!flags.skipTests) {
	run(["bun", "run", "test"], ROOT);
}

if (!flags.skipBump) {
	for (const p of pkgs) {
		run(["npm", "version", bump, "--no-git-tag-version"], p.dir);
	}
}

if (!flags.skipInstall) {
	run(["bun", "install"], ROOT);
}

if (!flags.skipBuild) {
	for (const p of pkgs) {
		run(["npm", "run", "-s", "build"], p.dir);
	}
}

if (!flags.skipPublish) {
	for (const p of pkgs) {
		const cmd: [string, ...string[]] = ["npm", "publish", "--registry", flags.registry];
		if (flags.dryRun) cmd.push("--dry-run");
		run(cmd, p.dir);
	}
}

console.log("\nRelease complete.");
