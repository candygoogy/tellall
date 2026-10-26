// HEIC files crafted to reach the corners: Exif about a helper picture,
// helpers kept and left out, details stored inside another item, boxes whose counts ask for more than
// they hold, and metadata too big for one JPEG segment.
import { describe, expect, test } from "vitest";
import {
  CantClean,
  heifLayout,
  heifMeta,
  itemBytes,
  Reader,
  find,
} from "../src/image/heif.ts";
import { readMeta } from "../src/image/read.ts";
import { stripHeic, stripWebp } from "../src/image/strip/index.ts";
import { sentences, summarize } from "./photo-summary.ts";

import {
  ARTIST,
  box,
  bytes,
  DESCRIPTION,
  exifPayload,
  FTYP,
  full,
  GAIN_MAP,
  heic,
  HELPER,
  PICTURES,
  MARKER,
  u16,
  u32,
  xmpPacket,
} from "./craft.ts";

const has = (b: Uint8Array, s: string) =>
  Buffer.from(b).toString("latin1").includes(s);

describe("Exif about a helper picture", () => {
  const file = heic(
    [
      ...PICTURES,
      { id: 3, type: "Exif", payload: exifPayload([[ARTIST, MARKER]]) },
    ],
    [HELPER, box("cdsc", u16(3), u16(1), u16(2))],
  );

  test("is the photo's: read, and said", async () => {
    expect(heifMeta(file).exif.map((x) => x.id)).toEqual([3]);
    const meta = await readMeta(file, "heic");
    expect(sentences(summarize(meta))).toContain(
      `It names a person: ${MARKER}.`,
    );
  });

  test("is blanked in the clean copy, with no trace left", async () => {
    const out = stripHeic(file, 1);
    expect(out.length).toBe(file.length);
    expect(has(out, MARKER)).toBe(false);
    expect(await readMeta(out, "heic")).toBeUndefined();
  });

  test("XMP about the helper stays when it only says how to draw it", async () => {
    const gainMap = bytes(
      `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core 6.0.0"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:HDRGainMap="http://ns.apple.com/HDRGainMap/1.0/"><HDRGainMap:HDRGainMapVersion>131072</HDRGainMap:HDRGainMapVersion></rdf:Description></rdf:RDF></x:xmpmeta>`,
    );
    const withXmp = heic(
      [...PICTURES, { id: 4, type: "xmp", payload: gainMap }],
      [HELPER, box("cdsc", u16(4), u16(1), u16(2))],
    );
    expect(heifMeta(withXmp).xmp).toEqual([]);
    expect(await readMeta(withXmp, "heic")).toBeUndefined();
    expect(has(stripHeic(withXmp, 1), "HDRGainMapVersion>131072")).toBe(true);
  });

  test("XMP about the helper that says more is read, and blanked", async () => {
    // A creator in a helper's XMP: no gain map needs one.
    const withXmp = heic(
      [...PICTURES, { id: 4, type: "xmp", payload: xmpPacket(MARKER) }],
      [HELPER, box("cdsc", u16(4), u16(1), u16(2))],
    );
    expect(heifMeta(withXmp).xmp.map((x) => x.id)).toEqual([4]);
    expect(sentences(summarize(await readMeta(withXmp, "heic")))).toContain(
      `It names a person: ${MARKER}.`,
    );
    expect(has(stripHeic(withXmp, 1), MARKER)).toBe(false);
  });
});

