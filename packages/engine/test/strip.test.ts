import exifr from "exifr";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { cleanIcc } from "../src/image/icc.ts";
import { readMeta } from "../src/image/read.ts";
import {
  cleanImage,
  stripJpeg,
  stripPng,
  stripWebp,
} from "../src/image/strip/index.ts";

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(join(import.meta.dirname, "../../../fixtures/photo", name)),
  );
const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");
const pixels = (b: Uint8Array) => sharp(b).raw().toBuffer();

// Every identifying value the fixtures carry.
const PERSONAL = ["Test Person", "Example", "Cam 1", "2026:10:01", "51,28"];

/** JPEG segments before the scan: [marker, payload]. */
function jpegSegments(b: Uint8Array): [number, Uint8Array][] {
  const out: [number, Uint8Array][] = [];
  let i = 2;
  while (i < b.length && b[i] === 0xff && b[i + 1] !== 0xda) {
    const length = ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
    out.push([b[i + 1] ?? 0, b.subarray(i + 4, i + 2 + length)]);
    i += 2 + length;
  }
  return out;
}

/** PNG chunk types in order. */
const pngChunks = (b: Uint8Array) => {
  const types: string[] = [];
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 8; i < b.length;) {
    types.push(text(b.subarray(i + 4, i + 8)));
    i += 12 + view.getUint32(i);
  }
  return types;
};

/** WebP chunk fourccs in order. */
const webpChunks = (b: Uint8Array) => {
  const types: string[] = [];
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 12; i + 8 <= b.length;) {
    const size = view.getUint32(i + 4, true);
    types.push(text(b.subarray(i, i + 4)));
    i += 8 + size + (size % 2);
  }
  return types;
};

