// The AI label (C2PA) in the ChatGPT and Gemini fixtures, read the same way
// in Node as in the page's worker. The signer, actions and exact times are
// the ones in the files (imagecheck/FINDINGS.md, spike-c2pa.md).
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { readLabel, unescapeDn } from "../src/c2pa/read.ts";
import { crc32 } from "../src/image/crc32.ts";

const ROOT = new URL("../../../", import.meta.url);
const fixture = async (path: string) =>
  new Uint8Array(await readFile(new URL(path, ROOT)));
const text = (b: Uint8Array, from: number, to: number) =>
  Buffer.from(b.subarray(from, to)).toString("latin1");
const view = (b: Uint8Array) =>
  new DataView(b.buffer, b.byteOffset, b.byteLength);

const AI_MEDIA =
  "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";
/** Where the label sits in each fixture (c2pa-ts's hash exclusion). */
const CHATGPT_RANGE = { offset: 33, length: 21_893 };
const GEMINI_RANGE = { offset: 20, length: 13_784 };

/** The PNG's chunks: type, start and end. */
function pngChunks(b: Uint8Array) {
  const list: { type: string; start: number; end: number }[] = [];
  for (let i = 8; i + 12 <= b.length;) {
    const end = i + 12 + view(b).getUint32(i);
    list.push({ type: text(b, i + 4, i + 8), start: i, end });
    i = end;
  }
  return list;
}

describe("chatgpt image", () => {
  test("signer, signature, generator and the created action", async () => {
    const label = await readLabel(
      await fixture("fixtures/ai/chatgpt-image.png"),
      "png",
    );
    if (!label) throw new Error("no label");
    expect(label.signer).toBe("OpenAI OpCo, LLC");
    expect(label.signatureMatches).toBe(true); // trust-list/chain codes ignored
    expect(label.generator).toBe("OpenAI Media Service API");
    expect(label.actions).toContainEqual({
      action: "c2pa.created",
      when: "2026-10-25T14:46:19.830385961Z",
      agent: "ChatGPT gpt-image",
      agentName: "ChatGPT",
      agentVersion: "gpt-image",
      description: null,
      sourceType: AI_MEDIA,
    });
    expect(label.actions.map((a) => a.action)).toEqual(
      expect.arrayContaining(["c2pa.converted", "c2pa.watermarked.unbound"]),
    );
    expect(label.digitalSourceType).toBe(AI_MEDIA);
    expect(label.watermarkStated).toBe(true);
    expect(label.ingredients).toBe(0);
    expect(label.detailsUnavailable).toBe(false);
  });

  test("the range is the caBX chunk", async () => {
    const bytes = await fixture("fixtures/ai/chatgpt-image.png");
    const label = await readLabel(bytes, "png");
    expect(label?.range).toEqual(CHATGPT_RANGE);
    const { offset, length } = CHATGPT_RANGE;
    expect(text(bytes, offset + 4, offset + 8)).toBe("caBX");
    expect(12 + view(bytes).getUint32(offset)).toBe(length);
  });

  test("show everything lists where each field came from", async () => {
    const label = await readLabel(
      await fixture("fixtures/ai/chatgpt-image.png"),
      "png",
    );
    expect(label?.fields).toEqual(
      expect.arrayContaining([
        { name: "Signer", value: "OpenAI OpCo, LLC", from: "C2PA signature" },
        {
          name: "claim_generator_info",
          value: "OpenAI Media Service API",
          from: "C2PA claim",
        },
        {
          name: "when",
          value: "2026-10-25T14:46:19.830385961Z",
          from: "C2PA c2pa.actions.v2, action 1",
        },
      ]),
    );
    for (const f of label?.fields ?? []) expect(f.value).not.toBe("");
  });

  test("one IDAT byte flipped: the signature no longer matches", async () => {
    const bytes = await fixture("fixtures/ai/chatgpt-image.png");
    const idat = pngChunks(bytes).find((c) => c.type === "IDAT");
    if (!idat) throw new Error("no IDAT");
    const at = idat.start + 8 + 10;
    bytes[at] = (bytes[at] ?? 0) ^ 0xff;
    // A real edit keeps the chunk's checksum right.
    const crc = crc32(bytes.subarray(idat.start + 4, idat.end - 4));
    view(bytes).setUint32(idat.end - 4, crc);
    const label = await readLabel(bytes, "png");
    expect(label?.signer).toBe("OpenAI OpCo, LLC");
    expect(label?.signatureMatches).toBe(false);
  });
});

describe("gemini image", () => {
  test("signer, signature and the history from both manifests", async () => {
    const label = await readLabel(
      await fixture("fixtures/ai/gemini-image.jpg"),
      "jpeg",
    );
    if (!label) throw new Error("no label");
    expect(label.signer).toBe("Google LLC");
    expect(label.signatureMatches).toBe(true);
    expect(label.generator).toBe(
      "Google C2PA Core Generator Library 1003583797:1003583797",
    );
    // The file's descriptions end with a full stop; FINDINGS.md dropped it.
    expect(label.actions.map((a) => [a.action, a.description])).toEqual([
      ["c2pa.created", "Created by Google Generative AI."],
      ["c2pa.edited", "Applied imperceptible SynthID watermark."],
      ["c2pa.opened", "Opened by Google Generative AI."],
      ["c2pa.resized", "Resized by Google Generative AI."],
    ]);
    expect(label.digitalSourceType).toBe(AI_MEDIA);
    expect(label.watermarkStated).toBe(true);
    expect(label.ingredients).toBe(1);
    expect(label.detailsUnavailable).toBe(false);
  });

  test("the range is the APP11 segments", async () => {
    const bytes = await fixture("fixtures/ai/gemini-image.jpg");
    const label = await readLabel(bytes, "jpeg");
    expect(label?.range).toEqual(GEMINI_RANGE);
    const { offset, length } = GEMINI_RANGE;
    // Only whole APP11 segments from offset to offset + length.
    let i = offset;
    while (i < offset + length) {
      expect([bytes[i], bytes[i + 1]]).toEqual([0xff, 0xeb]);
      expect(text(bytes, i + 4, i + 6)).toBe("JP");
      i += 2 + view(bytes).getUint16(i + 2);
    }
    expect(i).toBe(offset + length);
    expect(bytes[i + 1]).not.toBe(0xeb);
  });
});

