import { defineConfig, devices } from "@playwright/test";

const PORT = 5317; // web/spike/vite.config.ts

export default defineConfig({
  testDir: "web",
  testMatch: "**/*.spec.ts", // Vitest owns *.test.ts
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -w @tellall/web",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
