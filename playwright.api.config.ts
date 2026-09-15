import { defineConfig, devices } from '@playwright/test';

const dataDir = `.data/e2e-api-${process.pid}`;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/api-e2e.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5174',
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : undefined,
  },
  webServer: [
    {
      command: 'npm --prefix server run db:migrate && npm --prefix server run db:bootstrap && npm --prefix server run dev',
      url: 'http://127.0.0.1:3001/api/v1/health/ready',
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        API_PORT: '3001',
        APP_ORIGINS: 'http://127.0.0.1:5174',
        DATABASE_MODE: 'pglite',
        PGLITE_DATA_DIR: dataDir,
        BOOTSTRAP_ADMIN_NAME: 'Prueba API',
        BOOTSTRAP_ADMIN_EMAIL: 'api-e2e@example.test',
        BOOTSTRAP_ADMIN_PASSWORD: 'Una clave E2E segura 2026!',
      },
    },
    {
      command: 'npm run dev -- --port 5174',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 30_000,
      env: { ...process.env, VITE_USE_API: 'true' },
    },
  ],
});