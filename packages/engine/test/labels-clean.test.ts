// AI labels through a clean copy. Kept (what the page does): the label's
// blocks stay byte for byte while the private data around them goes.
// Removed (the CLI's --remove-labels): they go too. Either way the
// picture's bytes stay exactly as they were.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { startsWith } from "../src/bytes.ts";
import { readMeta } from "../src/image/read.ts";
import { cleanImage } from "../src/image/strip/index.ts";
import { segments } from "../src/image/strip/jpeg.ts";
import { chunks as pngChunks } from "../src/image/strip/png.ts";
import { chunks as webpChunks } from "../src/image/strip/webp.ts";
import { minimalXmp } from "../src/image/xmp-min.ts";
import { bytes as asciiBytes, heic, u32 } from "./craft.ts";
import { ascii, pngChunk, riff, segment, text, webpChunk } from "./forge.ts";

const KEEP = { keepLabels: true };
const DROP = { keepLabels: false };
const AI =
  "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";
const XMP_HEAD = "http://ns.adobe.com/xap/1.0/\0";
/** The C2PA box's user type in a HEIC (ISO BMFF). */
const C2PA_UUID = "d8fec3d61b0e483c92975828877ec481";

const fixture = (path: string) =>
  new Uint8Array(
    readFileSync(join(import.meta.dirname, "../../../fixtures", path)),
  );
const pixels = (b: Uint8Array) => sharp(b).raw().toBuffer();
const same = (a: Uint8Array, b: Uint8Array) =>
  Buffer.from(a).equals(Buffer.from(b));
const concat = (parts: Uint8Array[]) => Buffer.concat(parts);

/** A PNG's chunks of one type, each whole (length to checksum). */
const pngParts = (b: Uint8Array, type: string) =>
  pngChunks(b)
    .list.filter((c) => c.type === type)
    .map((c) => b.subarray(c.start, c.end));

/** A JPEG's label segments: APP11 with "jumb" near its start. */
const jpegLabels = (b: Uint8Array) =>
  segments(b)
    .list.filter(
      (s) =>
        s.marker === 0xeb &&
        text(b.subarray(s.body, Math.min(s.end, s.body + 64))).includes("jumb"),
    )
    .map((s) => b.subarray(s.start, s.end));

/** A JPEG's scans: each header and its compressed data. */
const jpegScans = (b: Uint8Array) =>
  concat(
    segments(b)
      .list.filter((s) => s.marker === 0xda)
      .map((s) => b.subarray(s.start, s.end)),
  );

/** A WebP's chunks of one type, each with its header and padding. */
const webpParts = (b: Uint8Array, type: string) =>
  webpChunks(b, 12, b.length)
    .filter((c) => c.type === type)
    .map((c) => b.subarray(c.start, c.next));

/** XMP holding an AI source type and a place. */
const sourceXmp = () =>
  `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="51,28.6140N" exif:GPSLongitude="0,0.0060W"><Iptc4xmpExt:DigitalSourceType>${AI}</Iptc4xmpExt:DigitalSourceType></rdf:Description></rdf:RDF></x:xmpmeta>`;

/** A PNG with a chunk put right after its header. */
function withChunk(b: Uint8Array, chunk: number[]): Uint8Array {
  const ihdr = pngChunks(b).list[0];
  if (!ihdr) throw new Error("no IHDR");
  return new Uint8Array([
    ...b.subarray(0, ihdr.end),
    ...chunk,
    ...b.subarray(ihdr.end),
  ]);
}

/** meta.webp (VP8X, a picture, EXIF and XMP) with more chunks inside its
 * RIFF. */
function webpWith(...extra: number[][]): Uint8Array {
  const base = fixture("photo/meta.webp");
  return new Uint8Array(riff([...base.subarray(12), ...extra.flat()]));
}

