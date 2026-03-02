[parallel]
check: check-lint check-fmt

qa: check test build

check-lint:
	bun run checks:lint:fix-safe

check-fmt:
	bun run checks:fmt

test:
	bun run test

build:
	bun run build
