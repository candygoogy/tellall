// Files built to make reading them slow (tens of thousands of comments,
// text chunks, XMP parts, HEIC references, groups and extents) are read
// and cleaned in well under 2 seconds each: lists grow in place, lookups
// are by id, and counts are capped.
import { describe, expect, test } from "vitest";
import { clean, inspect } from "../src/index.ts";
import { readFileSync } from "node:fs";
import { chunks as pngChunks } from "../src/image/strip/png.ts";
import { ascii, pngChunk, segment, u16, u32 } from "./forge.ts";

const BUDGET = 2_000;
const ROOT = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) =>
  new Uint8Array(readFileSync(new URL(path, ROOT)));

const jpegWith = (parts: Buffer) => {
  const base = fixture("photo/clean.jpg");
  return new Uint8Array(
    Buffer.concat([base.subarray(0, 2), parts, base.subarray(2)]),
  );
};
const pngWith = (parts: Buffer) => {
  const base = fixture("ai/paint-drawing.png");
  const ihdr = pngChunks(base).list[0];
  if (!ihdr) throw new Error("no IHDR");
  return new Uint8Array(
    Buffer.concat([base.subarray(0, ihdr.end), parts, base.subarray(ihdr.end)]),
  );
};
const many = (n: number, part: (i: number) => number[]) =>
  Buffer.concat(Array.from({ length: n }, (_, i) => Buffer.from(part(i))));

// HEIC, with items' extents counted from mdat's content.
const box = (type: string, ...body: (number[] | Buffer)[]) => {
  const flat = Buffer.concat(body.map((b) => Buffer.from(b)));
  return Buffer.concat([
    Buffer.from([...u32(8 + flat.length), ...ascii(type)]),
    flat,
  ]);
};
const full = (type: string, version: number, ...body: (number[] | Buffer)[]) =>
  box(type, [version, 0, 0, 0], ...body);
type HeicItem = { id: number; type: string; extents: [number, number][] };
function heic(items: HeicItem[], data: Buffer, extra: Buffer[] = []) {
  const iinf = full(
    "iinf",
    1,
    u32(items.length),
    ...items.map((x) => full("infe", 2, u16(x.id), u16(0), ascii(x.type), [0])),
  );
  const iloc = (base: number) =>
    full(
      "iloc",
      1,
      [0x44, 0x00],
      u16(items.length),
      ...items.map((x) =>
        Buffer.from([
          ...u16(x.id),
          ...u16(0),
          ...u16(0),
          ...u16(x.extents.length),
          ...x.extents.flatMap(([o, l]) => [...u32(base + o), ...u32(l)]),
        ]),
      ),
    );
  const parts = (base: number) => [
    full("pitm", 0, u16(1)),
    iinf,
    iloc(base),
    ...extra,
  ];
  const ftyp = box("ftyp", ascii("heic"), u32(0), ascii("mif1heic"));
  const base = ftyp.length + full("meta", 0, ...parts(0)).length + 8;
  return new Uint8Array(
    Buffer.concat([ftyp, full("meta", 0, ...parts(base)), box("mdat", data)]),
  );
}
const EXIF = Buffer.from([
  ...u32(0),
  ...ascii("MM\0*"),
  ...u32(8),
  ...u16(0),
  ...u32(0),
]);
const pictures = (n: number): HeicItem[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    type: "hvc1",
    extents: [[i, 1]],
  }));

const cases: [string, () => Uint8Array][] = [
  [
    "a JPEG with 80,000 comments",
    () => jpegWith(many(80_000, () => segment(0xfe, ascii("LEAK")))),
  ],
  [
    "a JPEG with 40,000 parts of extended XMP",
    () =>
      jpegWith(
        many(40_000, (i) =>
          segment(0xe1, [
            ...ascii("http://ns.adobe.com/xmp/extension/\0"),
            ...ascii("0123456789ABCDEF0123456789ABCDEF"),
            ...u32(40_000 * 8),
            ...u32(i * 8),
            ...ascii("LEAK-xmp"),
          ]),
        ),
      ),
  ],
  [
    "a PNG with 80,000 text chunks of one name",
    () => pngWith(many(80_000, () => pngChunk("tEXt", ascii("Comment\0LEAK")))),
  ],
  [
    "a PNG with 80,000 text chunks of different names",
    () => pngWith(many(80_000, (i) => pngChunk("tEXt", ascii(`k${i}\0LEAK`)))),
  ],
  [
    "a HEIC with 60,000 cdsc references",
    () =>
      heic(
        [
          { id: 1, type: "hvc1", extents: [[0, 4]] },
          { id: 2, type: "Exif", extents: [[4, EXIF.length]] },
        ],
        Buffer.concat([Buffer.from([0x77, 0x77, 0x77, 0x77]), EXIF]),
        [
          full(
            "iref",
            0,
            ...Array.from({ length: 60_000 }, () =>
              box("cdsc", u16(2), u16(1), u16(1)),
            ),
          ),
        ],
      ),
  ],
  [
    "a HEIC with 20,000 pictures in one alternatives group",
    () => {
      const items = pictures(20_000);
      return heic(items, Buffer.alloc(items.length, 0x77), [
        box(
          "grpl",
          full(
            "altr",
            0,
            u32(1),
            u32(items.length),
            ...items.map((x) => u32(x.id)),
          ),
        ),
      ]);
    },
  ],
  [
    "a HEIC with 15,000 thumbnails of each other",
    () => {
      const items = pictures(15_000);
      const thmb = box(
        "thmb",
        u16(2),
        u16(items.length),
        items.flatMap((x) => u16(x.id)),
      );
      const dimg = items
        .slice(0, -1)
        .map((x) => box("dimg", u16(x.id), u16(1), u16(x.id + 1)));
      return heic(items, Buffer.alloc(items.length, 0x77), [
        full("iref", 0, thmb, ...dimg),
      ]);
    },
  ],
  [
    "a HEIC whose Exif is 60,000 one-byte extents",
    () => {
      const n = 60_000;
      const data = Buffer.concat([
        Buffer.from([0x77, 0x77, 0x77, 0x77]),
        Buffer.alloc(n, 0x41),
      ]);
      data.set(EXIF, 4);
      const extents = Array.from({ length: n }, (_, i): [number, number] => [
        4 + i,
        1,
      ]);
      return heic(
        [
          { id: 1, type: "hvc1", extents: [[0, 4]] },
          { id: 2, type: "Exif", extents },
        ],
        data,
      );
    },
  ],
];

describe("hostile files read and clean fast", () => {
  test.each(cases)("%s", async (_, make) => {
    const bytes = make();
    const input = { kind: "file", name: "x", bytes } as const;
    let t = performance.now();
    await inspect(input);
    expect(performance.now() - t).toBeLessThan(BUDGET);
    t = performance.now();
    const copy = await clean(input);
    expect(performance.now() - t).toBeLessThan(BUDGET);
    expect(Buffer.from(copy.output as Uint8Array).includes("LEAK")).toBe(false);
  });
});
