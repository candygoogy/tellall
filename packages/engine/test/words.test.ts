// Every sentence in words/en.ts, called with sample data: none may say
// real, fake, verified, trusted or authentic (spec §2, §5.4).
import { expect, test } from "vitest";
import { en, type Moment } from "../src/words/en.ts";

const BANNED = /\b(real|fake|verified|trusted|authentic)\b/i;

const when: Moment = {
  year: 2026,
  month: 10,
  day: 25,
  hour: 14,
  minute: 46,
  second: 19,
  utc: true,
};

/** Sample arguments for each sentence function, by its path in `en`; each
 * function is called with every list given. */
const SAMPLES: Record<string, unknown[][]> = {
  "headline.personal": [[1], [3]],
  "headline.hidden": [[1], [4]],
  "label.signed": [
    ["OpenAI OpCo, LLC", true],
    ["Google LLC", false],
    ["Example Signer", null],
  ],
  "label.unsigned": [[true], [false], [null]],
  "label.agent": [
    ["ChatGPT", "gpt-image"],
    ["Real Camera App", null],
  ],
  "label.madeWith": [
    ["ChatGPT (gpt-image)", when],
    ["Google C2PA Core Generator Library", null],
  ],
  "label.says": [
    ["Created by Google Generative AI.", null],
    ["Created by Google Generative AI.", when],
    ["Made by a tool", null],
  ],
  "label.watermark": [["OpenAI"], [null]],
  source: [
    ["trainedAlgorithmicMedia"],
    ["compositeWithTrainedAlgorithmicMedia"],
    ["digitalCapture"],
    ["somethingNew"],
  ],
  "location.gps": [[51.4769, -0.0005]],
  "location.places": [[["Greenwich", "London"]]],
  "device.camera": [["Example Cam 1"]],
  "device.lens": [["Example 35mm"]],
  "device.serials": [[["123"]], [["123", "456"]]],
  "dates.taken": [[when], [{ year: 2026, month: 10, day: 1 }]],
  "dates.saved": [[when]],
  "dates.other": [["2026"]],
  software: [[["Example Editor 2"]], [["A", "B", "C"]]],
  ids: [[["xmp.did:1"]], [["a", "b"]]],
  "otherText.names": [[["Test Person"]], [["A", "B"]]],
  "otherText.contact": [[["a@example.com"]]],
  "otherText.caption": [[["A caption"]]],
  "otherText.comment": [[["Made for a test"]]],
  "otherText.text": [[["parameters: a cat"]]],
  "text.hidden": [
    [1, ["ZERO WIDTH SPACE (U+200B)"]],
    [3, ["A", "B"]],
  ],
  "text.decodedTags": [["hi"]],
  "text.decodedSelectors": [["ok"]],
  "text.spaces": [[1, ["NO-BREAK SPACE (U+00A0)"]]],
  "text.harmless": [[2, ["ZERO WIDTH JOINER (U+200D) ×2"]]],
  "text.char": [
    ["ZERO WIDTH SPACE", 0x200b, 1],
    ["TAG LATIN SMALL LETTER H", 0xe0068, 2],
  ],
  "copy.sourceUrl": [["https://chatgpt.com/c/00000000"]],
  "copy.ids": [[["model-response-1"]], [["a1", "b2"]]],
  "copy.styling": [
    [5, 24],
    [1, 0],
    [0, 1],
  ],
  "clean.heicXmpKept": [[["creator", "CreatorTool"]]],
  removeLabels: [["chatgpt-image.png"], ["my photo's.png"]],
  webHint: [["chatgpt-image.png"]],
  "anatomy.label": [["OpenAI OpCo, LLC"], [null]],
};

/** Every string and function in `en`, by path. */
function* walk(
  node: unknown,
  path: string[] = [],
): Generator<[string, unknown]> {
  if (typeof node === "string" || typeof node === "function") {
    yield [path.join("."), node];
    return;
  }
  if (typeof node === "object" && node !== null) {
    for (const [k, v] of Object.entries(node)) yield* walk(v, [...path, k]);
  }
}

