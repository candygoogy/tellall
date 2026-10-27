// inspect() and clean() on every fixture (golden reports in
// fixtures/expected/, written with UPDATE=1 and checked by hand against
// imagecheck/FINDINGS.md and textcheck/FINDINGS.md), and Review Focus 1–3:
// a labelled image with private data, damaged files, files tellall can't
// read.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  clean,
  inspect,
  words,
  type Input,
  type Report,
} from "../src/index.ts";
import { chunks as pngChunks } from "../src/image/strip/png.ts";

const ROOT = new URL("../../../fixtures/", import.meta.url);
const bytes = (path: string) =>
  new Uint8Array(readFileSync(new URL(path, ROOT)));
const file = (path: string, b: Uint8Array = bytes(path)): Input => ({
  kind: "file",
  name: path.split("/").at(-1) ?? path,
  bytes: b,
});
const paste = (stem: string): Input => ({
  kind: "text",
  plain: readFileSync(new URL(`text/${stem}.txt`, ROOT), "utf8"),
  html: readFileSync(new URL(`text/${stem}.html`, ROOT), "utf8"),
});
const sentences = (r: Report) => r.findings.map((f) => f.sentence);
const asBytes = (o: Uint8Array | string) => {
  if (typeof o === "string") throw new Error("expected bytes");
  return o;
};

/** A PNG's whole chunks, by type. */
const pngParts = (b: Uint8Array, type: string) =>
  pngChunks(b)
    .list.filter((c) => c.type === type)
    .map((c) => Buffer.from(b.subarray(c.start, c.end)));

