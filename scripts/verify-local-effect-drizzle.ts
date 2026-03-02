import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type PackageJsonShape = {
	devDependencies?: Record<string, string>;
	overrides?: Record<string, string>;
};

type Metadata = {
	packageName?: string;
	packageVersion?: string;
	filename?: string;
	sha256?: string;
	sourceGitHead?: string;
	sourceTimestamp?: string;
	generatedAt?: string;
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_JSON_PATH = join(ROOT, "package.json");
const BUN_LOCK_PATH = join(ROOT, "bun.lock");
const VENDOR_DIR = join(ROOT, "vendor");
const METADATA_PATH = join(VENDOR_DIR, "effect-drizzle-local.json");
const VERSIONED_TARBALL_PATTERN = /^effect-drizzle-local-v.+\.tgz$/;
const VERSIONED_LOCK_REFERENCE = /vendor\/(effect-drizzle-local-v[^"\\/\s]+\.tgz)/g;
const EFFECT_DRIZZLE_DEPENDENCY = "@schnau/effect-drizzle";

type PackageReferenceResult = {
	file: string | null;
	errors: string[];
};

const readVersionedFileFromPackageJson = (
	packageJson: PackageJsonShape,
): PackageReferenceResult => {
	const dependencyValue = packageJson.devDependencies?.[EFFECT_DRIZZLE_DEPENDENCY];
	const overrideValue = packageJson.overrides?.[EFFECT_DRIZZLE_DEPENDENCY];

	if (!dependencyValue || !overrideValue) {
		return {
			file: null,
			errors: [`Expected ${EFFECT_DRIZZLE_DEPENDENCY} in both devDependencies and overrides`],
		};
	}

	if (dependencyValue !== overrideValue) {
		return {
			file: null,
			errors: [
				`package.json mismatch: devDependencies=${dependencyValue} overrides=${overrideValue}`,
			],
		};
	}

	const match = /^file:\.\/vendor\/(.+\.tgz)$/.exec(dependencyValue);
	if (!match?.[1]) {
		return {
			file: null,
			errors: [`Unexpected dependency format for ${EFFECT_DRIZZLE_DEPENDENCY}: ${dependencyValue}`],
		};
	}

	return {
		file: match[1],
		errors: [],
	};
};

const readVersionedFilesFromLock = (lockContent: string) => {
	const matches = new Set<string>();
	for (const match of lockContent.matchAll(VERSIONED_LOCK_REFERENCE)) {
		if (match[1]) {
			matches.add(match[1]);
		}
	}
	return [...matches];
};

const validateLockAndPackage = (
	packageRef: PackageReferenceResult,
	lockFiles: string[],
	errors: string[],
) => {
	errors.push(...packageRef.errors);
	if (lockFiles.length !== 1) {
		errors.push(
			`Expected exactly one versioned tarball reference in bun.lock; found ${lockFiles.length}`,
		);
	}
	const lockRef = lockFiles[0];
	if (packageRef.file && lockRef && packageRef.file !== lockRef) {
		errors.push(
			`package.json (${packageRef.file}) and bun.lock (${lockRef}) reference different tarballs`,
		);
	}
};

const validateVendorArtifacts = (packageRefFile: string | null, errors: string[]) => {
	if (!existsSync(VENDOR_DIR)) {
		errors.push(`Missing vendor directory: ${VENDOR_DIR}`);
		return;
	}

	const vendorEntries = readdirSync(VENDOR_DIR);
	const versionedTarballs = vendorEntries.filter((entry) => VERSIONED_TARBALL_PATTERN.test(entry));
	if (versionedTarballs.length !== 1) {
		errors.push(
			`Expected exactly one versioned tarball in vendor/, found ${versionedTarballs.length}`,
		);
	}

	const versionedTarball = versionedTarballs[0];
	if (packageRefFile && versionedTarball && packageRefFile !== versionedTarball) {
		errors.push(
			`vendor tarball (${versionedTarball}) does not match package.json (${packageRefFile})`,
		);
	}

	const expectedTarballPath = packageRefFile
		? join(VENDOR_DIR, packageRefFile)
		: join(VENDOR_DIR, versionedTarball ?? "");
	if (!existsSync(expectedTarballPath)) {
		errors.push(`Missing expected versioned tarball: ${expectedTarballPath}`);
	}

	const aliasPath = join(VENDOR_DIR, "effect-drizzle-local.tgz");
	if (!existsSync(aliasPath)) {
		errors.push(`Missing compatibility alias tarball: ${aliasPath}`);
	}
};

const validateMetadata = (packageRefFile: string | null, errors: string[]) => {
	if (!existsSync(METADATA_PATH)) {
		errors.push(`Missing metadata file: ${METADATA_PATH}`);
		return;
	}

	const metadata = JSON.parse(readFileSync(METADATA_PATH, "utf8")) as Metadata;
	if (metadata.packageName !== EFFECT_DRIZZLE_DEPENDENCY) {
		errors.push(`Unexpected metadata.packageName: ${String(metadata.packageName)}`);
	}
	if (!metadata.filename) {
		errors.push("Missing metadata.filename");
	}
	if (metadata.filename && packageRefFile && metadata.filename !== packageRefFile) {
		errors.push(
			`metadata.filename (${metadata.filename}) does not match package.json (${packageRefFile})`,
		);
	}
	if (!metadata.sha256) {
		errors.push("Missing metadata.sha256");
	}
	if (metadata.filename && metadata.sha256) {
		const metadataTarPath = join(VENDOR_DIR, metadata.filename);
		if (!existsSync(metadataTarPath)) {
			errors.push(`metadata.filename points to missing file: ${metadataTarPath}`);
		} else {
			const actualSha = createHash("sha256").update(readFileSync(metadataTarPath)).digest("hex");
			if (actualSha !== metadata.sha256) {
				errors.push(
					`metadata.sha256 mismatch for ${metadata.filename}. expected=${metadata.sha256} actual=${actualSha}`,
				);
			}
		}
	}
	if (!metadata.sourceGitHead) {
		errors.push("Missing metadata.sourceGitHead");
	}
	if (!metadata.sourceTimestamp) {
		errors.push("Missing metadata.sourceTimestamp");
	}
	if (!metadata.generatedAt) {
		errors.push("Missing metadata.generatedAt");
	}
};

export const verifyLocalEffectDrizzle = () => {
	const errors: string[] = [];
	const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as PackageJsonShape;
	const lockContent = readFileSync(BUN_LOCK_PATH, "utf8");
	const packageRef = readVersionedFileFromPackageJson(packageJson);
	const lockFiles = readVersionedFilesFromLock(lockContent);

	validateLockAndPackage(packageRef, lockFiles, errors);
	validateVendorArtifacts(packageRef.file, errors);
	validateMetadata(packageRef.file, errors);

	return errors;
};

const main = () => {
	const errors = verifyLocalEffectDrizzle();
	if (errors.length > 0) {
		throw new Error(`Local effect-drizzle verification failed:\n- ${errors.join("\n- ")}`);
	}
	process.stdout.write("Local effect-drizzle integration verified.\n");
};

if (import.meta.main) {
	main();
}
