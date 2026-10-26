// Bundles the command and the engine into dist/tellall.js. The engine's
// own dependencies stay outside it: npm installs them with the package.
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = (p) => fileURLToPath(new URL(p, import.meta.url));
const pkg = JSON.parse(readFileSync(path("package.json"), "utf8"));

await build({
  entryPoints: [path("src/main.ts")],
  outfile: path("dist/tellall.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  external: Object.keys(pkg.dependencies),
  define: { TELLALL_VERSION: JSON.stringify(pkg.version) },
  legalComments: "none",
  logLevel: "warning",
});
