// Bytes hidden inside the parts a clean copy keeps: a segment or chunk
// longer than its content, one in a place decoders don't read, a second
// copy of one there can only be one of, reserved bits and bytes, and in a
// HEIC, names, unused items and the like. Each crafted file still opens,
// its clean copy opens and looks the same, and nothing marked survives.
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { heifLayout, itemBytes } from "../src/image/heif.ts";
import { cleanImage, stripHeic } from "../src/image/strip/index.ts";
import { cleanJpegInPlace, segments } from "../src/image/strip/jpeg.ts";
import { chunks as pngChunks } from "../src/image/strip/png.ts";
import { chunks as webpChunks } from "../src/image/strip/webp.ts";
import {
  box,
  bytes,
  exifPayload,
  ARTIST,
  FTYP,
  full,
  u16,
  u32,
} from "./craft.ts";
import {
  ascii,
  leaks,
  pngChunk,
  riff,
  segment,
  text,
  webpChunk,
} from "./forge.ts";
import { HEIGHT, image, jpeg, pixels, png, WIDTH } from "./gradient.ts";

/** The same pixels before and after, and nothing marked left. */
async function same(file: Uint8Array, out: Uint8Array) {
  expect(leaks(file)).toBe(true);
  expect(leaks(out)).toBe(false);
  expect(await pixels(out)).toEqual(await pixels(file));
}

describe("JPEG", () => {
  /** The picture with segments after SOI, or before its first scan. */
  async function made(head: number[], beforeScan: number[] = []) {
    const base = await jpeg();
    const scan = segments(base).list.find((s) => s.marker === 0xda);
    const at = scan?.start ?? 0;
    return new Uint8Array([
      ...base.subarray(0, 2),
      ...head,
      ...base.subarray(2, at),
      ...beforeScan,
      ...base.subarray(at),
    ]);
  }

  test("a line count (DNL) with words in it goes", async () => {
    const file = await made([], segment(0xdc, ascii("LEAK-DNL 51.5007N")));
    const out = cleanImage(file, "jpeg", 1, { keepLabels: true });
    await same(file, out);
    expect(segments(out).list.some((s) => s.marker === 0xdc)).toBe(false);
  });

  test("Adobe's segment keeps only how the colours were stored", async () => {
    // Its two flag fields, four bytes no decoder reads, spell LEAK.
    const adobe = [...ascii("Adobe"), 0, 100, ...ascii("LEAK"), 1];
    const file = await made(segment(0xee, adobe));
    const out = cleanImage(file, "jpeg", 1, { keepLabels: true });
    await same(file, out);
    const kept = segments(out).list.find((s) => s.marker === 0xee);
    expect(kept && Array.from(out.subarray(kept.body, kept.end))).toEqual([
      ...ascii("Adobe"),
      0,
      100,
      0,
      0,
      0,
      0,
      1,
    ]);
  });

  test("Adobe's segment after the first scan goes", async () => {
    const base = new Uint8Array(
      await image().jpeg({ progressive: true }).toBuffer(),
    );
    const scans = segments(base).list.filter((s) => s.marker === 0xda);
    const at = scans[1]?.start ?? 0;
    const adobe = [...ascii("Adobe"), 0, 100, ...ascii("LEAK"), 0];
    const file = new Uint8Array([
      ...base.subarray(0, at),
      ...segment(0xee, adobe),
      ...base.subarray(at),
    ]);
    await same(file, cleanImage(file, "jpeg", 1, { keepLabels: true }));
  });

  test("cleaned in place, a stray 0xD9 before the end leaves the end", async () => {
    // After the last scan: a comment, a stray 0xD9 a decoder skips, the end.
    const base = await jpeg();
    const file = new Uint8Array([
      ...base.subarray(0, -2),
      ...segment(0xfe, ascii("LEAK")),
      0xd9,
      0xff,
      0xd9,
    ]);
    const out = cleanJpegInPlace(file);
    expect(out.length).toBe(file.length);
    expect(Array.from(out.subarray(-2))).toEqual([0xff, 0xd9]);
    await same(file, out);
  });
});

