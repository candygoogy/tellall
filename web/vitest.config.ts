import { defineConfig } from "vitest/config";

// Vitest runs web/test/*.test.ts; *.spec.ts belongs to Playwright.
export default defineConfig({
  test: {
    name: "web",
    include: ["test/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
