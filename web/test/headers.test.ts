// The built page's headers (spec §7.4, plan Task 10): dist/_headers forbids
// every connection and allows exactly the inline scripts index.html has,
// by their hashes. Also what else the build writes: the third-party
// notices, the social card's text, the reader's first result. Builds the
// page into a folder of its own first.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "@tellall/engine";
import { build } from "vite";
import { afterAll, beforeAll, expect, test } from "vitest";
import { esc } from "../src/dom.ts";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
let out = "";
let csp = "";
let html = "";
let notices = "";

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
  notices = readFileSync(join(out, "third-party-licenses.txt"), "utf8");
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

test("the CSP allows pictures from the page and the visitor's blobs only", () => {
  const img = csp.split(/;\s*/).find((d) => d.startsWith("img-src"));
  expect(img).toBe("img-src 'self' blob:");
});

test("the notices list each bundled version of a package", () => {
  // Two versions of each are bundled: one at the top of node_modules, one
  // nested under the package that needs the older one.
  const version = (dir: string) =>
    (
      JSON.parse(
        readFileSync(join(ROOT, "node_modules", dir, "package.json"), "utf8"),
      ) as { version: string }
    ).version;
  for (const [name, dirs] of [
    ["tslib", ["tslib", "tsyringe/node_modules/tslib"]],
    ["@noble/hashes", ["@noble/hashes", "pkijs/node_modules/@noble/hashes"]],
  ] as const) {
    const listed = dirs.map((d) => `${name} ${version(d)} (`);
    expect(new Set(listed).size).toBe(2);
    for (const line of listed) expect(notices).toContain(line);
  }
});

test("the social card has its text and the site's name", () => {
  for (const tag of [
    /<meta property="og:site_name" content="tellall">/,
    /<meta property="og:image:alt" content="[^"]{20,}">/,
    /<meta name="twitter:image:alt" content="[^"]{20,}">/,
  ])
    expect(html).toMatch(tag);
});

test("the reader's first result is in index.html, as the engine reads it", async () => {
  const name = "chatgpt-image.png";
  const report = await inspect({
    kind: "file",
    name,
    bytes: new Uint8Array(readFileSync(join(ROOT, "fixtures", "ai", name))),
  });
  const view = html.slice(
    html.indexOf('id="r-view"'),
    html.indexOf('id="r-live"'),
  );
  expect(view).toContain(
    `<h2 class="rv-headline" tabindex="-1">${esc(report.headline)}</h2>`,
  );
  expect((view.match(/class="finding"/g) ?? []).length).toBe(
    report.findings.length,
  );
  expect(view).toContain('class="bar an-main"');
});
