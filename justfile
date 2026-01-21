# Zentat browser extension

# Development
dev:
    bun run dev

dev-firefox:
    bun run dev:firefox

# Build
build:
    bun run build

build-firefox:
    bun run build:firefox

# Package
zip:
    bun run zip

zip-firefox:
    bun run zip:firefox

# Testing
test:
    bun run test

test-unit:
    bun run test --run

test-e2e:
    bun run test:e2e

# Install dependencies
install:
    bun install

# Clean build artifacts
clean:
    rm -rf dist .wxt

# Prepare TypeScript definitions
prepare:
    bunx wxt prepare
