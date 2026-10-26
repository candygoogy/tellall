// A colour profile stays in the clean copy, since the picture's colours
// depend on it, but only the parts colours are drawn with stay as they
// were. Its words (its name, copyright, the display's maker and model),
// its dates, its creator and any tag colours aren't drawn with are
// blanked, and so is every byte between and after its tags. The colours
// come out exactly the same.
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { heifLayout } from "../src/image/heif.ts";
import { cleanIcc } from "../src/image/icc.ts";
import { cleanImage, stripHeic } from "../src/image/strip/index.ts";
import { segments } from "../src/image/strip/jpeg.ts";
import { chunks as pngChunks } from "../src/image/strip/png.ts";
import { chunks as webpChunks } from "../src/image/strip/webp.ts";
import { box, bytes, FTYP, full, u16, u32 } from "./craft.ts";
import { ascii, pngChunk, riff, segment, webpChunk } from "./forge.ts";
import { image, jpeg, pixels, png } from "./gradient.ts";
import { crafted, LEAKS } from "./profile.ts";
import { deflateSync } from "node:zlib";

describe("the profile itself", () => {
  test("its words, dates and private tags are blanked, its colours kept", async () => {
    const profile = await crafted();
    expect(LEAKS(profile)).toBe(true);
    const out = cleanIcc(profile);
    if (!out) throw new Error("refused");
    expect(LEAKS(out)).toBe(false);
    expect(out.length).toBe(profile.length);
    // Its header still says what it is, and its colours are where they were.
    expect(Buffer.from(out.subarray(36, 40)).toString("latin1")).toBe("acsp");
    expect(out.subarray(12, 24)).toEqual(profile.subarray(12, 24));
  });

  test("anything that isn't a profile is refused", async () => {
    const profile = await crafted();
    const broken = profile.slice();
    broken.set(ascii("LEAK"), 36); // no "acsp"
    expect(cleanIcc(broken)).toBeNull();
    expect(cleanIcc(new Uint8Array(ascii("LEAK-NOT-A-PROFILE")))).toBeNull();
    // A tag past the profile's end.
    const past = profile.slice();
    new DataView(past.buffer).setUint32(136, profile.length);
    expect(cleanIcc(past)).toBeNull();
  });

  test("a clean profile comes back the same when cleaned again", async () => {
    const once = cleanIcc(await crafted());
    expect(once && cleanIcc(once)).toEqual(once);
  });
});

/** A JPEG carrying this profile, in segments of at most 65,519 bytes. */
async function jpegWith(profile: Uint8Array): Promise<Uint8Array> {
  const base = await jpeg();
  const parts: number[][] = [];
  const size = 65_519;
  const count = Math.ceil(profile.length / size);
  for (let n = 0; n < count; n++) {
    const piece = profile.subarray(n * size, (n + 1) * size);
    parts.push(
      segment(0xe2, [...ascii("ICC_PROFILE\0"), n + 1, count, ...piece]),
    );
  }
  return new Uint8Array([
    ...base.subarray(0, 2),
    ...parts.flat(),
    ...base.subarray(2),
  ]);
}