describe("PNG", () => {
  /** The picture with chunks after IHDR, and before IEND. */
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
  const types = (b: Uint8Array) => pngChunks(b).list.map((c) => c.type);
  const pHYs = [0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1];

  test.each([
    [
      "pixel size longer than its 9 bytes",
      pngChunk("pHYs", [...pHYs, ...ascii("LEAK-PHYS")]),
      [],
    ],
    [
      "a second pixel size",
      [...pngChunk("pHYs", pHYs), ...pngChunk("pHYs", ascii("LEAK-PHY2"))],
      [],
    ],
    ["gamma after the picture's data", [], pngChunk("gAMA", ascii("LEAK"))],
    [
      "a gamma longer than its 4 bytes",
      pngChunk("gAMA", [0, 0, 0xb1, 0x8f, ...ascii("LEAK")]),
      [],
    ],
    [
      "an animation frame without an animation",
      [],
      pngChunk("fdAT", [0, 0, 0, 1, ...ascii("LEAK-FDAT")]),
    ],
    [
      "a frame header without an animation",
      [],
      pngChunk(
        "fcTL",
        [
          ...u32(0),
          ...u32(WIDTH),
          ...u32(HEIGHT),
          ...ascii("LEAK-FCTL-xxxxxx"),
        ].slice(0, 26),
      ),
    ],
    [
      "chromaticities with a broken checksum",
      (() => {
        const c = pngChunk("cHRM", ascii("LEAK".repeat(8)));
        c[c.length - 1] = (c[c.length - 1] ?? 0) ^ 0xff;
        return c;
      })(),
      [],
    ],
  ] as const)("%s goes", async (_name, head, tail) => {
    const file = await made([...head], [...tail]);
    const out = cleanImage(file, "png", 1, { keepLabels: true });
    await same(file, out);
  });

  test("picture data in a second run, after other chunks, goes", async () => {
    // Decoders read the first run of data chunks only.
    const file = await made(
      [],
      [
        ...pngChunk("tEXt", ascii("Comment\0hello")),
        ...pngChunk("IDAT", ascii("LEAK-IDAT")),
      ],
    );
    const out = cleanImage(file, "png", 1, { keepLabels: true });
    await same(file, out);
    expect(types(out).filter((t) => t === "IDAT")).toHaveLength(
      types(file).filter((t) => t === "IDAT").length - 1,
    );
  });

  test("an animation keeps its frames", async () => {
    const base = await png();
    const list = pngChunks(base).list;
    const ihdr = list[0]?.end ?? 0;
    const idat = list.find((c) => c.type === "IDAT");
    if (!idat) throw new Error("no IDAT");
    const data = base.subarray(idat.data, idat.end - 4);
    const fctl = (n: number) => [
      ...u32(n),
      ...u32(WIDTH),
      ...u32(HEIGHT),
      ...u32(0),
      ...u32(0),
      ...u16(1),
      ...u16(10),
      0,
      0,
    ];
    const file = new Uint8Array([
      ...base.subarray(0, ihdr),
      ...pngChunk("acTL", [...u32(2), ...u32(0)]),
      ...pngChunk("fcTL", fctl(0)),
      ...base.subarray(ihdr, -12),
      ...pngChunk("fcTL", fctl(1)),
      ...pngChunk("fdAT", [...u32(2), ...data]),
      ...base.subarray(-12),
    ]);
    const out = cleanImage(file, "png", 1, { keepLabels: true });
    // Every frame kept, byte for byte (sharp draws the first frame only).
    expect(types(out)).toEqual(types(file));
    expect(out).toEqual(file);
    expect(await pixels(out)).toEqual(await pixels(base));
  });
});

