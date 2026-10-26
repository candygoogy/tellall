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
