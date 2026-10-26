// The tellall page. `vite` serves it for work on it; `vite build` writes
// dist/ with _headers (build/csp.ts) and the third-party notices
// (build/licenses.ts); `vite preview` serves dist/ with those same headers,
// so the tests run under the page's real CSP.
import { defineConfig } from "vite";
import { csp, headers } from "./build/csp.ts";
import { examples } from "./build/examples.ts";
import { licenses } from "./build/licenses.ts";

const PORT = 5317;
const notices = licenses();

export default defineConfig({
  plugins: [csp(), examples(), notices.page],
  // Own port, never reused from another project.
  server: { host: "127.0.0.1", port: PORT, strictPort: true },
  preview: {
    host: "127.0.0.1",
    port: PORT,
    strictPort: true,
    headers: Object.fromEntries(headers()),
  },
  // The engine's worker is one file of its own, loaded from this origin;
  // c2pa-ts is ESM with code split points, so a module worker keeps it as is.
  worker: { format: "es", plugins: () => [notices.worker] },
  build: {
    target: "es2022",
    // Every supported browser has modulepreload.
    modulePreload: { polyfill: false },
    rollupOptions: { input: { main: "index.html", notfound: "404.html" } },
  },
});
