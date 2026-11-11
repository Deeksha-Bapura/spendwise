import { defineConfig, devices } from "@playwright/test";

// Its own port, so a `pnpm dev` server on 3000 is never mistaken for the test server.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Optional: use an installed browser instead of `playwright install`.
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
          : {},
      },
    },
  ],
  // Runs against a production build: `pnpm build` first (CI does this).
  webServer: {
    command: `pnpm start -p ${PORT}`,
    // Parallel tests sign in many times per second from one IP.
    env: { AUTH_RATE_LIMIT: "false", BETTER_AUTH_URL: baseURL },
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