describe("PNG", () => {
  const original = fixture("ai/chatgpt-image.png");

  test("chatgpt png keeps label", () => {
    const out = cleanImage(original, "png", 1, KEEP);
    const [label] = pngParts(original, "caBX");
    if (!label) throw new Error("no caBX in the fixture");
    expect(pngParts(out, "caBX")).toEqual([label]);
    expect(
      same(concat(pngParts(out, "IDAT")), concat(pngParts(original, "IDAT"))),
    ).toBe(true);
  });

  test("chatgpt png removes label", () => {
    const out = cleanImage(original, "png", 1, DROP);
    expect(pngParts(out, "caBX")).toEqual([]);
    expect(text(out)).not.toContain("jumb");
    expect(
      same(concat(pngParts(out, "IDAT")), concat(pngParts(original, "IDAT"))),
    ).toBe(true);
  });

  test("label + private data", () => {
    const file = withChunk(
      original,
      pngChunk("tEXt", ascii("Author\0Jane Doe")),
    );
    const out = cleanImage(file, "png", 1, KEEP);
    expect(pngParts(out, "caBX")).toEqual(pngParts(original, "caBX"));
    expect(pngParts(out, "tEXt")).toEqual([]);
    expect(text(out)).not.toContain("Jane Doe");
    expect(
      same(concat(pngParts(out, "IDAT")), concat(pngParts(original, "IDAT"))),
    ).toBe(true);
  });
});

describe("JPEG", () => {
  test("gemini jpeg removes label", () => {
    const original = fixture("ai/gemini-image.jpg");
    const labels = jpegLabels(original);
    expect(labels.length).toBeGreaterThan(0);
    const out = cleanImage(original, "jpeg", 1, DROP);
    expect(jpegLabels(out)).toEqual([]);
    expect(segments(out).list.some((s) => s.marker === 0xeb)).toBe(false);
    expect(same(jpegScans(out), jpegScans(original))).toBe(true);
    // Kept, it's every one of the label's segments, byte for byte.
    const kept = cleanImage(original, "jpeg", 1, KEEP);
    expect(jpegLabels(kept)).toEqual(labels);
    expect(same(jpegScans(kept), jpegScans(original))).toBe(true);
  });

  test("digital source type survives", async () => {
    const base = fixture("photo/gps.jpg");
    expect((await readMeta(base, "jpeg"))?.["latitude"]).toBeDefined();
    const file = new Uint8Array([
      ...base.subarray(0, 2),
      ...segment(0xe1, ascii(XMP_HEAD + sourceXmp())),
      ...base.subarray(2),
    ]);
    const out = cleanImage(file, "jpeg", 1, {
      keepLabels: true,
      digitalSourceType: AI,
    });
    const xmp = segments(out).list.filter(
      (s) => s.marker === 0xe1 && startsWith(out, s.body, XMP_HEAD),
    );
    expect(xmp.length).toBe(1);
    const [only] = xmp;
    if (!only) throw new Error("no XMP");
    expect(text(out.subarray(only.body + XMP_HEAD.length, only.end))).toBe(
      minimalXmp(AI),
    );
    const meta = await readMeta(out, "jpeg");
    expect(meta?.["DigitalSourceType"]).toBe(AI);
    expect(meta?.["latitude"]).toBeUndefined();
    expect(meta?.["GPSLatitude"]).toBeUndefined();
    expect(text(out)).not.toContain("GPS");
    expect(await pixels(out)).toEqual(await pixels(base));
    // Labels removed: no XMP at all.
    const dropped = cleanImage(file, "jpeg", 1, {
      keepLabels: false,
      digitalSourceType: AI,
    });
    expect(await readMeta(dropped, "jpeg")).toBeUndefined();
  });
});

describe("WebP", () => {
  test("webp C2PA chunk", async () => {
    const label = webpChunk("C2PA", ascii("\0\0\0\x20jumb LABEL-BYTES-HERE"));
    const file = webpWith(label);
    const kept = cleanImage(file, "webp", 1, KEEP);
    expect(webpParts(kept, "C2PA").map((c) => [...c])).toEqual([label]);
    const dropped = cleanImage(file, "webp", 1, DROP);
    expect(webpParts(dropped, "C2PA")).toEqual([]);
    for (const out of [kept, dropped]) {
      expect(webpParts(out, "EXIF")).toEqual([]);
      expect(webpParts(out, "XMP ")).toEqual([]);
      const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
      expect(view.getUint32(4, true)).toBe(out.length - 8);
      expect(await pixels(out)).toEqual(await pixels(file));
    }
  });
});