describe("WebP", () => {
  const still = async () =>
    new Uint8Array(await image().webp({ quality: 90 }).toBuffer());
  const vp8x = (flags: number, extra: number[] = []) =>
    webpChunk("VP8X", [
      flags,
      ...extra.slice(0, 3),
      ...[0, 0, 0].slice(extra.length),
      WIDTH - 1,
      0,
      0,
      HEIGHT - 1,
      0,
      0,
    ]);

  test("the extended header: its reserved bytes and extra length go", async () => {
    const plain = await still();
    const file = new Uint8Array(
      riff([
        ...webpChunk("VP8X", [
          0xc1,
          ...ascii("LEA"),
          WIDTH - 1,
          0,
          0,
          HEIGHT - 1,
          0,
          0,
          ...ascii("K-VP8X"),
        ]),
        ...plain.subarray(12),
      ]),
    );
    const out = cleanImage(file, "webp", 1, { keepLabels: true });
    expect(text(out)).not.toContain("LEA");
    expect(text(out)).not.toContain("K-VP8X");
    const header = webpChunks(out, 12, out.length)[0];
    expect(header?.size).toBe(10);
    expect(out[20]).toBe(0);
    expect(await pixels(out)).toEqual(await pixels(plain));
  });

  test("a second picture, and alpha for it, go", async () => {
    const plain = await still();
    const other = new Uint8Array(
      await sharp({
        create: {
          width: WIDTH,
          height: HEIGHT,
          channels: 3,
          background: "#123456",
        },
      })
        .webp()
        .toBuffer(),
    );
    const file = new Uint8Array(
      riff([
        ...plain.subarray(12),
        ...other.subarray(12),
        ...webpChunk("ALPH", ascii("LEAK-ALPH")),
      ]),
    );
    const out = cleanImage(file, "webp", 1, { keepLabels: true });
    await same(file, out);
    expect(webpChunks(out, 12, out.length).map((c) => c.type)).toEqual([
      "VP8 ",
    ]);
  });

  test("an animation's header and frames keep only what they need", async () => {
    const plain = await still();
    const picture = Array.from(plain.subarray(12));
    // A frame: place, size, timing, then a flags byte whose reserved bits
    // are set, then the picture and a second one.
    const frame = (flags: number) => [
      0,
      0,
      0,
      0,
      0,
      0,
      WIDTH - 1,
      0,
      0,
      HEIGHT - 1,
      0,
      0,
      100,
      0,
      0,
      flags,
      ...picture,
      ...webpChunk("VP8 ", ascii("LEAK-SECOND-PICTURE")),
    ];
    const file = new Uint8Array(
      riff([
        ...vp8x(0x02),
        ...webpChunk("ANIM", [0, 0, 0, 0, 0, 0, ...ascii("LEAK-ANIM")]),
        ...webpChunk("ANMF", frame(0xfc)),
        ...webpChunk("ANMF", frame(0x00)),
      ]),
    );
    const out = cleanImage(file, "webp", 1, { keepLabels: true });
    expect(leaks(out)).toBe(false);
    const top = webpChunks(out, 12, out.length);
    expect(top.map((c) => c.type)).toEqual(["VP8X", "ANIM", "ANMF", "ANMF"]);
    expect(top[1]?.size).toBe(6);
    const first = top[2];
    expect(first && out[first.body + 15]).toBe(0);
    expect((await sharp(out, { animated: true }).metadata()).pages).toBe(2);
  });

  test("frames in a file not flagged animated aren't a picture", async () => {
    const picture = Array.from((await still()).subarray(12));
    // Place, size, timing and flags, then the picture.
    const head = [
      0,
      0,
      0,
      0,
      0,
      0,
      WIDTH - 1,
      0,
      0,
      HEIGHT - 1,
      0,
      0,
      100,
      0,
      0,
      0,
    ];
    const file = new Uint8Array(
      riff([...vp8x(0x00), ...webpChunk("ANMF", [...head, ...picture])]),
    );
    expect(() => cleanImage(file, "webp", 1, { keepLabels: true })).toThrow(
      "The WebP has no picture.",
    );
  });
});

