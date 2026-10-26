import { defineConfig } from "vitest/config";

// Each package's (and web's) own vitest.config.ts decides what it runs; web/**/*.spec.ts
// belongs to Playwright.
export default defineConfig({
  test: {
    projects: ["packages/*", "web"],
  },
});