describe("no label", () => {
  test.each([
    ["fixtures/ai/paint-drawing.png", "png"],
    ["fixtures/ai/paint-drawing.jpg", "jpeg"],
    ["fixtures/photo/meta.webp", "webp"],
    ["fixtures/photo/iphone.heic", "heic"],
    ["fixtures/photo/damaged.jpg", "jpeg"],
  ] as const)("%s", async (path, type) => {
    expect(await readLabel(await fixture(path), type)).toBeNull();
  });
});

describe("webp", () => {
  test("a C2PA chunk is found, its details aren't read", async () => {
    const webp = await fixture("fixtures/photo/meta.webp");
    expect(text(webp, 12, 16)).toBe("VP8X"); // extended format, so chunks may follow
    const png = await fixture("fixtures/ai/chatgpt-image.png");
    const { offset, length } = CHATGPT_RANGE;
    const jumbf = png.subarray(offset + 8, offset + length - 4);
    const chunk = new Uint8Array(8 + jumbf.length + (jumbf.length % 2));
    chunk.set([..."C2PA"].map((c) => c.charCodeAt(0)));
    view(chunk).setUint32(4, jumbf.length, true);
    chunk.set(jumbf, 8);
    const bytes = new Uint8Array(webp.length + chunk.length);
    bytes.set(webp);
    bytes.set(chunk, webp.length);
    view(bytes).setUint32(4, bytes.length - 8, true);

    const label = await readLabel(bytes, "webp");
    if (!label) throw new Error("no label");
    expect(label.detailsUnavailable).toBe(true);
    expect(label.signatureMatches).toBeNull();
    expect(label.signer).toBeNull();
    expect(label.actions).toEqual([]);
    expect(label.range).toEqual({ offset: webp.length, length: chunk.length });
  });
});

describe("damaged label data never throws", () => {
  test("a PNG cut in the middle of its label", async () => {
    const bytes = await fixture("fixtures/ai/chatgpt-image.png");
    const cut = bytes.slice(0, CHATGPT_RANGE.offset + 5_000);
    const label = await readLabel(cut, "png");
    expect(label?.detailsUnavailable).toBe(true);
    expect(label?.signatureMatches).toBeNull();
    expect(label?.range).toEqual({
      offset: CHATGPT_RANGE.offset,
      length: cut.length - CHATGPT_RANGE.offset,
    });
  });

  test("a label whose bytes are scrambled", async () => {
    const bytes = await fixture("fixtures/ai/chatgpt-image.png");
    const { offset, length } = CHATGPT_RANGE;
    for (let i = offset + 40; i < offset + length - 4; i += 7) bytes[i] = 0x5a;
    const label = await readLabel(bytes, "png");
    expect(label).not.toBeNull();
    expect(label?.range).toEqual(CHATGPT_RANGE);
    expect(label?.signatureMatches).not.toBe(true);
  });

  test("a label changed after signing: read, but it doesn't match", async () => {
    const bytes = await fixture("fixtures/ai/chatgpt-image.png");
    const at = Buffer.from(bytes).indexOf("gpt-image");
    bytes[at] = "G".charCodeAt(0);
    const label = await readLabel(bytes, "png");
    expect(label?.detailsUnavailable).toBe(false);
    expect(label?.signatureMatches).toBe(false);
    expect(label?.actions[0]?.agent).toBe("ChatGPT Gpt-image");
    expect(label?.fields).toContainEqual({
      name: "Check failed",
      value: "assertion.hashedURI.mismatch",
      from: "C2PA signature check",
    });
  });

  test("a JPEG whose label segments were cut short", async () => {
    const bytes = await fixture("fixtures/ai/gemini-image.jpg");
    const cut = bytes.slice(0, GEMINI_RANGE.offset + 3_000);
    const label = await readLabel(cut, "jpeg");
    expect(label?.detailsUnavailable).toBe(true);
    expect(label?.range?.offset).toBe(GEMINI_RANGE.offset);
  });
});

describe("unescapeDn", () => {
  test("escaped comma and other RFC 4514 escapes", () => {
    expect(unescapeDn("O=OpenAI OpCo\\, LLC,CN=x")).toBe(
      "O=OpenAI OpCo, LLC,CN=x",
    );
    expect(unescapeDn("CN=a\\+b\\;c\\\\d\\#e")).toBe("CN=a+b;c\\d#e");
  });
  test("hex pairs are UTF-8 bytes", () => {
    expect(unescapeDn("O=Caf\\C3\\A9 \\2C x")).toBe("O=Café , x");
  });
});
