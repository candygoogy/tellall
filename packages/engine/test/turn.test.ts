// A clean copy is shown the same way up as the photo. Its turn is taken
// only from where a browser takes it, never from XMP or a block the
// browser skips, and the clean copy carries exactly that turn.
import { describe, expect, test } from "vitest";
import { cleanImage } from "../src/image/strip/index.ts";
import { segments } from "../src/image/strip/jpeg.ts";
import { chunks as pngChunks } from "../src/image/strip/png.ts";
import { turnOf } from "../src/image/turn.ts";
import { ascii, pngChunk, riff, segment, webpChunk } from "./forge.ts";
import { jpeg, png, sharpTurn, webp } from "./gradient.ts";

/** A TIFF holding only Orientation: a SHORT, unless told otherwise. */
function tiff(turn: number, type = 3, count = 1, littleEndian = false) {
  if (littleEndian) {
    // prettier-ignore
    return [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, type, 0,
      count, 0, 0, 0, turn, 0, 0, 0, 0, 0, 0, 0];
  }
  const value = type === 4 ? [0, 0, 0, turn] : [0, turn, 0, 0];
  // prettier-ignore
  return [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, type,
    0, 0, 0, count, ...value, 0, 0, 0, 0];
}
const exif = (t: number[]) => segment(0xe1, [...ascii("Exif\0\0"), ...t]);
const XMP_TURN = ascii(
  `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:tiff="http://ns.adobe.com/tiff/1.0/" tiff:Orientation="6"/></rdf:RDF></x:xmpmeta>`,
);

describe("JPEG", () => {
  /** The picture with segments put after SOI, and before its end. */
  async function made(head: number[], tail: number[] = []) {
    const base = await jpeg();
    return new Uint8Array([
      ...base.subarray(0, 2),
      ...head,
      ...base.subarray(2, -2),
      ...tail,
      0xff,
      0xd9,
    ]);
  }

  test.each([
    ["an Exif turn before the picture", [exif(tiff(6))], 6],
    ["little-endian Exif", [exif(tiff(6, 3, 1, true))], 6],
    ["a turn only in XMP", [[], []], 1],
    ["Exif only after the picture", [[], exif(tiff(6))], 1],
    [
      "two Exif blocks: the first counts",
      [[...exif(tiff(1)), ...exif(tiff(6))]],
      1,
    ],
    [
      "a first Exif block that holds no TIFF",
      [[...exif(ascii("nothing!")), ...exif(tiff(6))]],
      1,
    ],
    ["a turn stored as a LONG", [exif(tiff(6, 4))], 1],
    ["a turn with two values", [exif(tiff(6, 3, 2))], 1],
    ["a turn out of range", [exif(tiff(9))], 1],
  ] as const)("%s", async (name, [head, tail = []], turn) => {
    const xmp =
      name === "a turn only in XMP"
        ? segment(0xe1, [
            ...ascii("http://ns.adobe.com/xap/1.0/\0"),
            ...XMP_TURN,
          ])
        : [];
    const file = await made([...xmp, ...head], [...tail]);
    expect(turnOf(file, "jpeg")).toBe(turn);
    const out = cleanImage(file, "jpeg", turnOf(file, "jpeg"), {
      keepLabels: true,
    });
    // Only a turn's own Exif is ever written, before the picture.
    const app1 = segments(out).list.filter((s) => s.marker === 0xe1);
    expect(app1).toHaveLength(turn === 1 ? 0 : 1);
    // sharp reads turns the way a browser does, LONG and two values aside.
    if (!name.includes("LONG") && !name.includes("two values")) {
      expect(await sharpTurn(out)).toBe(await sharpTurn(file));
    }
  });

  test("a damaged file is upright, not an error", () => {
    expect(turnOf(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff]), "jpeg")).toBe(
      1,
    );
  });
});

describe("PNG", () => {
  /** The picture with chunks put after IHDR, or before IEND. */
  async function made(head: number[], tail: number[] = []) {
    const base = await png();
    const ihdr = pngChunks(base).list[0]?.end ?? 0;
    return new Uint8Array([
      ...base.subarray(0, ihdr),
      ...head,
      ...base.subarray(ihdr, -12),
      ...tail,
      ...base.subarray(-12),
    ]);
  }

  test.each([
    ["an eXIf turn before the picture", pngChunk("eXIf", tiff(6)), [], 6],
    [
      "a turn only in XMP",
      pngChunk("iTXt", [
        ...ascii("XML:com.adobe.xmp\0"),
        0,
        0,
        0,
        0,
        ...XMP_TURN,
      ]),
      [],
      1,
    ],
    ["eXIf only after the picture", [], pngChunk("eXIf", tiff(6)), 1],
    [
      "eXIf with JPEG's Exif prefix",
      pngChunk("eXIf", [...ascii("Exif\0\0"), ...tiff(6)]),
      [],
      1,
    ],
    [
      "two eXIf chunks: the first counts",
      [...pngChunk("eXIf", tiff(1)), ...pngChunk("eXIf", tiff(6))],
      [],
      1,
    ],
  ] as const)("%s", async (_name, head, tail, turn) => {
    const file = await made([...head], [...tail]);
    expect(turnOf(file, "png")).toBe(turn);
    const out = cleanImage(file, "png", turnOf(file, "png"), {
      keepLabels: true,
    });
    const exifs = pngChunks(out).list.filter((c) => c.type === "eXIf");
    expect(exifs).toHaveLength(turn === 1 ? 0 : 1);
    expect(await sharpTurn(out)).toBe(await sharpTurn(file));
  });
});

describe("WebP", () => {
  // Browsers don't turn a WebP at all; other readers turn it by its EXIF
  // chunk, when the extended header says there is one. The clean copy
  // keeps that turn, so it's shown the same way everywhere.
  async function made(flags: number, after: number[], past: number[] = []) {
    const base = await webp();
    const vp8x = webpChunk("VP8X", [flags, 0, 0, 0, 63, 0, 0, 47, 0, 0]);
    return new Uint8Array([
      ...riff([...vp8x, ...base.subarray(12), ...after]),
      ...past,
    ]);
  }

  test.each([
    ["flagged EXIF", 0x08, webpChunk("EXIF", tiff(6)), [], 6],
    ["EXIF the header doesn't flag", 0x00, webpChunk("EXIF", tiff(6)), [], 1],
    ["EXIF past the file's end", 0x08, [], webpChunk("EXIF", tiff(6)), 1],
    [
      "two EXIF chunks: the first counts",
      0x08,
      [...webpChunk("EXIF", tiff(1)), ...webpChunk("EXIF", tiff(6))],
      [],
      1,
    ],
  ] as const)("%s", async (_name, flags, after, past, turn) => {
    const file = await made(flags, [...after], [...past]);
    expect(turnOf(file, "webp")).toBe(turn);
    const out = cleanImage(file, "webp", turnOf(file, "webp"), {
      keepLabels: true,
    });
    expect(await sharpTurn(out)).toBe(await sharpTurn(file));
  });
});
