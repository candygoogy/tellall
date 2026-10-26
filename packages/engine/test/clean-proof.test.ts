// Crafted photos carrying every kind of metadata, in every place it can
// hide, for each format the page cleans. A clean copy must keep the
// picture (every pixel, and its colours) and nothing else: no
// place, no Exif, no XMP, no IPTC, no maker note, no comment, no
// Content Credentials, no unknown block, no trailing data; the colour
// profile without its words and dates (icc.test.ts). And the summary must
// have seen what was there.
//
// The crafted files carry Content Credentials (C2PA) too. The tests that
// expect every block gone clean them with labels removed (DROP); the rest
// keep labels (KEEP, what the page does), which for a file without one
// changes nothing.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import {
  CantClean,
  heifLayout,
  heifMeta,
  itemBytes,
} from "../src/image/heif.ts";
import { cleanIcc } from "../src/image/icc.ts";
import { readImage } from "../src/image/read.ts";
import { cleanImage, stripHeic } from "../src/image/strip/index.ts";
import { segments } from "../src/image/strip/jpeg.ts";
import { chunks as pngChunks } from "../src/image/strip/png.ts";
import { chunks as webpChunks } from "../src/image/strip/webp.ts";
import { sentences, summarize } from "./photo-summary.ts";
import {
  box,
  bytes as asciiBytes,
  exifPayload,
  FTYP,
  full,
  ARTIST,
} from "./craft.ts";
import {
  ascii,
  compressedItxt,
  exifTiff,
  leaks,
  LEAK,
  photoshop,
  pngChunk,
  rawProfile,
  riff,
  segment,
  text,
  u16,
  u32,
  webpChunk,
  xmp,
} from "./forge.ts";

const KEEP = { keepLabels: true };
const DROP = { keepLabels: false };

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(join(import.meta.dirname, "../../../fixtures/photo", name)),
  );

const WIDTH = 64;
const HEIGHT = 48;
/** A gradient, so a changed pixel shows. */
function gradient(): Buffer {
  const out = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 3;
      out[i] = x * 4;
      out[i + 1] = y * 5;
      out[i + 2] = (x * y) & 0xff;
    }
  }
  return out;
}
const image = () =>
  sharp(gradient(), { raw: { width: WIDTH, height: HEIGHT, channels: 3 } });
const pixels = (b: Uint8Array) => sharp(b).raw().toBuffer();
const iccOf = async (b: Uint8Array) => (await sharp(b).metadata()).icc;
/** The profile a clean copy should carry: the original's, cleaned. */
const cleanedIccOf = async (b: Uint8Array) => {
  const icc = await iccOf(b);
  return icc && Buffer.from(cleanIcc(new Uint8Array(icc)) ?? []);
};

/** What the summary says about a file. */
async function said(b: Uint8Array, type: "jpeg" | "png" | "webp" | "heic") {
  const read = await readImage(b, type);
  return sentences(summarize(read?.meta, read?.groups)).join("\n");
}

/** Everything the crafted files carry, as the summary should say it. */
function expectEverythingSaid(words: string) {
  expect(words).toContain("exact place it was taken (51.4769");
  expect(words).toContain("LEAK-MAKE LEAK-MODEL");
  expect(words).toContain("LEAK-SERIAL");
  expect(words).toContain("LEAK-ARTIST");
  expect(words).toContain("LEAK-OWNER");
  expect(words).toContain("LEAK-XPAUTHOR");
  expect(words).toContain("LEAK-CREATOR");
  expect(words).toContain("LEAK-RIGHTS");
  expect(words).toContain("LEAK-XMPCITY");
  expect(words).toContain("leak@example.com");
  expect(words).toContain("LEAK-DESCRIPTION");
  expect(words).toContain("LEAK-USER");
}

const EXIF = exifTiff();
const APP1_EXIF = segment(0xe1, [...ascii("Exif\0\0"), ...EXIF]);
const APP1_XMP = segment(0xe1, [
  ...ascii("http://ns.adobe.com/xap/1.0/\0"),
  ...xmp(),
]);
const ALLOWED_JPEG = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcc, 0xcd,
  0xce, 0xcf, 0xda, 0xdb, 0xdc, 0xdd, 0xe0, 0xe2, 0xee,
]);