describe("clean copies", () => {
  test.each([
    ["gps.jpg", "jpeg"],
    ["meta.png", "png"],
    ["meta.webp", "webp"],
  ] as const)(
    "%s loses everything personal and keeps every pixel",
    async (name, type) => {
      const original = fixture(name);
      const out = cleanImage(original, type, 1, { keepLabels: true });
      for (const value of PERSONAL) expect(text(out)).not.toContain(value);
      expect(await pixels(out)).toEqual(await pixels(original));
      if (type !== "webp") {
        const meta = await exifr.parse(out, {
          tiff: true,
          xmp: true,
          iptc: true,
          mergeOutput: true,
        });
        expect(meta?.latitude).toBeUndefined();
        expect(meta?.Make).toBeUndefined();
        expect(meta?.Artist).toBeUndefined();
      }
    },
  );

  test("JPEG: the colour profile stays, cleaned, its colours the same", async () => {
    const original = fixture("gps.jpg");
    const icc = (b: Uint8Array) =>
      jpegSegments(b)
        .filter(
          ([m, p]) => m === 0xe2 && text(p.subarray(0, 12)) === "ICC_PROFILE\0",
        )
        .map(([, p]) => p.subarray(14));
    const [before] = icc(original);
    if (!before) throw new Error("no profile");
    const out = stripJpeg(original, 1);
    expect(icc(out)).toEqual([cleanIcc(before)]);
    expect(await pixels(out)).toEqual(await pixels(original));
  });

  test("JPEG: only the image and its colour remain before the scan", () => {
    const markers = jpegSegments(stripJpeg(fixture("gps.jpg"), 1)).map(
      ([m]) => m,
    );
    expect(markers).not.toContain(0xe1); // Exif, XMP
    expect(markers).not.toContain(0xed); // IPTC
    expect(markers).not.toContain(0xfe); // comment
  });

  test("a turned phone photo stays the right way up", async () => {
    const out = stripJpeg(fixture("rotated.jpg"), 6);
    expect(await exifr.orientation(out)).toBe(6);
    expect(text(out)).not.toContain("Example");
    expect((await sharp(out).metadata()).width).toBe(160);
  });

  test("a turned PNG stays the right way up", async () => {
    const turned = new Uint8Array(
      await sharp(fixture("clean.jpg"))
        .png()
        .withMetadata({ orientation: 6 })
        .withExif({ IFD0: { Make: "Example" } })
        .toBuffer(),
    );
    expect(await exifr.orientation(turned)).toBe(6);
    const out = stripPng(turned, 6);
    expect(text(out)).not.toContain("Example");
    expect(pngChunks(out)).toContain("eXIf");
    expect(await exifr.orientation(out)).toBe(6);
    expect(await pixels(out)).toEqual(await pixels(turned));
  });

  test("a turned WebP stays the right way up", async () => {
    const turned = new Uint8Array(
      await sharp(fixture("clean.jpg"))
        .webp()
        .withMetadata({ orientation: 6 })
        .withExif({ IFD0: { Make: "Example" } })
        .toBuffer(),
    );
    const out = stripWebp(turned, 6);
    expect(text(out)).not.toContain("Example");
    expect(webpChunks(out)).toContain("EXIF");
    expect((out[20] ?? 0) & 0x08).toBe(0x08); // the VP8X Exif flag
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(view.getUint32(4, true)).toBe(out.length - 8);
    expect((await readMeta(out, "webp"))?.["Orientation"]).toBe(6);
    expect(await pixels(out)).toEqual(await pixels(turned));
  });

  test("an already clean JPEG comes back byte for byte", () => {
    const original = fixture("clean.jpg");
    expect(
      Buffer.from(stripJpeg(original, 1)).equals(Buffer.from(original)),
    ).toBe(true);
  });

  test("data after the image's end (extra pictures) is dropped", () => {
    const original = fixture("clean.jpg");
    const tail = new TextEncoder().encode("Exif hidden picture by Test Person");
    const joined = new Uint8Array(original.length + tail.length);
    joined.set(original);
    joined.set(tail, original.length);
    const out = stripJpeg(joined, 1);
    expect(Buffer.from(out).equals(Buffer.from(original))).toBe(true);
  });

  test("PNG: the text, Exif and time chunks go, the rest stays in order", () => {
    const before = pngChunks(fixture("meta.png"));
    const after = pngChunks(stripPng(fixture("meta.png")));
    expect(before).toEqual(
      expect.arrayContaining(["eXIf", "tEXt", "iTXt", "tIME"]),
    );
    expect(after).toEqual(
      before.filter(
        (t) => !["eXIf", "tEXt", "zTXt", "iTXt", "tIME"].includes(t),
      ),
    );
  });

  test("WebP: the EXIF and XMP chunks go, their flags clear, the size adds up", () => {
    const out = stripWebp(fixture("meta.webp"));
    expect(webpChunks(fixture("meta.webp"))).toEqual(
      expect.arrayContaining(["EXIF", "XMP "]),
    );
    expect(webpChunks(out)).not.toContain("EXIF");
    expect(webpChunks(out)).not.toContain("XMP ");
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(view.getUint32(4, true)).toBe(out.length - 8);
    expect(text(out.subarray(12, 16))).toBe("VP8X");
    expect((out[20] ?? 0) & 0x0c).toBe(0);
  });

  test("a damaged JPEG is refused, not half-cleaned", () => {
    expect(() => stripJpeg(fixture("damaged.jpg"), 1)).toThrow();
  });

  test(
    "a 40 MB photo cleans in under 2 seconds",
    { timeout: 60_000 },
    async () => {
      const width = 4600;
      const height = 3400;
      const noise = Buffer.alloc(width * height * 3);
      for (let i = 0; i < noise.length; i++)
        noise[i] = Math.imul(i, 2654435761) >>> 24;
      const big = new Uint8Array(
        await sharp(noise, { raw: { width, height, channels: 3 } })
          .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
          .withExif({ IFD0: { Make: "Example", Model: "Cam 1" } })
          .toBuffer(),
      );
      expect(big.length).toBeGreaterThan(40 * 1024 * 1024);
      const start = performance.now();
      const out = stripJpeg(big, 1);
      expect(performance.now() - start).toBeLessThan(2000);
      expect(text(out.subarray(0, 2000))).not.toContain("Example");
    },
  );
});