describe("helper pictures", () => {
  // The photo (1), its gain map (2) and thumbnail (3), a depth map (4), a
  // portrait matte (5), XMP about the matte (6), an alpha map under each
  // of its names (7, 8), and a type that only starts like one (9).
  const file = heic(
    [
      ...PICTURES,
      { id: 3, type: "hvc1", payload: bytes("THMB") },
      {
        id: 4,
        type: "hvc1",
        payload: bytes("LEAK-DEPTH"),
        aux: "urn:mpeg:hevc:2015:auxid:2",
      },
      {
        id: 5,
        type: "hvc1",
        payload: bytes("LEAK-MATTE"),
        aux: "urn:com:apple:photo:2018:aux:portraiteffectsmatte",
      },
      { id: 6, type: "xmp", payload: xmpPacket(MARKER) },
      {
        id: 7,
        type: "hvc1",
        payload: bytes("ALPHA1"),
        aux: "urn:mpeg:hevc:2015:auxid:1",
      },
      {
        id: 8,
        type: "hvc1",
        payload: bytes("ALPHA2"),
        aux: "urn:mpeg:mpegB:cicp:systems:auxiliary:alpha",
      },
      {
        id: 9,
        type: "hvc1",
        payload: bytes("LEAK-AUX10"),
        aux: "urn:mpeg:hevc:2015:auxid:10",
      },
    ],
    [
      HELPER,
      box("thmb", u16(3), u16(1), u16(1)),
      box("auxl", u16(4), u16(1), u16(1)),
      box("auxl", u16(5), u16(1), u16(1)),
      box("cdsc", u16(6), u16(1), u16(5)),
      box("auxl", u16(7), u16(1), u16(1)),
      box("auxl", u16(8), u16(1), u16(1)),
      box("auxl", u16(9), u16(1), u16(1)),
    ],
  );
  const ids = (items: { id: number }[]) => items.map((x) => x.id).sort();
  /** Each item's hidden flag, from its entry in iinf. */
  const hidden = (b: Uint8Array) => {
    const r = new Reader(b);
    const iinf = find(heifLayout(b).inside, "iinf");
    if (!iinf) throw new Error("no iinf");
    return r
      .boxes(iinf.body + 6, iinf.end)
      .filter((entry) => (b[entry.body + 3] ?? 0) & 1)
      .map((entry) => r.uint(entry.body + 4, 2));
  };

  test("the gain map, the thumbnail and alpha are kept; depth and matte go", () => {
    const layout = heifLayout(file);
    expect(ids(layout.pictures)).toEqual([1, 2, 3, 7, 8]);
    expect(ids(layout.leftOut)).toEqual([4, 5, 9]);

    const out = stripHeic(file, 1);
    expect(out.length).toBe(file.length);
    expect(has(out, "LEAK")).toBe(false);
    expect(has(out, MARKER)).toBe(false);
    const after = heifLayout(out);
    const bytesOf = (id: number) => {
      const item = after.items.find((x) => x.id === id);
      if (!item) throw new Error(`no item ${id}`);
      return Array.from(itemBytes(out, item));
    };
    expect(bytesOf(2)).toEqual(PICTURES[1]?.payload);
    expect(bytesOf(3)).toEqual(bytes("THMB"));
    expect(bytesOf(4)).toEqual(Array(10).fill(0));
    expect(bytesOf(5)).toEqual(Array(10).fill(0));
    expect(bytesOf(7)).toEqual(bytes("ALPHA1"));
    expect(bytesOf(8)).toEqual(bytes("ALPHA2"));
    expect(bytesOf(9)).toEqual(Array(10).fill(0));
    // Nothing points from the photo to what's gone, or from the XMP about
    // it: those references are "free" now. The items are still listed,
    // hidden, so every entry, location and property still adds up.
    expect(after.references.map((x) => [x.box.type, x.from])).toEqual([
      ["auxl", 2],
      ["thmb", 3],
      ["free", 4],
      ["free", 5],
      ["free", 6],
      ["auxl", 7],
      ["auxl", 8],
      ["free", 9],
    ]);
    expect(hidden(file)).toEqual([]);
    expect(hidden(out)).toEqual([4, 5, 9]);
    expect(ids(after.pictures)).toEqual([1, 2, 3, 7, 8]);
    expect(has(out, `${GAIN_MAP}\0`)).toBe(true);
  });

  test("a property list that runs past its box: Exif still read, helper left out", async () => {
    const broken = heic(
      [
        ...PICTURES,
        { id: 3, type: "Exif", payload: exifPayload([[ARTIST, MARKER]]) },
      ],
      [HELPER],
    );
    // ipma's entry count, after its version and flags, asks for far more
    // entries than the box holds.
    const ipma = Buffer.from(broken).indexOf("ipma");
    broken.set(u32(0xffffff), ipma + 4 + 4);

    const layout = heifLayout(broken);
    expect(ids(layout.pictures)).toEqual([1]);
    expect(ids(layout.leftOut)).toEqual([2]);
    expect(sentences(summarize(await readMeta(broken, "heic")))).toContain(
      `It names a person: ${MARKER}.`,
    );
    const out = stripHeic(broken, 1);
    expect(has(out, MARKER)).toBe(false);
    expect(
      Buffer.from(out).includes(Buffer.from([0x66, 0x66, 0x66, 0x66])),
    ).toBe(false);
  });
});