describe("JPEG", () => {
  /** A real JPEG with a P3 profile, metadata put in every place. */
  async function crafted(progressive: boolean) {
    const base = new Uint8Array(
      await image()
        .jpeg({ quality: 90, progressive })
        .withIccProfile("p3")
        .toBuffer(),
    );
    const { list } = segments(base);
    const scans = list.filter((s) => s.marker === 0xda);
    const first = scans[0]?.start ?? 0;
    const second = scans[1]?.start ?? base.length - 2;
    const before = [
      // JFIF with a thumbnail, and its extension with another.
      ...segment(0xe0, [
        ...ascii("JFIF\0"),
        1,
        2,
        0,
        0,
        1,
        0,
        1,
        2,
        2,
        ...ascii("LEAK-THUMB.."),
      ]),
      ...segment(0xe0, [...ascii("JFXX\0"), 0x13, ...ascii("LEAK-JFXX")]),
      ...APP1_EXIF,
      ...APP1_XMP,
      // Extended XMP: one part.
      ...segment(0xe1, [
        ...ascii("http://ns.adobe.com/xmp/extension/\0"),
        ...ascii("0123456789ABCDEF0123456789ABCDEF"),
        ...u32(40),
        ...u32(0),
        ...ascii("<x:xmpmeta>LEAK-EXTENDED-XMP</x:xmpmeta>"),
      ]),
      ...segment(0xe2, [...ascii("MPF\0"), ...ascii("LEAK-MPF")]),
      ...[3, 4, 5, 6, 7, 8, 9, 10, 15].flatMap((n) =>
        segment(0xe0 + n, ascii(`LEAK-APP${n}`)),
      ),
      ...segment(0xeb, [...ascii("JP"), 0, 0, ...ascii("jumbLEAK-C2PA")]),
      ...segment(0xec, [...ascii("Ducky"), ...ascii("LEAK-DUCKY")]),
      ...segment(0xed, photoshop()),
      ...segment(0xfe, ascii("LEAK-COMMENT")),
    ];
    // Between the scans (or before the end): Exif and a comment again.
    const late = [...APP1_EXIF, ...segment(0xfe, ascii("LEAK-LATE"))];
    const file = new Uint8Array([
      ...base.subarray(0, 2),
      ...before,
      // The base's own header segments (its JFIF dropped: one is enough).
      ...list
        .filter((s) => s.start < first && s.marker !== 0xe0)
        .flatMap((s) => [...base.subarray(s.start, s.end)]),
      ...base.subarray(first, second),
      ...late,
      ...base.subarray(second),
      // After the end: an extra picture with its own Exif.
      ...[0xff, 0xd8, ...APP1_EXIF, 0xff, 0xd9],
      ...ascii("LEAK-TRAILING"),
    ]);
    return { base, file };
  }

  test.each([false, true])(
    "every kind of metadata goes, the picture and its colour stay (progressive %s)",
    async (progressive) => {
      const { base, file } = await crafted(progressive);
      expect(await pixels(file)).toEqual(await pixels(base));
      const out = cleanImage(file, "jpeg", 1, DROP);
      expect(leaks(out)).toBe(false);
      expect(await pixels(out)).toEqual(await pixels(base));
      expect(await iccOf(out)).toEqual(await cleanedIccOf(base));
      // Only segments a picture needs, and one end marker, at the end.
      const { list, ended } = segments(out);
      expect(ended).toBe(true);
      for (const s of list) expect(ALLOWED_JPEG.has(s.marker)).toBe(true);
      expect(Array.from(out.subarray(-2))).toEqual([0xff, 0xd9]);
      expect(await readImage(out, "jpeg")).toBeUndefined();
    },
  );

  test("the summary reads every block, between the scans too", async () => {
    const { file } = await crafted(true);
    const words = await said(file, "jpeg");
    expectEverythingSaid(words);
    expect(words).toContain("LEAK-BYLINE");
    expect(words).toContain("LEAK-SUBLOCATION, LEAK-XMPCITY");
    expect(words).toContain("LEAK-COMMENT / LEAK-LATE");
  });

  test("metadata only after the first scan is still read, and still goes", async () => {
    const base = new Uint8Array(
      await image().jpeg({ progressive: true }).toBuffer(),
    );
    const scans = segments(base).list.filter((s) => s.marker === 0xda);
    const at = scans[1]?.start ?? 0;
    const file = new Uint8Array([
      ...base.subarray(0, at),
      ...APP1_EXIF,
      ...base.subarray(at),
    ]);
    expect(await said(file, "jpeg")).toContain("exact place");
    const out = cleanImage(file, "jpeg", 1, KEEP);
    expect(leaks(out)).toBe(false);
    expect(await pixels(out)).toEqual(await pixels(base));
  });

  test("a JPEG cut short keeps its picture and gets its end back", async () => {
    const whole = fixture("gps.jpg");
    for (const cut of [2, 200]) {
      const file = whole.subarray(0, whole.length - cut);
      expect(await said(file, "jpeg")).toContain("exact place");
      const out = cleanImage(file, "jpeg", 1, KEEP);
      expect(leaks(out)).toBe(false);
      expect(text(out)).not.toContain("Test Person");
      expect(Array.from(out.subarray(-2))).toEqual([0xff, 0xd9]);
      const meta = await sharp(out, { failOn: "none" }).metadata();
      expect([meta.width, meta.height]).toEqual([160, 120]);
    }
  });

  test("a file that ends before its picture starts is refused", () => {
    expect(() => cleanImage(fixture("damaged.jpg"), "jpeg", 1, KEEP)).toThrow();
  });
});