/** A PNG chunk, checksum and all. */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}
function crc32(b: Uint8Array): number {
  let c = ~0;
  for (const byte of b) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

/** Inserts chunks right after IHDR. */
const afterIhdr = (png: Uint8Array, ...extra: Uint8Array[]) => {
  const at = 8 + 12 + Buffer.from(png).readUInt32BE(8);
  return new Uint8Array(
    Buffer.concat([png.subarray(0, at), ...extra, png.subarray(at)]),
  );
};

// --- Golden reports -------------------------------------------------------

const GOLDEN: [string, () => Input][] = [
  ["chatgpt-image-png", () => file("ai/chatgpt-image.png")],
  ["gemini-image-jpg", () => file("ai/gemini-image.jpg")],
  ["paint-drawing-png", () => file("ai/paint-drawing.png")],
  ["paint-drawing-jpg", () => file("ai/paint-drawing.jpg")],
  ...["chatgpt", "claude", "gemini"].flatMap((app) =>
    ["button", "select"].map((how): [string, () => Input] => [
      `${app}-web-${how}-html`,
      () => paste(`${app}-web-${how}`),
    ]),
  ),
  ["gps-jpg", () => file("photo/gps.jpg")],
  ["sample-heic", () => file("photo/sample.heic")],
  ["meta-png", () => file("photo/meta.png")],
  ["meta-webp", () => file("photo/meta.webp")],
  ["damaged-jpg", () => file("photo/damaged.jpg")],
  ["clean-jpg", () => file("photo/clean.jpg")],
];

describe("golden reports", () => {
  for (const [name, input] of GOLDEN) {
    test(name, async () => {
      const report = await inspect(input());
      const path = new URL(`expected/${name}.json`, ROOT);
      if (process.env["UPDATE"] === "1") {
        writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
      }
      expect(existsSync(path)).toBe(true);
      expect(report).toEqual(JSON.parse(readFileSync(path, "utf8")));
    });
  }
});

// --- The two AI images ----------------------------------------------------

describe("ai images", () => {
  test("chatgpt reads as spec §5.2's example", async () => {
    const r = await inspect(file("ai/chatgpt-image.png"));
    expect(r.format).toBe("png");
    expect(r.headline).toBe("This image says it was made by AI.");
    expect(sentences(r)).toEqual([
      "Signed with a certificate issued to OpenAI OpCo, LLC. The signature matches this file.",
      "Made with ChatGPT (gpt-image) on 25 Oct 2026 at 14:46:19 UTC.",
      "The label says OpenAI also put an invisible watermark in the pixels. A clean copy can't remove it.",
      "No location, camera or other personal data.",
    ]);
    expect(r.findings[0]?.group).toBe("ai-label");
    expect(r.findings.some((f) => f.kind === "private")).toBe(false);
    expect(r.empty).toBe(false);
  });

  test("gemini", async () => {
    const r = await inspect(file("ai/gemini-image.jpg"));
    expect(r.headline).toBe("This image says it was made by AI.");
    expect(sentences(r)).toEqual([
      "Signed with a certificate issued to Google LLC. The signature matches this file.",
      'The label says: "Created by Google Generative AI."',
      "The label says Google also put an invisible watermark, SynthID, in the pixels. A clean copy can't remove it, and it's made to survive common edits such as screenshots, resizing and re-saving.",
      "No location, camera or other personal data.",
    ]);
  });

  test("paint drawings carry nothing", async () => {
    for (const path of ["ai/paint-drawing.png", "ai/paint-drawing.jpg"]) {
      const r = await inspect(file(path));
      expect(r.headline).toBe(words.headline.empty);
      expect(r.findings).toEqual([]);
      expect(r.empty).toBe(true);
    }
  });

  test("the anatomy map covers the file and finds the label", async () => {
    const b = bytes("ai/chatgpt-image.png");
    const r = await inspect(file("ai/chatgpt-image.png", b));
    expect(r.anatomy).toContainEqual({
      part: "label",
      offset: 33,
      length: 21_893,
      note: "C2PA label · signed by OpenAI OpCo, LLC",
    });
    expect(r.anatomy.map((p) => p.part)).toContain("pixels");
    const g = await inspect(file("ai/gemini-image.jpg"));
    expect(g.anatomy).toContainEqual(
      expect.objectContaining({ part: "label", offset: 20, length: 13_784 }),
    );
  });

  test("every image's anatomy covers it exactly, in order", async () => {
    for (const path of [
      "ai/chatgpt-image.png",
      "ai/gemini-image.jpg",
      "ai/paint-drawing.png",
      "ai/paint-drawing.jpg",
      "photo/gps.jpg",
      "photo/sample.heic",
      "photo/iphone.heic",
      "photo/meta.png",
      "photo/meta.webp",
      "photo/damaged.jpg",
      "photo/clean.jpg",
    ]) {
      const b = bytes(path);
      const { anatomy } = await inspect(file(path, b));
      let at = 0;
      for (const piece of anatomy) {
        expect(piece.offset, path).toBe(at);
        expect(piece.length, path).toBeGreaterThan(0);
        at += piece.length;
      }
      expect(at, path).toBe(b.length);
    }
  });

  test("clean: nothing private, so the original comes back byte for byte", async () => {
    const b = bytes("ai/chatgpt-image.png");
    const out = await clean(file("ai/chatgpt-image.png", b));
    expect(out.cleaned).toBe(true);
    expect(out.output).toBe(b);
    expect(out.removed).toEqual([]);
    expect(out.notes).toEqual(["Nothing private to remove."]);
  });

  // Reads a 2.5 MB PNG twice; it took 3.8 s once under load, against the
  // 5 s default.
  test(
    "clean --remove-labels: the label goes, the notice says the watermark stays",
    { timeout: 20_000 },
    async () => {
      const b = bytes("ai/chatgpt-image.png");
      const out = await clean(file("ai/chatgpt-image.png", b), {
        removeLabels: true,
      });
      const o = asBytes(out.output);
      expect(pngParts(o, "caBX")).toEqual([]);
      expect(Buffer.concat(pngParts(o, "IDAT"))).toEqual(
        Buffer.concat(pngParts(b, "IDAT")),
      );
      expect(out.removed).toEqual(["ai-label"]);
      expect(out.notes).toEqual([
        "AI labels removed. The invisible watermark in the pixels (if any) stays; this tool can't remove it.",
      ]);
      const again = await inspect(file("x.png", o));
      expect(again.headline).toBe(words.headline.empty);
    },
  );
});

// --- Review Focus 1 -------------------------------------------------------

describe("a labelled image that also has private data", () => {
  const author = pngChunk(
    "tEXt",
    new Uint8Array(Buffer.from("Author\0Jane Doe", "latin1")),
  );

  test("the report lists both", async () => {
    const b = afterIhdr(bytes("ai/chatgpt-image.png"), author);
    const r = await inspect(file("labelled.png", b));
    expect(r.headline).toBe("This image says it was made by AI.");
    expect(r.findings).toContainEqual(
      expect.objectContaining({
        group: "other-text",
        kind: "private",
        sentence: "It names a person: Jane Doe.",
      }),
    );
    expect(sentences(r)).not.toContain(words.label.nothingElse);
  });

  test("clean drops the private data, keeps the label, says it no longer matches", async () => {
    const b = afterIhdr(bytes("ai/chatgpt-image.png"), author);
    const out = await clean(file("labelled.png", b));
    const o = asBytes(out.output);
    expect(pngParts(o, "caBX")).toEqual(pngParts(b, "caBX"));
    expect(pngParts(o, "tEXt")).toEqual([]);
    expect(out.cleaned).toBe(true);
    expect(out.removed).toEqual(["other-text"]);
    expect(out.notes).toEqual([
      "The AI label was kept, but it no longer matches this file because other data was removed.",
    ]);
    const again = await inspect(file("labelled.clean.png", o));
    expect(again.findings.filter((f) => f.kind === "private")).toEqual([]);
    expect(again.findings[0]?.group).toBe("ai-label");
    expect(again.headline).toBe("This image says it was made by AI.");
  });
});

// --- Review Focus 2 -------------------------------------------------------

describe("damaged or truncated files", () => {
  const damaged = "This file is damaged; tellall read what it could.";

  test("damaged.jpg: no throw, says so; clean refuses with a sentence", async () => {
    const r = await inspect(file("photo/damaged.jpg"));
    expect(r.format).toBe("jpeg");
    // Nothing else found: the headline says it, and it isn't repeated below.
    expect(r.headline).toBe(damaged);
    expect(r.empty).toBe(false);
    expect(sentences(r)).not.toContain(damaged);
    const out = await clean(file("photo/damaged.jpg"));
    expect(out.cleaned).toBe(false);
    expect(asBytes(out.output).length).toBe(0);
    expect(out.notes).toEqual([words.clean.damaged]);
  });

  test("a PNG cut mid-chunk, with private data: read what's there, clean safely", async () => {
    const whole = bytes("photo/meta.png");
    const idat = pngChunks(whole).list.find((c) => c.type === "IDAT");
    if (!idat) throw new Error("no IDAT");
    const cut = whole.slice(0, idat.start + 20);
    const r = await inspect(file("cut.png", cut));
    expect(sentences(r)).toContain(damaged);
    expect(r.findings.some((f) => f.group === "location")).toBe(true);
    const out = await clean(file("cut.png", cut));
    // Its picture is cut off before any whole data chunk: no clean copy.
    expect(out.cleaned).toBe(false);
    expect(asBytes(out.output).length).toBe(0);
    expect(out.notes).toEqual([words.clean.damaged]);
  });

  test("a labelled PNG cut mid-picture: the label is found, the cut is named", async () => {
    const whole = bytes("ai/chatgpt-image.png");
    const cut = whole.slice(0, Math.floor(whole.length / 2));
    const r = await inspect(file("cut.png", cut));
    // c2pa-ts can't open a PNG without its end, so the label (whole
    // itself) can't be read either.
    expect(sentences(r)).toEqual([
      damaged,
      "This image carries an AI label, but it's damaged and can't be read.",
    ]);
    expect(r.headline).toBe("This image carries an AI label.");
    expect(r.anatomy.at(-1)).toEqual(
      expect.objectContaining({ part: "other", note: "Cut short" }),
    );
    // Its one data chunk is cut: no clean copy, and a sentence why.
    const out = await clean(file("cut.png", cut));
    expect(out.cleaned).toBe(false);
    expect(asBytes(out.output).length).toBe(0);
    expect(out.notes).toEqual([words.clean.damaged]);
  });

  test("a PNG cut inside its end chunk: cleaned safely", async () => {
    const whole = bytes("photo/meta.png");
    const cut = whole.slice(0, whole.length - 6);
    const r = await inspect(file("cut.png", cut));
    expect(sentences(r)[0]).toBe(damaged);
    const out = await clean(file("cut.png", cut));
    const o = asBytes(out.output);
    expect(pngChunks(o).ended).toBe(true);
    expect(Buffer.concat(pngParts(o, "IDAT"))).toEqual(
      Buffer.concat(pngParts(cut, "IDAT")),
    );
    const again = await inspect(file("cut.clean.png", o));
    expect(again.findings).toEqual([]);
  });

  test("a PNG cut inside its label", async () => {
    const cut = bytes("ai/chatgpt-image.png").slice(0, 33 + 5_000);
    const r = await inspect(file("cut.png", cut));
    expect(sentences(r)).toEqual([
      damaged,
      "This image carries an AI label, but it's damaged and can't be read.",
    ]);
    expect(r.headline).toBe("This image carries an AI label.");
  });

  test("a JPEG cut in its scan", async () => {
    const whole = bytes("photo/gps.jpg");
    const cut = whole.slice(0, whole.length - 200);
    const r = await inspect(file("cut.jpg", cut));
    expect(sentences(r)).toContain(damaged);
    const out = await clean(file("cut.jpg", cut));
    expect(out.notes.length + asBytes(out.output).length).toBeGreaterThan(0);
  });
});

// --- Review Focus 3 -------------------------------------------------------

describe("files tellall can't read", () => {
  const avif = new Uint8Array([
    0,
    0,
    0,
    0x1c,
    ...Buffer.from("ftypavif"),
    0,
    0,
    0,
    0,
    ...Buffer.from("avifmif1miaf"),
    0,
    0,
    0,
    8,
    ...Buffer.from("mdat"),
  ]);
  const gif = new Uint8Array(
    Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "latin1"),
  );
  const pdf = new Uint8Array(
    Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n", "latin1"),
  );

  for (const [name, b] of [
    ["picture.avif", avif],
    ["animation.gif", gif],
    ["document.png", pdf],
  ] as const) {
    test(name, async () => {
      const r = await inspect({ kind: "file", name, bytes: b });
      expect(r).toEqual({
        name,
        format: "unknown",
        headline: "tellall can't read this kind of file yet.",
        findings: [],
        empty: false,
        anatomy: [],
      });
      const out = await clean({ kind: "file", name, bytes: b });
      expect(out.cleaned).toBe(false);
      expect(asBytes(out.output).length).toBe(0);
      expect(out.notes).toEqual([words.clean.unknown]);
    });
  }
});

