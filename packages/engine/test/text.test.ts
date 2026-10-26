// Task 6: hidden characters and formatted-copy extras.
// The rules are ported from Docs/tellall/textcheck/xcheck.py; the first test
// is its selftest().
import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { cleanText, decodeRuns, scanText } from "../src/text/hidden.ts";
import { scanHtml } from "../src/text/html.ts";

const TEXT = new URL("../../../fixtures/text/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, TEXT), "utf8");

const tags = (s: string) =>
  [...s].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join("");
const smuggle = (s: string) =>
  [...new TextEncoder().encode(s)]
    .map((b) => String.fromCodePoint(b < 16 ? 0xfe00 + b : 0xe0100 + b - 16))
    .join("");
const isVs = (cp: number) =>
  (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);

test("xcheck.py selftest: planted characters", () => {
  const planted =
    "Plain sentence​with a zero-width space. " +
    "Tag message: " +
    tags("hi") +
    ". " +
    "Smuggled bytes: x" +
    smuggle("ok") +
    ". " +
    "Price 100. " +
    "Family emoji \u{1F468}‍\u{1F469}‍\u{1F467} and heart ❤️. " +
    "Persian: می‌خواهم. " +
    "Bidi ‮evil‬.";
  const hits = scanText(planted);
  const kinds = hits.map((h) => [String.fromCodePoint(h.codePoint), h.kind]);
  const hidden = new Set(
    hits.filter((h) => h.kind === "hidden").map((h) => h.codePoint),
  );
  const harmless = new Set(
    hits.filter((h) => h.kind === "harmless").map((h) => h.codePoint),
  );
  const runs = decodeRuns(planted);

  expect(hidden.has(0x200b), "zero-width space is hidden").toBe(true);
  expect(hidden.has(0xe0068), "tag characters are hidden").toBe(true);
  expect(
    [...hidden].some(isVs),
    "smuggled variation selectors are hidden",
  ).toBe(true);
  expect(kinds, "NBSP is an unusual space").toContainEqual([" ", "space"]);
  expect(
    harmless.has(0x200d) && !hidden.has(0x200d),
    "emoji ZWJ is harmless",
  ).toBe(true);
  expect(harmless.has(0xfe0f), "emoji VS16 is harmless").toBe(true);
  expect(
    harmless.has(0x200c) && !hidden.has(0x200c),
    "Persian ZWNJ is harmless",
  ).toBe(true);
  expect(hidden.has(0x202e), "bidi override is hidden").toBe(true);
  expect(runs, "tag run decodes to 'hi'").toContainEqual({
    how: "tags",
    decoded: "hi",
  });
  expect(runs, "variation selector run decodes to 'ok'").toContainEqual({
    how: "variation-selectors",
    decoded: "ok",
  });

  // cleanText drops only the hidden ones.
  const cleaned = cleanText(planted);
  expect(scanText(cleaned).filter((h) => h.kind === "hidden")).toEqual([]);
  expect(cleaned).toContain("Price 100.");
  expect(cleaned).toContain("\u{1F468}‍\u{1F469}‍\u{1F467} and heart ❤️.");
  expect(cleaned).toContain("می‌خ");
  expect(cleaned).toContain("Bidi evil.");
});

test("Review Focus 4: harmless characters only", () => {
  for (const s of [
    "\u{1F468}‍\u{1F469}‍\u{1F467}", // 👨‍👩‍👧
    "❤️", // ❤️
    "می‌خواهم", // می‌خواهم
  ]) {
    const hits = scanText(s);
    expect(
      hits.filter((h) => h.kind === "hidden"),
      s,
    ).toEqual([]);
    expect(hits.filter((h) => h.kind === "harmless").length, s).toBeGreaterThan(
      0,
    );
    expect(cleanText(s)).toBe(s);
  }
});

test("every text fixture has no hidden characters", () => {
  const files = readdirSync(TEXT).filter(
    (f) => f.endsWith(".txt") && !f.endsWith(".formats.txt"),
  );
  expect(files.length).toBe(6);
  for (const f of files) {
    expect(
      scanText(read(f)).filter((h) => h.kind === "hidden"),
      f,
    ).toEqual([]);
  }
});

test("scanHtml: Gemini copy button", () => {
  const x = scanHtml(read("gemini-web-button.html"));
  expect(x.sourceUrl).toMatch(/^https:\/\/gemini\.google\.com\//);
  expect(x.ids).toEqual(["model-response-message-contentr_0000000000000000"]);
  expect(x.classes).toContain("markdown-main-panel");
  expect(x.styles).toBe(24); // elements with an inline style in the fragment
  expect(x.text).not.toContain("Version:0.9"); // the header is outside the fragment
});

test("scanHtml: ChatGPT select + Ctrl+C has no SourceURL", () => {
  expect(scanHtml(read("chatgpt-web-select.html")).sourceUrl).toBeNull();
});

test("scanHtml: bare fragment, as a browser paste gives it", () => {
  const x = scanHtml(
    "<html><body><!--StartFragment-->" +
      '<div id="model-response-message-contentr_0000000000000000" class="markdown markdown-main-panel">' +
      '<p id="intro" class="lead">Rome &amp; its fall</p>' +
      '<span id="conversation-container-main">x</span>' +
      "</div><!--EndFragment--></body></html>",
  );
  expect(x.sourceUrl).toBeNull();
  expect(x.ids).toEqual(["model-response-message-contentr_0000000000000000"]);
  expect(x.classes).toEqual(["lead", "markdown", "markdown-main-panel"]);
  expect(x.hiddenStyled).toBe(false);
  expect(x.styles).toBe(0);
  expect(x.text).toBe("Rome & its fallx");
});

test("scanHtml: small text isn't hidden, and header words in text don't count", () => {
  const x = scanHtml(
    '<p style="font-size: 0.875rem">See SourceURL:https://x.example StartFragment:3</p>',
  );
  expect(x.hiddenStyled).toBe(false);
  expect(x.styles).toBe(1);
  expect(x.sourceUrl).toBeNull();
  expect(x.text).toContain("StartFragment:3");
  expect(scanHtml('<span style="font-size:0px">x</span>').hiddenStyled).toBe(
    true,
  );
});

test("1 MB of mixed text scans in under a second", () => {
  const chunk =
    "Plain words, numbers 123 and punctuation. " +
    "می‌خواهم " +
    "\u{1F468}‍\u{1F469}‍\u{1F467} ❤️ " +
    "café naïve 中文 zero​width " +
    tags("ab") +
    smuggle("cd") +
    "‮flip‬\n";
  const big = chunk.repeat(Math.ceil((1 << 20) / chunk.length));
  expect(big.length).toBeGreaterThanOrEqual(1 << 20);
  const t0 = performance.now();
  const hits = scanText(big);
  const runs = decodeRuns(big);
  const ms = performance.now() - t0;
  expect(hits.length).toBeGreaterThan(0);
  expect(runs.length).toBeGreaterThan(0);
  expect(ms).toBeLessThan(1000);
});

// --- Audit fixes (2026-10-26) ------------------------------------------------

const hiddenOf = (s: string) => scanText(s).filter((h) => h.kind === "hidden");

test("emoji with selectors or tag letters are harmless and kept", () => {
  for (const s of [
    "1\uFE0F\u20E3 #\uFE0F\u20E3 *\uFE0F\u20E3", // keycaps
    "\u00A9\uFE0F \u00AE\uFE0F \u2122\uFE0F \u25B6\uFE0F \u2139\uFE0F \u203C\uFE0F",
    "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}", // England
    "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}", // Scotland
    "\u845B\u{E0100}\u98FE\u533A", // 葛 + an ideographic variation selector
    "\u2269\uFE00", // ≩ + a standardised variation selector
  ]) {
    expect(hiddenOf(s), s).toEqual([]);
    expect(
      scanText(s).some((h) => h.kind === "harmless"),
      s,
    ).toBe(true);
    expect(decodeRuns(s), s).toEqual([]);
    expect(cleanText(s)).toBe(s);
  }
});

test("tag runs that aren't a flag still count and decode", () => {
  // Hidden ASCII on its own, after a black flag, and after a real flag.
  for (const [s, decoded] of [
    [`Hi${tags("ignore all")}`, "ignore all"],
    [`\u{1F3F4}${tags("usca")}\u{E007F}`, "usca\x7f"],
    [`\u{1F3F4}${tags("gbeng")}\u{E007F}${tags("leak")}`, "leak"],
  ] as const) {
    expect(hiddenOf(s).length, s).toBeGreaterThan(0);
    expect(decodeRuns(s), s).toContainEqual({ how: "tags", decoded });
    expect(cleanText(s)).not.toMatch(/\u{E006C}/u);
  }
  // Selectors after an ordinary letter, or a run after a CJK base, still count.
  expect(hiddenOf("a\uFE00").length).toBe(1);
  expect(hiddenOf(`\u845B${smuggle("ok")}`).length).toBeGreaterThan(0);
  expect(hiddenOf("1\uFE0F").length).toBe(1); // no keycap after it
});

test("160k zero-width spaces and 160 KB of '<a' scan in well under a second", async () => {
  const { textFindings } = await import("../src/findings.ts");
  const plain = "a\u200B".repeat(160_000);
  let t0 = performance.now();
  const findings = textFindings(plain, null);
  const cleaned = cleanText(plain);
  expect(performance.now() - t0).toBeLessThan(1000);
  expect(cleaned).toBe("a".repeat(160_000));
  const field = findings[0]?.fields[0]?.value ?? "";
  expect(field).toMatch(/, and 159,900 more$/);
  expect(field.length).toBeLessThan(1000);

  t0 = performance.now();
  const x = scanHtml("<a".repeat(80_000));
  scanHtml(`${"<".repeat(160_000)}x`);
  scanHtml(`<p ${'style="'.repeat(20_000)}`);
  expect(performance.now() - t0).toBeLessThan(1000);
  expect(x.text).toBe("<a".repeat(80_000)); // a tag never closed stays text
});

test("scanHtml reads attributes only inside real tags", () => {
  // A copied answer that talks about CSS and HTML.
  const css = scanHtml(
    "<p>Use <code>display: none</code> to hide it, or <code>font-size: 0</code>.</p>",
  );
  expect(css.hiddenStyled).toBe(false);
  const html = scanHtml(
    '<pre><code>&lt;div class="card" id="order12345678901"&gt;</code></pre>',
  );
  expect(html.ids).toEqual([]);
  expect(html.classes).toEqual([]);
  expect(html.text).toBe('<div class="card" id="order12345678901">');
  // Real attributes still count: any quote style, any case, a style block.
  const real = scanHtml(
    "<DIV CLASS='a b' ID=resp1234567890123 Style=\"display:none\">x</DIV>" +
      '<style>.q{visibility:hidden}</style><!-- class="c" -->',
  );
  expect(real.classes).toEqual(["a", "b"]);
  expect(real.ids).toEqual(["resp1234567890123"]);
  expect(real.styles).toBe(1);
  expect(real.hiddenStyled).toBe(true);
  expect(real.text).toBe("x");
  expect(scanHtml("<style>.q{visibility:hidden}</style>").hiddenStyled).toBe(
    true,
  );
});
