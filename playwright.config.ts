import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm dev:api",
      url: "http://127.0.0.1:8000/health",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @card-condition-vault/web dev:e2e",
      url: "http://127.0.0.1:3100/workspace",
      reuseExistingServer: false,
      timeout: 90_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
