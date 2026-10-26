// The built page's headers (spec §7.4, plan Task 10): dist/_headers forbids
// every connection and allows exactly the inline scripts index.html has,
// by their hashes. Builds the page into a folder of its own first.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterAll, beforeAll, expect, test } from "vitest";

const WEB = fileURLToPath(new URL("..", import.meta.url));
let out = "";
let csp = "";
let html = "";

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "tellall-web-"));
  await build({
    root: WEB,
    configFile: join(WEB, "vite.config.ts"),
    logLevel: "silent",
    build: { outDir: out, emptyOutDir: true },
  });
  const headers = readFileSync(join(out, "_headers"), "utf8");
  csp = /Content-Security-Policy: (.*)/.exec(headers)?.[1] ?? "";
  html = readFileSync(join(out, "index.html"), "utf8");
});

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

test("the CSP allows no connections", () => {
  expect(csp).toContain("connect-src 'none'");
  expect(csp).not.toContain("unsafe-inline");
  expect(csp).not.toContain("unsafe-eval");
});

test("the CSP allows each inline script by its hash", () => {
  const inline = [
    ...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
  ].map((m) => m[1] ?? "");
  expect(inline.length).toBeGreaterThan(0);
  for (const script of inline) {
    const hash = createHash("sha256").update(script).digest("base64");
    expect(csp).toContain(`'sha256-${hash}'`);
  }
});

test("the page loads nothing from anywhere else", () => {
  const urls = [
    ...html.matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)="([^"]+)"/g),
  ].map((m) => m[1] ?? "");
  expect(urls.length).toBeGreaterThan(0);
  // Only the page's own files; the canonical link names its own address.
  expect(
    urls.filter(
      (u) =>
        /^(https?:)?\/\//.test(u) &&
        !u.startsWith("https://tellall.candygoogy.dev/"),
    ),
  ).toEqual([]);
});
