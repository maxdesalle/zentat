import { defineConfig } from '@playwright/test';

// E2E tests load the built Chrome extension (run `npm run build` first).
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    headless: true,
  },
});
