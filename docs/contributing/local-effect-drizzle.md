# Local effect-drizzle Integration

This repository uses a deterministic local tarball flow for `@schnau/effect-drizzle`.
The goal is to avoid cache/path drift and keep `package.json`, `bun.lock`, and `vendor/` in sync.

## Canonical Workflow

Run from Groundswell:

```bash
bun run local:effect-drizzle:sync
bun run local:effect-drizzle:verify
bun run checks:hygiene
```

What this does:

- Repacks `../effect-drizzle` into `vendor/effect-drizzle-local-v<version>-<hash>.tgz`
- Updates `package.json` (`devDependencies` and `overrides`) to that exact filename
- Refreshes `bun.lock`
- Maintains the compatibility alias `vendor/effect-drizzle-local.tgz`
- Validates metadata in `vendor/effect-drizzle-local.json`
- Removes shadowed `examples/basic-react-app/node_modules` package copies

## Fast Paths

If `effect-drizzle` was already packed and you only want to verify integrity:

```bash
bun run local:effect-drizzle:verify
```

If you want to repack without reinstalling Groundswell deps:

```bash
bun run local:effect-drizzle:repack
```

## Troubleshooting

### `package.json` and `bun.lock` reference different tarballs

Run:

```bash
bun run local:effect-drizzle:sync
```

### Missing `vendor/effect-drizzle-local.json`

Run:

```bash
bun run local:effect-drizzle:repack
```

### More than one versioned tarball in `vendor/`

Repack to normalize:

```bash
bun run local:effect-drizzle:repack
```

### Generated `.js` files appear under `examples/basic-react-app/src`

The example tsconfig is configured with `noEmit: true`, but if stale files exist:

```bash
find examples/basic-react-app/src -name '*.js' -delete
bun run checks:hygiene
```

### `examples/basic-react-app/node_modules` exists

This can reintroduce type universe drift. Remove it and reinstall at workspace root:

```bash
rm -rf examples/basic-react-app/node_modules
bun install
bun run checks:hygiene
```
