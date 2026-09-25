import { defineConfig, devices } from "@playwright/test";

/** Fixed E2E ports — distinct from local `pnpm dev` defaults (5173 / 2567). */
const E2E_WEB_PORT = 4173;
const E2E_GAME_SERVER_PORT = 2568;
const E2E_WEB_URL = `http://127.0.0.1:${E2E_WEB_PORT}`;
const E2E_GAME_SERVER_URL = `http://127.0.0.1:${E2E_GAME_SERVER_PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 120_000,
  expect: {
    timeout: 30_000,
  },
  use: {
    baseURL: E2E_WEB_URL,
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 720 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: `pnpm --filter @web-rts/game-server exec tsx src/main.ts`,
      url: E2E_GAME_SERVER_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        PORT: String(E2E_GAME_SERVER_PORT),
      },
    },
    {
      command: `pnpm --filter @web-rts/web exec vite --host 127.0.0.1 --port ${E2E_WEB_PORT} --strictPort`,
      url: E2E_WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        VITE_GAME_SERVER_URL: E2E_GAME_SERVER_URL,
      },
    },
  ],
});
