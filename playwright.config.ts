import { defineConfig, devices } from "@playwright/test";

const PORT = 5317; // web/vite.config.ts

// The page's end-to-end tests run on the built page (dist/), served by
// `vite preview` with the same headers as dist/_headers, so they run under
// the page's real Content-Security-Policy.
export default defineConfig({
  testDir: "web/test",
  testMatch: "**/*.spec.ts", // Vitest owns *.test.ts
  reporter: "list",
  timeout: 60_000,
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build -w @tellall/web && npm run preview -w @tellall/web",
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
