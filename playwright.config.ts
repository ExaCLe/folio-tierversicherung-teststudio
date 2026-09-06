import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const appURL = process.env.FOLIO_E2E_APP_URL ?? 'http://127.0.0.1:5174';
const apiURL = 'http://127.0.0.1:3002';

export default defineConfig({
  testDir: process.env.FOLIO_REPLAY === '1' ? './.local/testing/runs' : './e2e',
  testMatch: process.env.FOLIO_REPLAY === '1' ? '**/*.spec.ts' : ['**/agriculture-*.spec.ts', '**/testing-*.spec.ts'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  outputDir: './.local/playwright-results',
  reporter: [['list'], ['html', { outputFolder: '.local/playwright-report', open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'], baseURL: appURL,
    viewport: { width: 1440, height: 1050 }, locale: 'de-DE', timezoneId: 'Europe/Berlin',
    reducedMotion: 'reduce', trace: 'retain-on-failure', screenshot: 'only-on-failure',
    actionTimeout: 15_000, navigationTimeout: 30_000,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } } : {}),
  },
  webServer: process.env.FOLIO_E2E_APP_URL ? undefined : [
    {
      command: 'node --import tsx server/index.ts', url: `${apiURL}/api/health`, reuseExistingServer: false,
      timeout: 30_000,
      env: { PORT: '3002', FOLIO_APP_URL: appURL, FOLIO_DATA_FILE: resolve(`.local/e2e/folio-${randomUUID()}.json`), FOLIO_AUTO_REUSE: '0', NODE_ENV: 'test' },
    },
    {
      command: 'npm run dev:client -- --port 5174 --strictPort', url: appURL,
      reuseExistingServer: false, timeout: 30_000, env: { FOLIO_API_TARGET: apiURL },
    },
  ],
});