describe("HEIC", () => {
  const PICTURE = [0x77, 0x77, 0x77, 0x77];
  interface Spec {
    id: number;
    type: string;
    payload?: number[];
    /** The entry's version (2 unless given), its name, its content type. */
    version?: number;
    name?: string;
    contentType?: string;
  }
  /** A HEIC: ftyp, then meta (hdlr, pitm, iinf, iloc, iref, iprp and
   * whatever else is given), then mdat. */
  function build(
    items: Spec[],
    {
      refs = [] as number[][],
      primary = 1,
      hdlrName = "",
      extra = [] as number[][],
      ftyp = FTYP,
      properties = [] as number[][],
    } = {},
  ): Uint8Array {
    const infe = (x: Spec) =>
      (x.version ?? 2) >= 2
        ? full(
            "infe",
            x.version ?? 2,
            u16(x.id),
            u16(0),
            bytes(x.type),
            bytes(`${x.name ?? ""}\0`),
            x.contentType !== undefined ? bytes(`${x.contentType}\0`) : [],
          )
        : full(
            "infe",
            x.version ?? 0,
            u16(x.id),
            u16(0),
            bytes(`${x.name ?? ""}\0`),
            bytes(`${x.contentType ?? ""}\0`),
          );
    const stored = items.filter((x) => x.payload);
    const iloc = (mdat: number) => {
      let at = mdat + 8;
      const rows = stored.map((x) => {
        const row = [
          ...u16(x.id),
          ...u16(0),
          ...u16(0),
          ...u16(1),
          ...u32(at),
          ...u32(x.payload?.length ?? 0),
        ];
        at += x.payload?.length ?? 0;
        return row;
      });
      return full("iloc", 1, [0x44, 0x00], u16(stored.length), ...rows);
    };
    const ipco = box("ipco", full("ispe", 0, u32(2), u32(2)), ...properties);
    const marks = properties.map((_, i) => 0x82 + i);
    const ipma = full("ipma", 0, u32(1), [
      ...u16(primary),
      1 + marks.length,
      0x81,
      ...marks,
    ]);
    const meta = (mdat: number) =>
      full(
        "meta",
        0,
        full(
          "hdlr",
          0,
          u32(0),
          bytes("pict"),
          u32(0),
          u32(0),
          u32(0),
          bytes(`${hdlrName}\0`),
        ),
        full("pitm", 0, u16(primary)),
        full("iinf", 0, u16(items.length), ...items.map(infe)),
        iloc(mdat),
        refs.length ? full("iref", 0, ...refs) : [],
        box("iprp", ipco, ipma),
        ...extra,
      );
    const at = ftyp.length + meta(0).length;
    return new Uint8Array([
      ...ftyp,
      ...meta(at),
      ...box("mdat", ...stored.map((x) => x.payload ?? [])),
    ]);
  }
  const bytesOf = (b: Uint8Array, id: number) => {
    const item = heifLayout(b).items.find((x) => x.id === id);
    if (!item) throw new Error(`no item ${id}`);
    return itemBytes(b, item);
  };

  test("a picture nothing leads to is blanked", () => {
    const file = build([
      { id: 1, type: "hvc1", payload: PICTURE },
      { id: 9, type: "hvc1", payload: ascii("LEAK-HIDDEN-PICTURE") },
    ]);
    const out = stripHeic(file, 1);
    expect(leaks(out)).toBe(false);
    expect(Array.from(bytesOf(out, 1))).toEqual(PICTURE);
    expect(heifLayout(out).pictures.map((x) => x.id)).toEqual([1]);
  });

  test("a text item a grid says it's made of is blanked", () => {
    const file = build(
      [
        { id: 1, type: "grid", payload: [0, 0, 0, 0, 0, 2, 0, 2] },
        { id: 2, type: "hvc1", payload: PICTURE },
        {
          id: 3,
          type: "mime",
          contentType: "text/plain",
          payload: ascii("LEAK-DIMG"),
        },
      ],
      { refs: [box("dimg", u16(1), u16(2), u16(2), u16(3))] },
    );
    const out = stripHeic(file, 1);
    expect(leaks(out)).toBe(false);
    expect(
      heifLayout(out)
        .pictures.map((x) => x.id)
        .sort(),
    ).toEqual([1, 2]);
  });

  test("a main item that isn't a picture: no clean copy", () => {
    const file = build(
      [
        { id: 1, type: "hvc1", payload: PICTURE },
        {
          id: 3,
          type: "mime",
          contentType: "text/plain",
          payload: ascii("LEAK-PITM"),
        },
      ],
      { primary: 3 },
    );
    expect(() => stripHeic(file, 1)).toThrow();
  });

  test("an item listed twice: no clean copy", () => {
    const file = build([
      { id: 1, type: "hvc1", payload: PICTURE },
      { id: 2, type: "Exif", payload: exifPayload([[ARTIST, "LEAK-DUP"]]) },
      { id: 2, type: "hvc1" },
    ]);
    expect(() => stripHeic(file, 1)).toThrow();
  });

  test("words an Exif item skips before its TIFF are blanked", async () => {
    const head = ascii(
      "LEAK-EXIF-HEAD Jane Doe 51.5007N 0.1246W".padEnd(64, "."),
    );
    const tiff = exifPayload([[ARTIST, "Somebody"]]).slice(4);
    const file = build(
      [
        { id: 1, type: "hvc1", payload: PICTURE },
        { id: 2, type: "Exif", payload: [...u32(64), ...head, ...tiff] },
      ],
      { refs: [box("cdsc", u16(2), u16(1), u16(1))] },
    );
    const out = stripHeic(file, 1);
    expect(leaks(out)).toBe(false);
    expect(Array.from(bytesOf(out, 2).subarray(0, 4))).toEqual(u32(64));
  });

  test("an Exif item's own Exif\\0\\0 before its TIFF stays", () => {
    const tiff = exifPayload([[ARTIST, "LEAK-ARTIST"]]).slice(4);
    const file = build(
      [
        { id: 1, type: "hvc1", payload: PICTURE },
        {
          id: 2,
          type: "Exif",
          payload: [...u32(6), ...ascii("Exif\0\0"), ...tiff],
        },
      ],
      { refs: [box("cdsc", u16(2), u16(1), u16(1))] },
    );
    const out = stripHeic(file, 1);
    expect(leaks(out)).toBe(false);
    expect(
      Buffer.from(bytesOf(out, 2).subarray(4, 10)).toString("latin1"),
    ).toBe("Exif\0\0");
  });

  test("names, types and locations in kept boxes are blanked", () => {
    const dinf = box(
      "dinf",
      full(
        "dref",
        0,
        u32(1),
        full("url ", 0, bytes("LEAK-URL file://jane-laptop/\0")),
      ),
    );
    const file = build(
      [
        { id: 1, type: "hvc1", payload: PICTURE, name: "LEAK-NAME-1" },
        {
          id: 4,
          type: "mime",
          contentType: "LEAK-TYPE/plain",
          payload: ascii("x"),
        },
        {
          id: 5,
          type: "uri ",
          contentType: "tag:LEAK.example,2026:x",
          payload: ascii("y"),
        },
        {
          id: 6,
          type: "",
          version: 1,
          name: "LEAK-OLD-NAME",
          contentType: "LEAK/old",
        },
        {
          id: 7,
          type: "",
          version: 0,
          name: "LEAK-OLDER-NAME",
          contentType: "LEAK/older",
        },
      ],
      { hdlrName: "LEAK-HANDLER Jane Doe", extra: [dinf] },
    );
    const out = stripHeic(file, 1);
    expect(leaks(out)).toBe(false);
    expect(out.length).toBe(file.length);
    expect(Array.from(bytesOf(out, 1))).toEqual(PICTURE);
  });

  test("the photo's XMP keeps a type that still says XMP, and nothing more", () => {
    const file = build([
      { id: 1, type: "hvc1", payload: PICTURE },
      {
        id: 2,
        type: "mime",
        contentType: "application/rdf+xml; LEAK=yes",
        payload: ascii("<x:xmpmeta>LEAK-XMP</x:xmpmeta>"),
      },
    ]);
    const out = stripHeic(file, 1);
    expect(leaks(out)).toBe(false);
    expect(heifLayout(out).xmp.map((x) => x.id)).toEqual([2]);
  });

  test("the file type's unknown brands and trailing bytes are blanked", () => {
    const ftyp = box(
      "ftyp",
      bytes("heic"),
      bytes("LEAK"),
      bytes("mif1heicLEAKmiaf"),
      bytes("LEAK!"),
    );
    const file = build([{ id: 1, type: "hvc1", payload: PICTURE }], { ftyp });
    const out = stripHeic(file, 1);
    expect(leaks(out)).toBe(false);
    const brands = Buffer.from(out.subarray(16, 32)).toString("latin1");
    expect(brands).toBe("mif1heicheicmiaf");
  });

  test("a colour property past its fields, and an unknown helper's name, are blanked", () => {
    const nclx = box(
      "colr",
      bytes("nclx"),
      u16(1),
      u16(13),
      u16(1),
      [0x80],
      bytes("LEAK-NCLX"),
    );
    const auxC = full(
      "auxC",
      0,
      bytes("urn:LEAK-AUXC\0"),
      bytes("LEAK-SUBTYPE"),
    );
    const alpha = full(
      "auxC",
      0,
      bytes("urn:mpeg:mpegB:cicp:systems:auxiliary:alpha\0"),
    );
    const file = build([{ id: 1, type: "hvc1", payload: PICTURE }], {
      properties: [nclx, auxC, alpha],
    });
    const out = stripHeic(file, 1);
    expect(leaks(out)).toBe(false);
    expect(Buffer.from(out).toString("latin1")).toContain(
      "urn:mpeg:mpegB:cicp:systems:auxiliary:alpha",
    );
    const at = Buffer.from(out).indexOf("nclx");
    expect(Array.from(out.subarray(at + 4, at + 11))).toEqual([
      0, 1, 0, 13, 0, 1, 0x80,
    ]);
  });

  test("a JPEG picture inside keeps its picture and loses its Exif", async () => {
    const base = await jpeg();
    const inside = [
      ...base.subarray(0, 2),
      ...segment(0xe1, [...ascii("Exif\0\0"), ...ascii("LEAK-JPEG-ITEM")]),
      ...segment(0xfe, ascii("LEAK-COMMENT")),
      ...base.subarray(2),
      ...ascii("LEAK-AFTER"),
    ];
    const file = build(
      [
        { id: 1, type: "hvc1", payload: PICTURE },
        { id: 2, type: "jpeg", payload: inside },
      ],
      { refs: [box("thmb", u16(2), u16(1), u16(1))] },
    );
    const out = stripHeic(file, 1);
    expect(leaks(out)).toBe(false);
    const kept = bytesOf(out, 2);
    expect(kept.length).toBe(inside.length);
    expect(await pixels(kept)).toEqual(await pixels(base));
  });

  test("a JPEG picture inside, cut off in a comment after its scan, loses the comment", async () => {
    const base = await jpeg();
    // The picture without its end marker, then a comment (COM, or an Exif
    // APP1) whose length runs past the end of the item.
    const picture = base.subarray(0, -2);
    for (const marker of [0xfe, 0xe1]) {
      const cut = segment(marker, ascii("LEAK-CUT-OFF 51.5007N")).slice(0, -4);
      const inside = [...picture, ...cut];
      const file = build(
        [
          { id: 1, type: "hvc1", payload: PICTURE },
          { id: 2, type: "jpeg", payload: inside },
        ],
        { refs: [box("thmb", u16(2), u16(1), u16(1))] },
      );
      expect(leaks(file)).toBe(true);
      const out = stripHeic(file, 1);
      expect(leaks(out)).toBe(false);
      const kept = bytesOf(out, 2);
      expect(kept.length).toBe(inside.length);
      // The picture's data is all still there, byte for byte; the cut
      // comment is fill.
      expect(kept.subarray(0, picture.length)).toEqual(picture);
      expect(Array.from(kept.subarray(picture.length))).toEqual(
        cut.map(() => 0xff),
      );
    }
  });
});