test("no sentence uses a banned word", () => {
  let checked = 0;
  const used = new Set<string>();
  for (const [path, value] of walk(en)) {
    if (typeof value === "string") {
      expect(value, path).not.toMatch(BANNED);
      checked++;
      continue;
    }
    const samples = SAMPLES[path];
    expect(samples, `sample data for ${path}`).toBeDefined();
    used.add(path);
    for (const args of samples ?? []) {
      const out = (value as (...a: unknown[]) => unknown)(...args);
      expect(typeof out, path).toBe("string");
      // A sample may itself hold a banned word (a maker's name): only
      // the sentence around it counts.
      let words = out as string;
      for (const a of args.flat()) {
        if (typeof a === "string") words = words.replace(a, "");
      }
      expect(words, path).not.toMatch(BANNED);
      checked++;
    }
  }
  expect(Object.keys(SAMPLES).filter((k) => !used.has(k))).toEqual([]);
  expect(checked).toBeGreaterThan(60);
});

test("the banned-word check catches them", () => {
  for (const w of ["Real", "FAKE", "verified", "Trusted", "authentic"]) {
    expect(`This is ${w}.`).toMatch(BANNED);
  }
  expect("Really unverified").not.toMatch(BANNED);
});

test("exact copy from the plan's Global Constraints", () => {
  expect(en.headline.empty).toBe(
    "No marks found. That doesn't prove anything: many apps and sites strip them.",
  );
  expect(en.label.signed("X", true)).toBe(
    "Signed with a certificate issued to X. The signature matches this file.",
  );
  expect(en.label.signed("X", false)).toBe(
    "Signed with a certificate issued to X. The signature doesn't match this file (it was changed after signing).",
  );
  expect(en.clean.labelChanged).toBe(
    "The AI label was kept, but it no longer matches this file because other data was removed.",
  );
  expect(en.clean.nothing).toBe("Nothing private to remove.");
  expect(en.clean.labelsRemoved).toBe(
    "AI labels removed. The invisible watermark in the pixels (if any) stays; this tool can't remove it.",
  );
  expect(en.webHint("photo.png")).toBe(
    "Want the label gone too? On files you own: npx tellall clean --remove-labels photo.png. The invisible watermark stays either way.",
  );
  // A name a shell would split, run or read as an option stays one word.
  expect(en.removeLabels("cat $(touch pwned) ; echo.png")).toBe(
    "npx tellall clean --remove-labels 'cat $(touch pwned) ; echo.png'",
  );
  expect(en.removeLabels("Bob's photo.png")).toBe(
    "npx tellall clean --remove-labels 'Bob'\\''s photo.png'",
  );
  expect(en.removeLabels("-rf.png")).toBe(
    "npx tellall clean --remove-labels ./-rf.png",
  );
  expect(en.label.madeWith("ChatGPT (gpt-image)", when)).toBe(
    "Made with ChatGPT (gpt-image) on 25 Oct 2026 at 14:46:19 UTC.",
  );
  expect(en.label.watermark("OpenAI")).toBe(
    "The label says OpenAI also put an invisible watermark in the pixels. A clean copy can't remove it.",
  );
  expect(en.label.webp).toBe(
    "This image carries an AI label (details can't be read for WebP yet).",
  );
  expect(en.headline.personal(3)).toBe(
    "This file gives away 3 kinds of personal data.",
  );
  expect(en.headline.hidden(2)).toBe("This text has 2 hidden characters.");
  expect(en.label.says("Created by Google Generative AI.", null)).toBe(
    'The label says: "Created by Google Generative AI."',
  );
  expect(en.label.says("Created by X.", when)).toBe(
    'The label says: "Created by X." on 25 Oct 2026 at 14:46:19 UTC.',
  );
  expect(en.copy.styling(5, 3)).toBe(
    "The copy carries the page's own styling (5 class names, 3 inline styles), which can hint at the site it came from.",
  );
  expect(en.copy.styling(0, 1)).toBe(
    "The copy carries the page's own styling (1 inline style), which can hint at the site it came from.",
  );
});