// --- Photos ---------------------------------------------------------------

describe("photos with private data", () => {
  test("gps.jpg: every kind, and a clean copy without them", async () => {
    const r = await inspect(file("photo/gps.jpg"));
    expect(r.headline).toBe("This file gives away 5 kinds of personal data.");
    expect(r.findings.map((f) => f.group)).toEqual([
      "location",
      "device",
      "dates",
      "software",
      "other-text",
    ]);
    expect(r.findings[0]?.sentence).toBe(
      "It records the exact place it was taken: 51.4769° N, 0.0005° W.",
    );
    const out = await clean(file("photo/gps.jpg"));
    expect(out.cleaned).toBe(true);
    expect(out.removed).toEqual(r.findings.map((f) => f.group));
    expect(out.notes).toEqual([]);
    const again = await inspect(file("gps.clean.jpg", asBytes(out.output)));
    expect(again.findings).toEqual([]);
    expect(again.headline).toBe(words.headline.empty);
  });

  test("meta.png: the same moment in Exif and tIME is said once", async () => {
    const r = await inspect(file("photo/meta.png"));
    const dates = r.findings.find((f) => f.group === "dates");
    expect(dates?.sentence).toBe(
      "It records when it was taken: 1 Oct 2026 at 12:00:00.",
    );
    expect(dates?.fields.map((f) => f.from)).toEqual([
      "Exif",
      "PNG tIME chunk",
    ]);
  });

  test("a turned photo keeps its turn and nothing else", async () => {
    const out = await clean(file("photo/rotated.jpg"));
    const again = await inspect(file("rotated.clean.jpg", asBytes(out.output)));
    expect(again.findings).toEqual([]);
  });

  test("an AI-source tag outside a label is kept by clean", async () => {
    const xmp =
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      "<Iptc4xmpExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia</Iptc4xmpExt:DigitalSourceType>" +
      "<dc:creator><rdf:Seq><rdf:li>Jane Doe</rdf:li></rdf:Seq></dc:creator>" +
      "</rdf:Description></rdf:RDF></x:xmpmeta>";
    const itxt = pngChunk(
      "iTXt",
      new Uint8Array(Buffer.from(`XML:com.adobe.xmp\0\0\0\0\0${xmp}`, "utf8")),
    );
    const b = afterIhdr(bytes("ai/paint-drawing.png"), itxt);
    const r = await inspect(file("tagged.png", b));
    expect(r.headline).toBe("This image says it was made by AI.");
    expect(r.findings.map((f) => [f.group, f.kind, f.sentence])).toEqual([
      ["ai-source", "label", "A tag in the file says it was made by AI."],
      ["other-text", "private", "It names a person: Jane Doe."],
    ]);
    const out = await clean(file("tagged.png", b));
    const again = await inspect(file("tagged.clean.png", asBytes(out.output)));
    expect(again.findings.map((f) => f.group)).toEqual([
      "ai-source",
      "location",
    ]);
    expect(out.notes).toEqual([]);
  });

  test("a WebP's label: found, not read", async () => {
    const webp = bytes("photo/meta.webp");
    const png = bytes("ai/chatgpt-image.png");
    const jumbf = png.subarray(33 + 8, 33 + 21_893 - 4);
    const chunk = Buffer.alloc(8 + jumbf.length + (jumbf.length % 2));
    chunk.write("C2PA", 0, "latin1");
    chunk.writeUInt32LE(jumbf.length, 4);
    chunk.set(jumbf, 8);
    const b = Buffer.concat([webp, chunk]);
    b.writeUInt32LE(b.length - 8, 4);
    const r = await inspect(file("labelled.webp", new Uint8Array(b)));
    expect(r.headline).toBe("This image carries an AI label.");
    expect(r.findings[0]?.sentence).toBe(
      "This image carries an AI label (details can't be read for WebP yet).",
    );
    expect(r.anatomy).toContainEqual(
      expect.objectContaining({ part: "label", offset: webp.length }),
    );
  });
});

