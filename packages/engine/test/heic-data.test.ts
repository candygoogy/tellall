// A HEIC's items are data, in mdat or idat. Details (Exif, XMP) said to be
// anywhere else would be read from, and blanked over, the file's own boxes;
// a picture said to be anywhere else would be blanked with the box it's
// in. Neither is read or cleaned: the report says so, and clean() makes no
// copy rather than a broken one.
import { expect, test } from "vitest";
import { clean, inspect, words as en } from "../src/index.ts";
import { CantClean, heifLayout } from "../src/image/heif.ts";
import { stripHeic } from "../src/image/strip/index.ts";
import { bytes, heic, u32, xmpPacket } from "./craft.ts";

const file = (b: Uint8Array) =>
  ({ kind: "file", name: "x.heic", bytes: b }) as const;

/** The file with one item's location moved to `to`. */
function moved(b: Uint8Array, id: number, to: number): Uint8Array {
  const item = heifLayout(b).items.find((x) => x.id === id);
  const from = item?.extents[0]?.offset;
  if (from === undefined) throw new Error("no such item");
  const at = Buffer.from(b).indexOf(Buffer.from(u32(from)));
  const out = b.slice();
  out.set(u32(to), at);
  return out;
}

const PICTURE = {
  id: 1,
  type: "hvc1" as const,
  payload: [0x77, 0x77, 0x77, 0x77],
};

test("details pointed at the item list aren't read or cleaned", async () => {
  const b = heic([
    PICTURE,
    { id: 2, type: "xmp", payload: xmpPacket("LEAK-CREATOR") },
  ]);
  const iinf = Buffer.from(b).indexOf("iinf") + 4;
  const odd = moved(b, 2, iinf);
  expect(() => heifLayout(odd)).toThrow(CantClean);
  const report = await inspect(file(odd));
  expect(report.findings.map((f) => f.sentence)).toContain(
    en.detailsStoredOddly,
  );
  const copy = await clean(file(odd));
  expect(copy.cleaned).toBe(false);
  expect(copy.notes).toEqual([en.clean.heicDetailsInStructure]);
  // Where they belong, they're read and cleaned as ever.
  expect((await clean(file(b))).cleaned).toBe(true);
});

test("a picture outside the data isn't blanked: no copy is made", async () => {
  const b = heic([
    PICTURE,
    {
      id: 2,
      type: "Exif",
      payload: [0, 0, 0, 0, ...bytes("MM\0*"), ...u32(8), 0, 0, ...u32(0)],
    },
  ]);
  // The picture's 4 bytes said to be the file type's brand.
  const odd = moved(b, 1, 8);
  expect(() => stripHeic(odd)).toThrow(CantClean);
  const copy = await clean(file(odd));
  expect(copy.cleaned).toBe(false);
  expect(copy.notes).toEqual([en.clean.heicPictureOutside]);
});