describe("details stored inside another item (iloc method 2)", () => {
  test.each(["Exif", "xmp"] as const)(
    "%s: can't be cleaned, and the page doesn't say nothing's there",
    async (type) => {
      const payload =
        type === "Exif" ? exifPayload([[ARTIST, MARKER]]) : xmpPacket(MARKER);
      const file = heic(
        [...PICTURES, { id: 3, type, payload, method: 2 }],
        [box("cdsc", u16(3), u16(1), u16(1))],
      );
      expect(() => heifMeta(file)).toThrow(CantClean);
      await expect(readMeta(file, "heic")).rejects.toThrow(CantClean);
      expect(() => stripHeic(file, 1)).toThrow(CantClean);
    },
  );
});

describe("a crafted HEIC can't make the reading run long", () => {
  const MB = 1 << 20;
  /** ftyp, a meta box holding `inside`, then a megabyte of 0xff. */
  const crafted = (inside: number[]) => {
    const head = [...FTYP, ...full("meta", 0, ...[inside])];
    const out = new Uint8Array(head.length + MB + 8);
    out.set(head);
    out.set([...u32(MB + 8), ...bytes("free")], head.length);
    out.fill(0xff, head.length + 8);
    return out;
  };
  const iinf = full(
    "iinf",
    0,
    u16(1),
    full("infe", 2, u16(3), u16(0), bytes("Exif"), [0]),
  );
  /** The file, with a free box of 0xff bytes after it up to 1 MB. */
  const atLeastOneMb = (file: Uint8Array | readonly number[]) => {
    const pad = Math.max(0, MB - file.length - 8);
    const out = new Uint8Array(file.length + (pad ? pad + 8 : 0));
    out.set(file);
    if (pad) {
      out.set([...u32(pad + 8), ...bytes("free")], file.length);
      out.fill(0xff, file.length + 8);
    }
    return out;
  };
  /** A megabyte-long box of 0xff bytes after its first fields. */
  const long = (type: string, version: number, ...head: number[][]) => {
    const flat = head.flat();
    return [
      ...u32(12 + flat.length + MB),
      ...bytes(type),
      version,
      0,
      0,
      0,
      ...flat,
      ...new Array<number>(MB).fill(0xff),
    ];
  };

  test.each([
    // An item count far past the box, every field zero bytes wide.
    [
      "iloc v2, a huge count",
      crafted([...iinf, ...full("iloc", 2, [0, 0], u32(0xffffffff))]),
    ],
    // Entries with no fields and 65535 extents each, a megabyte of them.
    [
      "iloc, zero-size extents",
      [
        ...FTYP,
        ...full("meta", 0, iinf, long("iloc", 2, [0, 0], u32(0x7fffffff))),
      ],
    ],
    // A megabyte of real-looking entries, each with many extents.
    [
      "iloc, a megabyte of entries",
      [
        ...FTYP,
        ...full("meta", 0, iinf, long("iloc", 1, [0x44, 0], u16(0xffff))),
      ],
    ],
    // A content type that runs a megabyte.
    [
      "iinf, a megabyte-long mime entry",
      [
        ...FTYP,
        ...full(
          "meta",
          0,
          full(
            "iinf",
            0,
            u16(1),
            long("infe", 2, u16(4), u16(0), bytes("mime")),
          ),
          full("iloc", 1, [0x44, 0], u16(0)),
        ),
      ],
    ],
    // A reference claiming 65535 targets in a few bytes.
    [
      "iref, a count past its box",
      [
        ...FTYP,
        ...full(
          "meta",
          0,
          iinf,
          full("iloc", 1, [0x44, 0], u16(0)),
          full("iref", 0, box("cdsc", u16(3), u16(0xffff), u16(1))),
        ),
      ],
    ],
  ] as const)("%s: a 1 MB file, well under 200 ms", (_name, file) => {
    const b = atLeastOneMb(file);
    expect(b.length).toBeGreaterThanOrEqual(MB);
    const start = performance.now();
    // Reading, then cleaning, as the page does.
    for (const run of [() => heifMeta(b), () => stripHeic(b, 1)]) {
      try {
        run();
      } catch {
        // Refused is fine; slow isn't.
      }
    }
    expect(performance.now() - start).toBeLessThan(200);
  });

  test("a count past its box is refused, not read from the next box", () => {
    const one = [
      ...u16(3),
      ...u16(0),
      ...u16(0),
      ...u16(1),
      ...u32(0),
      ...u32(4),
    ];
    const file = new Uint8Array([
      ...FTYP,
      ...full("meta", 0, iinf, full("iloc", 1, [0x44, 0], u16(2), one)),
      ...box("free", new Array<number>(64).fill(0)),
    ]);
    expect(() => heifMeta(file)).toThrow(/box/);
  });
});