const ALLOWED_PNG = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "tRNS",
  "cHRM",
  "gAMA",
  "iCCP",
  "sBIT",
  "sRGB",
  "cICP",
  "mDCV",
  "cLLI",
  "bKGD",
  "pHYs",
  "acTL",
  "fcTL",
  "fdAT",
  "eXIf", // only a turn's
]);

describe("PNG", () => {
  async function crafted() {
    const base = new Uint8Array(
      await image().png().withIccProfile("p3").toBuffer(),
    );
    const { list } = pngChunks(base);
    const ihdr = list[0];
    if (!ihdr) throw new Error("no IHDR");
    const extra = [
      ...pngChunk("eXIf", EXIF),
      ...pngChunk("tEXt", ascii("Author\0LEAK-PNGAUTHOR")),
      ...pngChunk("tEXt", ascii("Comment\0LEAK-PNGCOMMENT")),
      ...pngChunk("zTXt", rawProfile("exif", [...ascii("Exif\0\0"), ...EXIF])),
      ...pngChunk("iTXt", compressedItxt("XML:com.adobe.xmp", xmp())),
      ...pngChunk("tIME", [0x07, 0xea, 10, 1, 12, 0, 0]),
      ...pngChunk("caBX", ascii("jumbLEAK-C2PA")),
      ...pngChunk("exIf", ascii("LEAK-EXIF-UNOFFICIAL")),
      ...pngChunk("zxIf", ascii("LEAK-ZXIF")),
      ...pngChunk("sPLT", ascii("LEAK-PALETTE\0")),
      ...pngChunk("leAk", ascii("LEAK-UNKNOWN")),
    ];
    const file = new Uint8Array([
      ...base.subarray(0, ihdr.end),
      ...extra,
      ...base.subarray(ihdr.end),
      ...ascii("LEAK-TRAILING"),
    ]);
    return { base, file };
  }

  test("every kind of metadata goes, the picture and its colour stay", async () => {
    const { base, file } = await crafted();
    const out = cleanImage(file, "png", 1, DROP);
    expect(leaks(out)).toBe(false);
    expect(await pixels(out)).toEqual(await pixels(base));
    expect(await iccOf(out)).toEqual(await cleanedIccOf(base));
    const { list, ended } = pngChunks(out);
    expect(ended).toBe(true);
    for (const c of list) expect(ALLOWED_PNG.has(c.type)).toBe(true);
    expect(list.some((c) => c.type === "eXIf")).toBe(false);
    expect(await readImage(out, "png")).toBeUndefined();
  });

  test("the summary reads compressed text too", async () => {
    const { file } = await crafted();
    const words = await said(file, "png");
    expectEverythingSaid(words);
    expect(words).toContain("LEAK-PNGAUTHOR");
    expect(words).toContain("LEAK-PNGCOMMENT");
  });

  test("GPS kept only in a compressed raw profile is found", async () => {
    const base = new Uint8Array(await image().png().toBuffer());
    const ihdr = pngChunks(base).list[0];
    const file = new Uint8Array([
      ...base.subarray(0, ihdr?.end),
      ...pngChunk("zTXt", rawProfile("exif", EXIF)),
      ...base.subarray(ihdr?.end),
    ]);
    expect(await said(file, "png")).toContain("exact place it was taken");
  });

  test("a PNG cut short keeps its whole chunks and gets its end back", async () => {
    const { base, file } = await crafted();
    // Without its end chunk (and what followed it).
    const out = cleanImage(file.subarray(0, file.length - 25), "png", 1, DROP);
    expect(leaks(out)).toBe(false);
    expect(pngChunks(out).ended).toBe(true);
    expect(text(out.subarray(-8, -4))).toBe("IEND");
    expect(await pixels(out)).toEqual(await pixels(base));
    // Cut inside its only data chunk: nothing whole to keep.
    const idat = pngChunks(file).list.find((c) => c.type === "IDAT");
    expect(() =>
      cleanImage(file.subarray(0, (idat?.end ?? 0) - 1), "png", 1, KEEP),
    ).toThrow();
  });
});

