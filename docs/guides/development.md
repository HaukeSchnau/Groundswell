# Development Guide

## Prerequisites

- Bun
- Node-compatible environment for workspace tooling

## Install

```bash
bun install
```

## Run Checks

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

## Workspace Structure

- `packages/` publishable libraries
- `examples/` runnable examples
- `docs/` architecture/reference/guides

## Working On Packages

Each package has its own `package.json` scripts for build/typecheck/publish semantics.

Common pattern:
- Build package: `bun run --filter '<package-name>' build`
- Typecheck package: `bun run --filter '<package-name>' typecheck`

## Testing Strategy

- Runtime behavior tests are currently strongest in core packages.
- Adapter packages have partial test coverage.
- For storage/transport changes, prefer integration tests against real adapters.

## Release Tooling

- Release workflow entrypoint: `scripts/release.ts`
- Workspace publish scripts are package-scoped (`pub`, `bump`)

## Documentation Maintenance Rules

- Keep architecture/reference docs under `docs/**`.
- Keep package-specific docs in each package `README.md`.
- Keep example-specific docs in each example `README.md`.
- Avoid root-level ad-hoc markdown docs.
