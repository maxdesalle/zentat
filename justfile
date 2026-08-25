# Zentat browser extension

# Development
dev:
    npm run dev

dev-firefox:
    npm run dev:firefox

# Build
build:
    npm run build

build-firefox:
    npm run build:firefox

# Package
zip:
    npm run zip

zip-firefox:
    npm run zip:firefox

# Testing
test:
    npm run test

test-unit:
    npm run test -- --run

test-e2e:
    npm run test:e2e

# Install dependencies
install:
    npm install

# Clean build artifacts
clean:
    rm -rf dist .wxt

# Prepare TypeScript definitions
prepare:
    npx wxt prepare

# Type check
typecheck:
    npm run typecheck

# Format
fmt:
    npx dprint fmt

fmt-check:
    npx dprint check

# Everything CI runs
check: typecheck fmt-check test-unit build build-firefox
