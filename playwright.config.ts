import { defineConfig, devices } from '@playwright/test';

const CLIENT_PORT = 4173;
const SERVER_PORT = 8787;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  // Port-based readiness checks, not HTTP status: the Worker 404s on a bare
  // GET / (only /ws/:code is routed), so a status-based health check never
  // resolves.
  webServer: [
    {
      command: `pnpm --filter @duo/server exec wrangler dev --port ${SERVER_PORT}`,
      port: SERVER_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `pnpm --filter @duo/client run build && pnpm --filter @duo/client exec vite preview --port ${CLIENT_PORT} --strictPort`,
      port: CLIENT_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { VITE_WS_URL: `ws://localhost:${SERVER_PORT}/ws` },
    },
  ],
});