describe("HEIC", () => {
  test("heic c2pa uuid", async () => {
    const base = fixture("photo/sample.heic");
    const payload = asciiBytes("\0\0\0\x20jumbLABEL-BYTES-HERE");
    const uuid = [
      ...u32(8 + 16 + payload.length),
      ...asciiBytes("uuid"),
      ...Buffer.from(C2PA_UUID, "hex"),
      ...payload,
    ];
    const file = new Uint8Array([...base, ...uuid]);
    const at = base.length;
    const kept = cleanImage(file, "heic", 1, KEEP);
    expect([...kept.subarray(at)]).toEqual(uuid);
    const removed = cleanImage(file, "heic", 1, DROP);
    expect(removed.length).toBe(file.length);
    expect(text(removed.subarray(at + 4, at + 8))).toBe("free");
    expect([...removed.subarray(at, at + 4)]).toEqual(uuid.slice(0, 4));
    expect(removed.subarray(at + 8).every((x) => x === 0)).toBe(true);
    for (const out of [kept, removed]) {
      expect(await pixels(out)).toEqual(await pixels(base));
    }
  });
});

describe("digital source type in the other formats", () => {
  test("PNG: an iTXt XMP chunk holding only the source type", async () => {
    const xmp = [
      ...ascii("XML:com.adobe.xmp\0\0\0\0\0"),
      ...ascii(sourceXmp()),
    ];
    const original = fixture("ai/chatgpt-image.png");
    const file = withChunk(original, pngChunk("iTXt", xmp));
    const out = cleanImage(file, "png", 1, { ...KEEP, digitalSourceType: AI });
    const itxt = pngParts(out, "iTXt");
    expect(itxt.length).toBe(1);
    expect(text(itxt[0]?.subarray(8, -4) ?? new Uint8Array())).toBe(
      `XML:com.adobe.xmp\0\0\0\0\0${minimalXmp(AI)}`,
    );
    expect(pngParts(out, "caBX")).toEqual(pngParts(original, "caBX"));
    expect((await readMeta(out, "png"))?.["DigitalSourceType"]).toBe(AI);
    expect(text(out)).not.toContain("GPS");
  });

  test("WebP: an XMP chunk holding only the source type, flagged", async () => {
    const file = webpWith(webpChunk("C2PA", ascii("\0\0\0\x20jumb")));
    const out = cleanImage(file, "webp", 1, { ...KEEP, digitalSourceType: AI });
    const xmp = webpChunks(out, 12, out.length).filter(
      (c) => c.type === "XMP ",
    );
    expect(xmp.length).toBe(1);
    const [only] = xmp;
    if (!only) throw new Error("no XMP");
    expect(text(out.subarray(only.body, only.body + only.size))).toBe(
      minimalXmp(AI),
    );
    expect((out[20] ?? 0) & 0x04).toBe(0x04);
    expect((out[20] ?? 0) & 0x08).toBe(0);
    expect((await readMeta(out, "webp"))?.["DigitalSourceType"]).toBe(AI);
    expect(await pixels(out)).toEqual(await pixels(file));
  });

  test("HEIC: the XMP item holding the source type is kept whole", () => {
    const packet = ascii(sourceXmp());
    const other = ascii("<x:xmpmeta>LEAK-CREATOR</x:xmpmeta>");
    const file = heic([
      { id: 1, type: "hvc1", payload: [0x77, 0x77, 0x77, 0x77] },
      { id: 2, type: "xmp", payload: packet },
      { id: 3, type: "xmp", payload: other },
    ]);
    const out = cleanImage(file, "heic", 1, { ...KEEP, digitalSourceType: AI });
    expect(out.length).toBe(file.length);
    expect(text(out)).toContain(sourceXmp());
    expect(text(out)).not.toContain("LEAK");
    // Without a source type to keep, or with labels removed, it goes.
    for (const opts of [KEEP, { ...DROP, digitalSourceType: AI }]) {
      expect(text(cleanImage(file, "heic", 1, opts))).not.toContain(
        "DigitalSourceType",
      );
    }
  });
});

test("minimalXmp holds the source type alone, escaped", () => {
  const packet = minimalXmp(AI);
  expect(packet.startsWith("<x:xmpmeta")).toBe(true);
  expect(packet.endsWith("</x:xmpmeta>")).toBe(true);
  expect(packet).toContain(`>${AI}</Iptc4xmpExt:DigitalSourceType>`);
  expect(minimalXmp('a<b&"c')).toContain("a&lt;b&amp;&quot;c");
});
