// An Ultra HDR JPEG keeps its HDR gain map in a clean copy (spec §6): the
// gain map (a second JPEG after the picture, listed in MPF) is cleaned on
// its own and kept, with an MPF written anew that points at it.
import sharp, { type Sharp } from "sharp";
import { expect, test } from "vitest";
import { clean, inspect } from "../src/index.ts";
import { mpfOf } from "../src/image/mpf.ts";
import { gainMapCount, segments } from "../src/image/strip/jpeg.ts";
import { ascii, segment } from "./forge.ts";

const W = 64;
const H = 48;

async function ultraHdr(): Promise<Uint8Array> {
  const raw = Buffer.alloc(W * H * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7) & 0xff;
  // withGainMap() is in sharp's runtime but not yet in its types.
  const img = sharp(raw, {
    raw: { width: W, height: H, channels: 3 },
  }) as Sharp & {
    withGainMap(): Sharp;
  };
  const b = await img
    .withGainMap()
    .withExif({ IFD0: { Make: "LEAK-MAKE", Model: "LEAK-MODEL" } })
    .jpeg()
    .toBuffer();
  return new Uint8Array(b);
}

const file = (bytes: Uint8Array) =>
  ({ kind: "file", name: "hdr.jpg", bytes }) as const;

test("the gain map is kept, cleaned, and MPF points at it", async () => {
  const original = await ultraHdr();
  expect((await sharp(original).metadata()).gainMap).toBeTruthy();
  expect(gainMapCount(original)).toBe(1);

  const copy = await clean(file(original));
  const out = copy.output as Uint8Array;
  expect(copy.cleaned).toBe(true);
  expect(copy.notes).toEqual([]);
  expect(Buffer.from(out).includes("LEAK")).toBe(false);
  // The gain map's own comment (the encoder's name) goes too.
  expect(Buffer.from(out).includes("libuhdr")).toBe(false);
  expect(gainMapCount(out)).toBe(1);
  const mpf = mpfOf(out, segments(out).list);
  const [map] = mpf?.extra ?? [];
  expect(map && map.offset + map.length).toBe(out.length);
  const meta = await sharp(out).metadata();
  expect(meta.gainMap).toBeTruthy();
  expect(meta.exif).toBeUndefined();
  // The picture itself is untouched.
  const pixels = async (b: Uint8Array) => sharp(b).raw().toBuffer();
  expect((await pixels(out)).equals(await pixels(original))).toBe(true);
  // A second clean finds nothing more to remove.
  const again = await clean(file(out));
  expect(Buffer.from(again.output as Uint8Array).equals(Buffer.from(out))).toBe(
    true,
  );
  expect((await inspect(file(out))).empty).toBe(true);
});

test("a gain map that can't be kept is never dropped silently", async () => {
  const original = await ultraHdr();
  // The MPF index broken: the gain map after the end can't be found.
  const at = Buffer.from(original).indexOf("MPF\0");
  const broken = original.slice();
  broken.set(ascii("XXX\0"), at);
  const copy = await clean(file(broken));
  expect(copy.cleaned).toBe(true);
  expect(copy.notes.join(" ")).toMatch(/gain map/);
  // Not an Ultra HDR JPEG at all: no note.
  const plain = await clean(
    file(
      new Uint8Array([
        ...original.subarray(0, 2),
        ...segment(0xfe, ascii("LEAK")),
        ...original.subarray(
          2,
          Buffer.from(original).indexOf(Buffer.from([0xff, 0xd9])) + 2,
        ),
      ]),
    ),
  );
  expect(plain.notes.join(" ")).not.toMatch(/gain map/);
});
