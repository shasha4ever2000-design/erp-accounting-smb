// End-to-end smoke tests: the real app, built, in a real browser.
// Run with `npm run e2e` (builds first). Vitest covers the accounting engine;
// these cover the wiring between screens that unit tests can't see.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:4173/erp-accounting-smb/',
    viewport: { width: 1360, height: 860 },
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/erp-accounting-smb/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
