import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { heifLayout, heifMeta } from "../src/image/heif.ts";
import { readMeta } from "../src/image/read.ts";
import { stripHeic } from "../src/image/strip/index.ts";
import { sentences, summarize } from "./photo-summary.ts";

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(join(import.meta.dirname, "../../../fixtures/photo", name)),
  );
const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");

// Laid out as an iPhone writes it (see make-fixtures.mjs).
const IPHONE = fixture("iphone.heic");
const PERSONAL = ["Test Person", "Cam 1", "Example Editor", "2026:10:01"];
const GAIN_MAP_XMP = "HDRGainMapVersion";

/** Byte ranges an item covers. */
const ranges = (b: Uint8Array) => {
  const { exif, xmp } = heifMeta(b);
  return [...exif, ...xmp].flatMap((item) => item.extents);
};

describe("reading a HEIC", () => {
  test("an iPhone's layout: its Exif and its XMP", async () => {
    const meta = await readMeta(IPHONE, "heic");
    expect(meta?.["Make"]).toBe("Example");
    expect(meta?.["Model"]).toBe("Cam 1");
    expect(meta?.["DateTimeOriginal"]).toBe("2026:10:01 12:00:00");
    expect(meta?.["GPSLatitude"]).toBeDefined();
    const said = sentences(summarize(meta));
    expect(said[0]).toMatch(/^This photo carries the exact place/);
    expect(said).toContain("It names a person: Test Person.");
  });

  test("XMP about the gain map isn't the photo's", async () => {
    const { xmp } = heifMeta(IPHONE);
    expect(xmp.map((item) => item.id)).toEqual([12]);
    const meta = await readMeta(IPHONE, "heic");
    expect(JSON.stringify(meta)).not.toContain(GAIN_MAP_XMP);
  });

  test("a HEIC written by another tool (libheif)", async () => {
    const meta = await readMeta(fixture("sample.heic"), "heic");
    expect(meta?.["Make"]).toBe("Example");
  });
});

describe("a clean HEIC", () => {
  test("loses everything personal, and nothing moves", async () => {
    const out = stripHeic(IPHONE, 1);
    expect(out.length).toBe(IPHONE.length);
    for (const value of PERSONAL) expect(text(out)).not.toContain(value);
    const meta = await readMeta(out, "heic");
    for (const key of ["Make", "Model", "DateTimeOriginal", "GPSLatitude"]) {
      expect(meta?.[key]).toBeUndefined();
    }
    expect(sentences(summarize(meta))).toEqual([
      "Nothing personal found. This photo carries no location, device or name.",
    ]);
  });

  test("the picture's bytes never change", () => {
    const out = stripHeic(IPHONE, 1);
    const { pictures, helperXmp } = heifLayout(IPHONE);
    const kept = pictures.flatMap((item) => item.extents);
    // The gain map's XMP is written anew in its place, from its values.
    const rewritten = helperXmp.flatMap((item) => item.extents);
    let changed = 0;
    for (let i = 0; i < IPHONE.length; i++) {
      if (out[i] === IPHONE[i]) continue;
      changed++;
      const within = (x: { offset: number; length: number }) =>
        i >= x.offset && i < x.offset + x.length;
      expect(kept.some(within)).toBe(false);
      if (rewritten.some(within)) continue;
    }
    // The Exif, the XMP and the styles item, at least.
    expect(changed).toBeGreaterThan(ranges(IPHONE).length);
    // Same boxes, same items, in the same places.
    expect(heifMeta(out)).toEqual(heifMeta(IPHONE));
    // The gain map keeps its XMP, its values only.
    expect(text(out)).toContain(
      "<HDRGainMap:HDRGainMapVersion>131072</HDRGainMap:HDRGainMapVersion><HDRGainMap:HDRGainMapHeadroom>2.852</HDRGainMap:HDRGainMapHeadroom>",
    );
    expect(text(out)).not.toContain("XMP Core");
  });

  test("a turned photo keeps its turn", async () => {
    const meta = await readMeta(stripHeic(IPHONE, 6), "heic");
    expect(meta).toEqual({ Orientation: 6 });
  });

  test("the picture still opens, every pixel the same", async () => {
    const original = fixture("sample.heic");
    const out = stripHeic(original, 1);
    expect(text(out)).not.toContain("Cam 1");
    const pixels = (b: Uint8Array) => sharp(b).raw().toBuffer();
    expect((await pixels(out)).equals(await pixels(original))).toBe(true);
  });

  test("a HEIC cut short is refused, not half-cleaned", () => {
    expect(() => stripHeic(IPHONE.subarray(0, 2400), 1)).toThrow();
  });
});
