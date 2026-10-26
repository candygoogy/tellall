import { defineConfig, devices } from "@playwright/test";

const PORT = 5318; // the preview port in web/vite.config.ts

// The page's end-to-end tests run on the built page (dist/), served by
// `vite preview` with the same headers as dist/_headers, so they run under
// the page's real Content-Security-Policy.
export default defineConfig({
  testDir: "web/test",
  testMatch: "**/*.spec.ts", // Vitest owns *.test.ts
  reporter: "list",
  timeout: 60_000,
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  // Chromium, Firefox and WebKit: the page runs in all three.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "npm run build -w @tellall/web && npm run preview -w @tellall/web",
    url: `http://127.0.0.1:${PORT}`,
    // Always build and serve the real page: a server already on the port
    // might be stale or the dev server, which has no headers.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