describe("details bigger than one JPEG segment (64 KB)", () => {
  test("a HEIC's large Exif and large XMP are read in full", async () => {
    const file = heic(
      [
        ...PICTURES,
        {
          id: 3,
          type: "Exif",
          payload: exifPayload([
            [DESCRIPTION, "d".repeat(70_000)],
            [ARTIST, "Exif Person"],
          ]),
        },
        { id: 4, type: "xmp", payload: xmpPacket("Xmp Person", 80_000) },
      ],
      [
        box("cdsc", u16(3), u16(1), u16(1)),
        box("cdsc", u16(4), u16(1), u16(1)),
      ],
    );
    const meta = await readMeta(file, "heic");
    expect(meta?.["Artist"]).toBe("Exif Person");
    expect(summarize(meta).names).toEqual(["Exif Person", "Xmp Person"]);
    expect(await readMeta(stripHeic(file, 1), "heic")).toBeUndefined();
  });

  test("a WebP's large XMP is read in full", async () => {
    const chunk = (type: string, body: number[]) => {
      const out = [...bytes(type), ...u32(body.length).reverse(), ...body];
      return body.length % 2 ? [...out, 0] : out;
    };
    const vp8x = chunk("VP8X", [0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // A lossless picture's header (its bytes aren't drawn here).
    const vp8l = chunk("VP8L", [0x2f, 0, 0, 0, 0]);
    const xmp = chunk("XMP ", xmpPacket("Xmp Person", 80_000));
    const body = [...bytes("WEBP"), ...vp8x, ...vp8l, ...xmp];
    const file = new Uint8Array([
      ...bytes("RIFF"),
      ...u32(body.length).reverse(),
      ...body,
    ]);
    const meta = await readMeta(file, "webp");
    expect(summarize(meta).names).toEqual(["Xmp Person"]);
    expect(await readMeta(stripWebp(file), "webp")).toBeUndefined();
  });
});