describe("in each kind of file", () => {
  test.each([false, true])(
    "JPEG (a profile in more than one segment: %s)",
    async (big) => {
      const profile = await crafted(big);
      const file = await jpegWith(profile);
      // The profile is used: without it the colours differ.
      expect(await pixels(file)).not.toEqual(await pixels(await jpeg()));
      const out = cleanImage(file, "jpeg", 1, { keepLabels: true });
      expect(LEAKS(out)).toBe(false);
      expect(await pixels(out)).toEqual(await pixels(file));
      const meta = await sharp(out).metadata();
      expect(new Uint8Array(meta.icc ?? [])).toEqual(cleanIcc(profile));
      const icc = segments(out).list.filter((s) => s.marker === 0xe2);
      expect(icc).toHaveLength(big ? 2 : 1);
    },
  );

  test("JPEG: something that only says it's a profile goes", async () => {
    const base = await jpeg();
    const file = new Uint8Array([
      ...base.subarray(0, 2),
      ...segment(0xe2, [
        ...ascii("ICC_PROFILE\0"),
        1,
        1,
        ...ascii("LEAK-FAKE"),
      ]),
      ...base.subarray(2),
    ]);
    const out = cleanImage(file, "jpeg", 1, { keepLabels: true });
    expect(LEAKS(out)).toBe(false);
    expect(segments(out).list.some((s) => s.marker === 0xe2)).toBe(false);
    expect(await pixels(out)).toEqual(await pixels(file));
  });

  test("JPEG: a profile's pieces out of order go, as a browser ignores them", async () => {
    const profile = await crafted();
    const base = await jpeg();
    const half = profile.length >> 1;
    const file = new Uint8Array([
      ...base.subarray(0, 2),
      ...segment(0xe2, [
        ...ascii("ICC_PROFILE\0"),
        1,
        2,
        ...profile.subarray(0, half),
      ]),
      ...segment(0xe2, [
        ...ascii("ICC_PROFILE\0"),
        1,
        2,
        ...profile.subarray(half),
      ]),
      ...base.subarray(2),
    ]);
    const out = cleanImage(file, "jpeg", 1, { keepLabels: true });
    expect(LEAKS(out)).toBe(false);
    expect(segments(out).list.some((s) => s.marker === 0xe2)).toBe(false);
  });

  test("PNG: the profile cleaned, its name just icc", async () => {
    const profile = await crafted();
    const base = await png();
    const ihdr = pngChunks(base).list[0]?.end ?? 0;
    const file = new Uint8Array([
      ...base.subarray(0, ihdr),
      ...pngChunk("iCCP", [
        ...ascii("LEAK-NAME Jane's display\0"),
        0,
        ...deflateSync(profile),
      ]),
      ...base.subarray(ihdr),
    ]);
    expect(await pixels(file)).not.toEqual(await pixels(base));
    const out = cleanImage(file, "png", 1, { keepLabels: true });
    expect(LEAKS(out)).toBe(false);
    expect(await pixels(out)).toEqual(await pixels(file));
    const iccp = pngChunks(out).list.find((c) => c.type === "iCCP");
    if (!iccp) throw new Error("no iCCP");
    expect(
      Buffer.from(out.subarray(iccp.data, iccp.data + 5)).toString("latin1"),
    ).toBe("icc\0\0");
    const meta = await sharp(out).metadata();
    expect(new Uint8Array(meta.icc ?? [])).toEqual(cleanIcc(profile));
  });

  test("PNG: a profile that can't be read goes", async () => {
    const base = await png();
    const ihdr = pngChunks(base).list[0]?.end ?? 0;
    const file = new Uint8Array([
      ...base.subarray(0, ihdr),
      ...pngChunk("iCCP", [
        ...ascii("icc\0"),
        0,
        ...deflateSync(Buffer.from("LEAK")),
      ]),
      ...base.subarray(ihdr),
    ]);
    const out = cleanImage(file, "png", 1, { keepLabels: true });
    expect(LEAKS(out)).toBe(false);
    expect(pngChunks(out).list.some((c) => c.type === "iCCP")).toBe(false);
  });

  test("WebP: the profile cleaned", async () => {
    const profile = await crafted();
    const plain = new Uint8Array(
      await image().webp({ quality: 90 }).toBuffer(),
    );
    const vp8x = webpChunk("VP8X", [0x20, 0, 0, 0, 63, 0, 0, 47, 0, 0]);
    const file = new Uint8Array(
      riff([...vp8x, ...webpChunk("ICCP", profile), ...plain.subarray(12)]),
    );
    expect(await pixels(file)).not.toEqual(await pixels(plain));
    const out = cleanImage(file, "webp", 1, { keepLabels: true });
    expect(LEAKS(out)).toBe(false);
    expect(await pixels(out)).toEqual(await pixels(file));
    const iccp = webpChunks(out, 12, out.length).find((c) => c.type === "ICCP");
    expect(iccp && out.subarray(iccp.body, iccp.body + iccp.size)).toEqual(
      cleanIcc(profile),
    );
  });

  test("WebP: a profile the header doesn't flag goes, as browsers ignore it", async () => {
    const profile = await crafted();
    const plain = new Uint8Array(
      await image().webp({ quality: 90 }).toBuffer(),
    );
    const vp8x = webpChunk("VP8X", [0x00, 0, 0, 0, 63, 0, 0, 47, 0, 0]);
    const file = new Uint8Array(
      riff([...vp8x, ...webpChunk("ICCP", profile), ...plain.subarray(12)]),
    );
    const out = cleanImage(file, "webp", 1, { keepLabels: true });
    expect(LEAKS(out)).toBe(false);
    expect(webpChunks(out, 12, out.length).some((c) => c.type === "ICCP")).toBe(
      false,
    );
    expect(await pixels(out)).toEqual(await pixels(file));
  });

  test("HEIC: the profile cleaned in its place, nothing moves", async () => {
    const profile = await crafted();
    const picture = [0x77, 0x77, 0x77, 0x77];
    const colr = box("colr", bytes("prof"), [...profile]);
    const ipco = box("ipco", colr, full("ispe", 0, u32(2), u32(2)));
    const ipma = full("ipma", 0, u32(1), [...u16(1), 2, 0x81, 0x02]);
    const iinf = full(
      "iinf",
      0,
      u16(1),
      full("infe", 2, u16(1), u16(0), bytes("hvc1"), [0]),
    );
    const meta = (mdat: number) =>
      full(
        "meta",
        0,
        full("pitm", 0, u16(1)),
        iinf,
        box("iprp", ipco, ipma),
        full("iloc", 1, [0x44, 0], u16(1), [
          ...u16(1),
          ...u16(0),
          ...u16(0),
          ...u16(1),
          ...u32(mdat + 8),
          ...u32(4),
        ]),
      );
    const at = FTYP.length + meta(0).length;
    const file = new Uint8Array([
      ...FTYP,
      ...meta(at),
      ...box("mdat", picture),
    ]);
    const out = stripHeic(file, 1);
    expect(LEAKS(out)).toBe(false);
    expect(out.length).toBe(file.length);
    const start = Buffer.from(file).indexOf("colr") + 8;
    expect(out.subarray(start, start + profile.length)).toEqual(
      cleanIcc(profile),
    );
    expect(heifLayout(out).pictures.map((x) => x.id)).toEqual([1]);
  });
});
