// Spike only (plan Task 2); web/spike/ goes away in Task 10.
import { defineConfig } from "vite";

export default defineConfig({
  // Own port so Playwright never reuses another project's dev server.
  server: { port: 5317, strictPort: true },
  // c2pa-ts is ESM with code split points; a module worker keeps it as is.
  worker: { format: "es" },
});
