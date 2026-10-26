// The page's Content-Security-Policy and the dist/_headers file that
// serves it (from Photo check's experiments/shared/vite.ts, cspFor and
// the _headers writing). connect-src 'none': the browser itself blocks any
// upload. The one inline script (head.js, before first paint) is allowed
// by its hash, taken from the same text that's inlined, so editing the
// script can never leave a stale hash behind.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

const HEAD = new URL("./head.js", import.meta.url);

/** head.js as it goes into the page: its comments dropped, nothing else. */
export function headScript(): string {
  return readFileSync(HEAD, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n")
    .trim();
}

export const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("base64");

export function cspFor(script: string): string {
  return [
    "default-src 'self'",
    "connect-src 'none'",
    "img-src 'self' blob: data:",
    "style-src 'self'",
    `script-src 'self' 'sha256-${sha256(script)}'`,
    "font-src 'self'",
    // The engine's Web Worker comes from the page's own files, never a blob.
    "worker-src 'self'",
    // No plugins, so no <object> or <embed> either.
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/** Every header the page is served with, as name and value. */
export function headers(): [string, string][] {
  return [
    ["Content-Security-Policy", cspFor(headScript())],
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    // The page asks for no camera, microphone or location.
    ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
    ["Cross-Origin-Opener-Policy", "same-origin"],
    // HTTPS only, for this subdomain alone (no includeSubDomains, no
    // preload: those are the zone's call).
    ["Strict-Transport-Security", "max-age=31536000"],
  ];
}

const TAG = "<!-- head-script -->";

/** Inlines head.js where index.html says, and writes dist/_headers. */
export function csp(): Plugin {
  return {
    name: "tellall-csp",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (!html.includes(TAG)) {
          if (ctx.path.endsWith("/index.html")) {
            throw new Error(`index.html has no ${TAG}`);
          }
          return html;
        }
        return html.replace(TAG, () => `<script>${headScript()}</script>`);
      },
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: [
          "/*",
          ...headers().map(([name, value]) => `  ${name}: ${value}`),
          "",
          "/assets/*",
          "  Cache-Control: public, max-age=31536000, immutable",
          "",
        ].join("\n"),
      });
    },
  };
}
