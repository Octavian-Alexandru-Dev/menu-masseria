import { defineConfig, devices } from "@playwright/test";
import "dotenv/config";
import { config as loadEnv } from "dotenv";

// Credenziali degli account di test cameriere/cucina (vedi .env.test, non
// committato — creato dallo script di setup, non dal codice dell'app).
loadEnv({ path: ".env.test" });

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  timeout: 15_000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