const ALLOWED_WEBP = new Set([
  "VP8 ",
  "VP8L",
  "VP8X",
  "ALPH",
  "ANIM",
  "ANMF",
  "ICCP",
]);

describe("WebP", () => {
  async function base() {
    return new Uint8Array(
      await image().webp({ quality: 90 }).withIccProfile("p3").toBuffer(),
    );
  }

  test("metadata after the size the file declares: read, then dropped", async () => {
    // The page's own case: a plain WebP, then an EXIF chunk past its end.
    for (const plain of [
      new Uint8Array(await image().webp().toBuffer()),
      await base(),
    ]) {
      const file = new Uint8Array([...plain, ...webpChunk("EXIF", EXIF)]);
      expect(await said(file, "webp")).toContain("exact place it was taken");
      const out = cleanImage(file, "webp", 1, KEEP);
      expect(leaks(out)).toBe(false);
      expect(out.length).toBe(plain.length);
      expect(await readImage(out, "webp")).toBeUndefined();
      expect(await pixels(out)).toEqual(await pixels(plain));
    }
  });

  test("every kind of metadata goes, the picture and its colour stay", async () => {
    const b = await base();
    const body = Array.from(b.subarray(12));
    const chunks = [
      ...body,
      ...webpChunk("EXIF", EXIF),
      ...webpChunk("XMP ", xmp()),
      ...webpChunk("C2PA", ascii("jumbLEAK-C2PA")),
      ...webpChunk("leak", ascii("LEAK-UNKNOWN")),
    ];
    const file = new Uint8Array([
      ...riff(chunks),
      ...webpChunk("EXIF", ascii("LEAK-PAST-THE-END")),
    ]);
    // Flag Exif and XMP in VP8X, as a writer would.
    file[20] = (file[20] ?? 0) | 0x0c;
    expectEverythingSaid(await said(file, "webp"));
    const out = cleanImage(file, "webp", 1, DROP);
    expect(leaks(out)).toBe(false);
    expect(await pixels(out)).toEqual(await pixels(b));
    expect(await iccOf(out)).toEqual(await cleanedIccOf(b));
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(view.getUint32(4, true)).toBe(out.length - 8);
    for (const c of webpChunks(out, 12, out.length)) {
      expect(ALLOWED_WEBP.has(c.type)).toBe(true);
    }
    expect((out[20] ?? 0) & 0x0c).toBe(0);
    expect(await readImage(out, "webp")).toBeUndefined();
  });

  test("an animation keeps only picture chunks inside each frame", async () => {
    const still = new Uint8Array(await image().webp().toBuffer());
    const vp8 = webpChunks(still, 12, still.length)[0];
    if (!vp8) throw new Error("no picture");
    const picture = Array.from(still.subarray(vp8.start, vp8.next));
    // A frame: position, size and timing (16 bytes), then its chunks.
    const frame = [
      0,
      0,
      0,
      0,
      0,
      0,
      ...[WIDTH - 1, 0, 0, HEIGHT - 1, 0, 0],
      100,
      0,
      0,
      0,
      ...picture,
      ...webpChunk("EXIF", ascii("LEAK-IN-A-FRAME")),
    ];
    const vp8x = [0x02, 0, 0, 0, WIDTH - 1, 0, 0, HEIGHT - 1, 0, 0];
    const file = new Uint8Array(
      riff([
        ...webpChunk("VP8X", vp8x),
        ...webpChunk("ANIM", [0, 0, 0, 0, 0, 0]),
        ...webpChunk("ANMF", frame),
        ...webpChunk("ANMF", frame),
      ]),
    );
    const out = cleanImage(file, "webp", 1, KEEP);
    expect(leaks(out)).toBe(false);
    const top = webpChunks(out, 12, out.length).map((c) => c.type);
    expect(top).toEqual(["VP8X", "ANIM", "ANMF", "ANMF"]);
    const meta = await sharp(out, { animated: true }).metadata();
    expect(meta.pages).toBe(2);
  });
});