// --- Text -----------------------------------------------------------------

describe("text", () => {
  test("one hidden character", async () => {
    const r = await inspect({ kind: "text", plain: "a\u200bb" });
    expect(r.format).toBe("text");
    expect(r.headline).toBe("This text has 1 hidden character.");
    expect(sentences(r)).toEqual([
      "1 hidden character: ZERO WIDTH SPACE (U+200B). They don't show, but they travel with the text.",
    ]);
    const out = await clean({ kind: "text", plain: "a\u200bb" });
    expect(out).toEqual({
      cleaned: true,
      output: "ab",
      removed: ["hidden-chars"],
      notes: [],
    });
  });

  test("planted characters, decoded", async () => {
    const tags = [..."hi"]
      .map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0)))
      .join("");
    const plain = `x\u200b\u200by ${tags} \u202eevil\u202c`;
    const r = await inspect({ kind: "text", plain });
    expect(r.headline).toBe("This text has 6 hidden characters.");
    expect(sentences(r)).toContain(
      'Unicode tag characters spell out hidden text: "hi".',
    );
    const out = await clean({ kind: "text", plain });
    expect(out.output).toBe("xy  evil");
  });

  test("only harmless characters: no hidden ones, listed greyed", async () => {
    const plain =
      "Family \u{1F468}\u200d\u{1F469}\u200d\u{1F467}, ❤\ufe0f, می\u200cخواهم.";
    const r = await inspect({ kind: "text", plain });
    expect(r.headline).toBe("No hidden characters.");
    expect(r.findings.map((f) => [f.group, f.kind])).toEqual([
      ["hidden-chars", "harmless"],
    ]);
    const out = await clean({ kind: "text", plain });
    expect(out).toEqual({
      cleaned: true,
      output: plain,
      removed: [],
      notes: ["Nothing private to remove."],
    });
  });

  test("gemini's copy button: the link is the browser's, clean is plain text", async () => {
    const input = paste("gemini-web-button");
    const r = await inspect(input);
    expect(r.headline).toBe("This copy carries the page's address.");
    expect(r.findings.every((f) => f.group === "copy-extras")).toBe(true);
    expect(sentences(r)).toContain(
      "The copy carries the page's own styling (5 class names, 24 inline styles), which can hint at the site it came from.",
    );
    expect(r.findings[0]?.sentence).toBe(
      "The browser added the page's address to this copy: https://gemini.google.com/u/0/app/0000000000000000?pageId=none. Apps like Word and OneNote can keep it when you paste.",
    );
    for (const s of sentences(r))
      expect(s).not.toMatch(/spy|track(s|ing) you/i);
    const out = await clean(input);
    expect(out.output).toBe(input.kind === "text" ? input.plain : "");
    expect(out.removed).toEqual(["copy-extras"]);
  });

  test("headline: the page's address, other extras, or nothing", async () => {
    const styled = '<p class="a" style="color:red">hi</p>';
    const withAddress = [
      "Version:0.9",
      "SourceURL:https://chatgpt.com/c/1",
      `<html><body><!--StartFragment-->${styled}<!--EndFragment--></body></html>`,
    ].join("\r\n");
    const a = await inspect({ kind: "text", plain: "hi", html: withAddress });
    expect(a.headline).toBe("This copy carries the page's address.");
    const e = await inspect({ kind: "text", plain: "hi", html: styled });
    expect(e.headline).toBe("This copy carries extras from the page.");
    const n = await inspect({ kind: "text", plain: "hi", html: "<p>hi</p>" });
    expect(n.headline).toBe("No hidden characters.");
    const p = await inspect({ kind: "text", plain: "hi" });
    expect(p.headline).toBe("No hidden characters.");
  });

  test("hidden characters beat the page-extras headlines", async () => {
    const r = await inspect({
      kind: "text",
      plain: "h​i",
      html: '<p class="a" style="color:red">h&#8203;i</p>',
    });
    expect(r.headline).toBe("This text has 1 hidden character.");
  });

  test("a select-and-copy carries nothing", async () => {
    for (const app of ["chatgpt", "claude", "gemini"]) {
      const r = await inspect(paste(`${app}-web-select`));
      expect(r.headline).toBe("No hidden characters.");
      expect(r.findings).toEqual([]);
    }
  });
});
