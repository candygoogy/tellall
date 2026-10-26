import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Every test runs the built CLI in a new Node process.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