describe("HEIC", () => {
  // A HEIC holding, besides its picture: Exif and XMP about it, another
  // kind of item (a styles item, an unknown one), a property with words
  // in it, a box inside meta and boxes beside it that no picture needs,
  // item names, bytes in mdat no item claims, and data after the end.
  const PICTURE = [0x77, 0x77, 0x77, 0x77, 0x77, 0x77];
  function crafted(): Uint8Array {
    const items: [number, string, number[], string?][] = [
      [1, "hvc1", PICTURE],
      [2, "Exif", exifPayload([[ARTIST, "LEAK-HEIC-ARTIST"]])],
      [3, "mime", xmp(), "application/rdf+xml"],
      [4, "mime", ascii("LEAK-OTHER-MIME"), "application/octet-stream"],
      [5, "uri ", ascii("LEAK-STYLES"), "tag:example.com,2026:styles"],
      [6, "leak", ascii("LEAK-UNKNOWN-ITEM")],
    ];
    const infe = ([id, type, , extra]: (typeof items)[number]) =>
      full(
        "infe",
        2,
        u16(id),
        u16(0),
        asciiBytes(type),
        asciiBytes(`LEAK-NAME-${id}\0`),
        extra ? asciiBytes(`${extra}\0`) : [],
      );
    const gap = ascii("LEAK-GAP");
    const iinf = full("iinf", 0, u16(items.length), ...items.map(infe));
    const ipco = box(
      "ipco",
      full("ispe", 0, u32(2), u32(2)),
      full("udes", 0, asciiBytes("en\0LEAK-UDES\0\0\0")),
    );
    const ipma = full("ipma", 0, u32(1), [...u16(1), 2, 0x81, 0x02]);
    const iprp = box("iprp", ipco, ipma);
    const pitm = full("pitm", 0, u16(1));
    const xml = full("xml ", 0, asciiBytes("<x>LEAK-XML-BOX</x>"));
    const iref = full("iref", 0, box("cdsc", u16(2), u16(1), u16(1)));
    const iloc = (mdat: number) => {
      let at = mdat + 8;
      const rows = items.map(([id, , payload]) => {
        const row = [
          ...u16(id),
          ...u16(0),
          ...u16(0),
          ...u16(1),
          ...u32(at),
          ...u32(payload.length),
        ];
        at += payload.length;
        if (id === 1) at += gap.length; // the gap sits after the picture
        return row;
      });
      return full("iloc", 1, [0x44, 0x00], u16(items.length), ...rows);
    };
    const metaOf = (mdat: number) =>
      full("meta", 0, pitm, iinf, iprp, iref, xml, iloc(mdat));
    const mdatStart = FTYP.length + metaOf(0).length;
    const mdat = box(
      "mdat",
      PICTURE,
      gap,
      ...items.slice(1).map(([, , payload]) => payload),
    );
    return new Uint8Array([
      ...FTYP,
      ...metaOf(mdatStart),
      ...mdat,
      ...box("uuid", asciiBytes("LEAK-UUID-BOX-16")),
      ...box("free", asciiBytes("LEAK-FREE")),
      ...asciiBytes("LEAK-TRAILING"),
    ]);
  }

  test("only the picture's bytes and what draws it are left", async () => {
    const file = crafted();
    expect(await said(file, "heic")).toContain("LEAK-HEIC-ARTIST");
    const out = stripHeic(file, 1);
    expect(leaks(out)).toBe(false);
    // Nothing moves: the same boxes and items, in the same places.
    expect(out.length).toBe(file.length - "LEAK-TRAILING".length);
    expect(heifMeta(out)).toEqual(heifMeta(file));
    const kept = heifLayout(out).items.find((x) => x.id === 1);
    if (!kept) throw new Error("no picture");
    expect(Array.from(itemBytes(out, kept))).toEqual(PICTURE);
    expect(text(out)).toContain("ispe");
    expect(await readImage(out, "heic")).toBeUndefined();
  });

  test("a turned HEIC keeps only its turn", async () => {
    const out = stripHeic(crafted(), 6);
    expect(leaks(out)).toBe(false);
    expect((await readImage(out, "heic"))?.meta).toEqual({ Orientation: 6 });
  });

  test("the iPhone layout: the pictures stay byte for byte, the rest goes", async () => {
    const file = fixture("iphone.heic");
    const out = stripHeic(file, 1);
    const before = heifLayout(file);
    const after = heifLayout(out);
    for (const item of before.pictures) {
      const same = after.items.find((x) => x.id === item.id);
      if (!same) throw new Error(`no item ${item.id}`);
      expect(itemBytes(out, same)).toEqual(itemBytes(file, item));
    }
    // The styles item (uri) is blanked; the gain map keeps its XMP.
    const styles = after.items.find((x) => x.type === "uri ");
    if (!styles) throw new Error("no styles item");
    expect(itemBytes(out, styles).every((b) => b === 0)).toBe(true);
    expect(text(out)).toContain("HDRGainMapVersion");
    expect(text(out)).not.toContain("Test Person");
  });

  test("the picture still opens, every pixel the same", async () => {
    const original = fixture("sample.heic");
    const out = stripHeic(original, 1);
    expect(text(out)).not.toContain("Cam 1");
    expect((await pixels(out)).equals(await pixels(original))).toBe(true);
  });

  test("a sequence is refused, not half-cleaned", () => {
    const whole = crafted().subarray(0, -"LEAK-TRAILING".length);
    const file = new Uint8Array([...whole, ...box("moov", [])]);
    expect(() => stripHeic(file, 1)).toThrow(CantClean);
  });

  test("one item listing the same bytes 65,535 times is refused at once", () => {
    // An Exif item whose extents all point at the same 8 bytes.
    const count = 0xffff;
    const extents = Array.from({ length: count }, () => [
      ...u32(0),
      ...u32(8),
    ]).flat();
    const iinf = full(
      "iinf",
      0,
      u16(1),
      full("infe", 2, u16(1), u16(0), asciiBytes("Exif"), [0]),
    );
    const iloc = full("iloc", 1, [0x44, 0x00], u16(1), [
      ...u16(1),
      ...u16(0),
      ...u16(0),
      ...u16(count),
      ...extents,
    ]);
    const file = new Uint8Array([
      ...FTYP,
      ...full("meta", 0, iinf, iloc),
      ...box("mdat", new Array<number>(8).fill(0)),
    ]);
    const start = performance.now();
    expect(() => heifMeta(file)).toThrow(/same bytes/);
    expect(() => stripHeic(file, 1)).toThrow();
    expect(performance.now() - start).toBeLessThan(200);
  });
});

test("the word every crafted value carries", () => {
  expect(LEAK).toBe("LEAK");
});
