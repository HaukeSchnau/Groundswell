[parallel]
check: check-toolchain check-hygiene check-lint check-fmt

qa: check test build

check-toolchain:
	bun run check:toolchain

check-hygiene:
	bun run checks:hygiene

check-lint:
	bun run checks:lint:fix-safe

check-fmt:
	bun run checks:fmt

test:
	bun run test

build:
	bun run build
