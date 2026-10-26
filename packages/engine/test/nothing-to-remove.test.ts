// Whether a file has anything to remove comes from its structure, not from
// which fields the report recognised: a clean copy that would differ from
// the file means there is, and the report says so, by name where it can
// and with a catch-all where it can't. A file whose only extra is what a
// clean copy keeps (the label, the AI-source tag) comes back byte for byte.
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { clean, inspect, words as en } from "../src/index.ts";
import { chunks as pngChunks } from "../src/image/strip/png.ts";
import { heic, exifPayload, ARTIST, bytes } from "./craft.ts";
import { ascii, leaks, pngChunk, segment } from "./forge.ts";

const ROOT = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) =>
  new Uint8Array(readFileSync(new URL(path, ROOT)));
const file = (bytes: Uint8Array) =>
  ({ kind: "file", name: "x", bytes }) as const;
const same = (a: Uint8Array, b: Uint8Array) =>
  Buffer.from(a).equals(Buffer.from(b));

const AI =
  "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";
const XMP_HEAD = "http://ns.adobe.com/xap/1.0/\0";
const RDF = (namespaces: string, body: string, attributes = "") =>
  `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" ${namespaces}${attributes}>${body}</rdf:Description></rdf:RDF></x:xmpmeta>`;

/** clean.jpg with these segments right after its SOI. */
const jpegWith = (...parts: number[][]) => {
  const base = fixture("photo/clean.jpg");
  return new Uint8Array([
    ...base.subarray(0, 2),
    ...parts.flat(),
    ...base.subarray(2),
  ]);
};
const xmpSegment = (packet: string) =>
  segment(0xe1, [...ascii(XMP_HEAD), ...Buffer.from(packet, "utf8")]);

/** A PNG with a chunk put right after its header. */
function pngWith(b: Uint8Array, chunk: number[]): Uint8Array {
  const ihdr = pngChunks(b).list[0];
  if (!ihdr) throw new Error("no IHDR");
  return new Uint8Array([
    ...b.subarray(0, ihdr.end),
    ...chunk,
    ...b.subarray(ihdr.end),
  ]);
}

describe("XMP and Exif fields the lists used to miss are named and removed", () => {
  const IPTC_EXT = `xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"`;
  test.each([
    [
      "a person in the image",
      RDF(
        IPTC_EXT,
        `<Iptc4xmpExt:PersonInImage><rdf:Bag><rdf:li>LEAK Jane Doe</rdf:li></rdf:Bag></Iptc4xmpExt:PersonInImage>`,
      ),
      "It names a person: LEAK Jane Doe.",
    ],
    [
      "a face region's name",
      RDF(
        `xmlns:mwg-rs="http://www.metadataworkinggroup.com/schemas/regions/"`,
        `<mwg-rs:Regions rdf:parseType="Resource"><mwg-rs:RegionList><rdf:Bag><rdf:li rdf:parseType="Resource"><mwg-rs:Name>LEAK John Smith</mwg-rs:Name><mwg-rs:Type>Face</mwg-rs:Type></rdf:li></rdf:Bag></mwg-rs:RegionList></mwg-rs:Regions>`,
      ),
      "It names a person: LEAK John Smith.",
    ],
    [
      "the caption's writer",
      RDF(
        `xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"`,
        "",
        ` photoshop:CaptionWriter="LEAK Writer"`,
      ),
      "LEAK Writer",
    ],
    [
      "a label",
      RDF(
        `xmlns:xmp="http://ns.adobe.com/xap/1.0/"`,
        "",
        ` xmp:Label="LEAK Holiday"`,
      ),
      "LEAK Holiday",
    ],
    [
      "the rights' owner",
      RDF(
        `xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"`,
        `<xmpRights:Owner><rdf:Bag><rdf:li>LEAK Owner</rdf:li></rdf:Bag></xmpRights:Owner>`,
      ),
      "LEAK Owner",
    ],
    [
      "the image's creator (PLUS)",
      RDF(
        `xmlns:plus="http://ns.useplus.org/ldf/xmp/1.0/"`,
        `<plus:ImageCreator><rdf:Seq><rdf:li rdf:parseType="Resource"><plus:ImageCreatorName>LEAK Creator</plus:ImageCreatorName></rdf:li></rdf:Seq></plus:ImageCreator>`,
      ),
      "LEAK Creator",
    ],
    [
      "instructions",
      RDF(
        `xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"`,
        "",
        ` photoshop:Instructions="LEAK call me"`,
      ),
      "LEAK call me",
    ],
    [
      "hierarchical keywords",
      RDF(
        `xmlns:lr="http://ns.adobe.com/lightroom/1.0/"`,
        `<lr:hierarchicalSubject><rdf:Bag><rdf:li>People|LEAK Jane</rdf:li></rdf:Bag></lr:hierarchicalSubject>`,
      ),
      "People|LEAK Jane",
    ],
  ])("%s", async (_, packet, said) => {
    const b = jpegWith(xmpSegment(packet));
    const report = await inspect(file(b));
    expect(report.headline).toBe(en.headline.personal(1));
    expect(report.findings.map((f) => f.sentence).join(" ")).toContain(said);
    const copy = await clean(file(b));
    expect(copy.notes).not.toContain(en.clean.nothing);
    expect(leaks(copy.output as Uint8Array)).toBe(false);
  });

  test("Exif's document and page names", async () => {
    // IFD0 with one ASCII entry.
    const exif = (tag: number, text: string) => {
      const v = [...ascii(text), 0];
      return segment(0xe1, [
        ...ascii("Exif\0\0MM\0*"),
        ...[0, 0, 0, 8, 0, 1],
        ...[tag >> 8, tag & 0xff, 0, 2],
        ...[0, 0, 0, v.length, 0, 0, 0, 26, 0, 0, 0, 0],
        ...v,
      ]);
    };
    for (const [tag, text] of [
      [0x010d, "LEAK C:/Users/jane/holiday.jpg"],
      [0x011d, "LEAK Jane's phone"],
    ] as const) {
      const report = await inspect(file(jpegWith(exif(tag, text))));
      expect(report.findings.map((f) => f.sentence).join(" ")).toContain(text);
    }
  });
});

describe("what tellall doesn't name still counts", () => {
  test("an unknown JPEG segment: a catch-all finding, and the copy drops it", async () => {
    const b = jpegWith(segment(0xe4, ascii("LEAK private notes")));
    const report = await inspect(file(b));
    // Not counted as personal data: its own headline.
    expect(report.headline).toBe(en.headline.notNamed);
    expect(report.empty).toBe(false);
    const [finding] = report.findings;
    expect(finding?.sentence).toBe(en.otherText.notNamed);
    expect(finding?.cleanedBy).toBe("clean");
    expect(finding?.fields).toContainEqual(
      expect.objectContaining({ name: "APP4", from: "File structure" }),
    );
    const copy = await clean(file(b));
    expect(copy.notes).toEqual([]);
    expect(copy.removed).toEqual(["other-text"]);
    expect(leaks(copy.output as Uint8Array)).toBe(false);
  });

  test("an unknown PNG chunk, and text after the end", async () => {
    const base = fixture("ai/paint-drawing.png");
    for (const b of [
      pngWith(base, pngChunk("prVt", ascii("LEAK"))),
      new Uint8Array([
        ...base,
        ...pngChunk("tEXt", ascii("Comment\0LEAK GPS")),
      ]),
    ]) {
      const report = await inspect(file(b));
      expect(report.empty).toBe(false);
      expect(report.findings.map((f) => f.sentence)).toEqual([
        en.otherText.notNamed,
      ]);
      const copy = await clean(file(b));
      expect(copy.notes).not.toContain(en.clean.nothing);
      expect(leaks(copy.output as Uint8Array)).toBe(false);
    }
  });

  test("a picture after a JPEG's end: its details are read", async () => {
    const b = new Uint8Array([
      ...fixture("photo/clean.jpg"),
      ...fixture("photo/gps.jpg"),
    ]);
    const report = await inspect(file(b));
    expect(report.findings.map((f) => f.group)).toContain("location");
    const copy = await clean(file(b));
    expect(copy.removed).toContain("location");
    expect((await inspect(file(copy.output as Uint8Array))).empty).toBe(true);
  });
});

describe("technical Exif and the catch-all", () => {
  // IFD0 with the resolution only, as sharp writes it for an export.
  const resolution = async () =>
    new Uint8Array(
      await sharp(Buffer.alloc(32 * 32 * 3, 120), {
        raw: { width: 32, height: 32, channels: 3 },
      })
        .withExif({
          IFD0: {
            XResolution: "72/1",
            YResolution: "72/1",
            ResolutionUnit: "2",
          },
        })
        .jpeg()
        .toBuffer(),
    );

  test("resolution-only Exif: no marks, and the original comes back", async () => {
    const b = await resolution();
    expect(Buffer.from(b).includes("Exif")).toBe(true);
    const report = await inspect(file(b));
    expect(report.headline).toBe(en.headline.empty);
    expect(report.findings).toEqual([]);
    const copy = await clean(file(b));
    expect(copy.notes).toEqual([en.clean.nothing]);
    expect(same(copy.output as Uint8Array, b)).toBe(true);
  });

  test("an unknown block alone: its own headline, and a changed copy", async () => {
    const base = await resolution();
    const b = new Uint8Array([
      ...base.subarray(0, 2),
      ...segment(0xe4, ascii("LEAK")),
      ...base.subarray(2),
    ]);
    const report = await inspect(file(b));
    expect(report.headline).toBe(en.headline.notNamed);
    expect(report.findings.map((f) => f.sentence)).toEqual([
      en.otherText.notNamed,
    ]);
    const copy = await clean(file(b));
    expect(same(copy.output as Uint8Array, b)).toBe(false);
    expect(leaks(copy.output as Uint8Array)).toBe(false);
  });

  test("GPS and an unknown block: 1 kind, and the catch-all too", async () => {
    const gps = fixture("photo/xmp-gps.jpg");
    const b = new Uint8Array([
      ...gps.subarray(0, 2),
      ...segment(0xe4, ascii("LEAK")),
      ...gps.subarray(2),
    ]);
    const report = await inspect(file(b));
    expect(report.headline).toBe(en.headline.personal(1));
    expect(report.findings.map((f) => f.group)).toEqual([
      "location",
      "other-text",
    ]);
    expect(report.findings.at(-1)?.sentence).toBe(en.otherText.notNamed);
    expect(leaks((await clean(file(b))).output as Uint8Array)).toBe(false);
  });
});

describe("nothing to remove: the original, byte for byte", () => {
  const sourceOnly = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>${RDF(
    `xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"`,
    `<Iptc4xmpExt:DigitalSourceType>${AI}</Iptc4xmpExt:DigitalSourceType>`,
  ).replace(
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">`,
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core 6.0.0">`,
  )}${" ".repeat(64)}<?xpacket end="w"?>`;

  test("an AI image with a label and an XMP packet holding only the source type", async () => {
    const b = pngWith(
      fixture("ai/chatgpt-image.png"),
      pngChunk("iTXt", [
        ...ascii("XML:com.adobe.xmp\0\0\0\0\0"),
        ...ascii(sourceOnly),
      ]),
    );
    const report = await inspect(file(b));
    expect(report.findings.some((f) => f.kind === "private")).toBe(false);
    const copy = await clean(file(b));
    expect(copy.notes).toEqual([en.clean.nothing]);
    expect(same(copy.output as Uint8Array, b)).toBe(true);
  });

  test("a JPEG whose only metadata is that packet", async () => {
    const b = jpegWith(xmpSegment(sourceOnly));
    const copy = await clean(file(b));
    expect(copy.notes).toEqual([en.clean.nothing]);
    expect(same(copy.output as Uint8Array, b)).toBe(true);
    // A packet with anything more is the photo's own: rewritten.
    const more = jpegWith(
      xmpSegment(
        sourceOnly.replace(
          "</rdf:Description>",
          "<!-- LEAK --></rdf:Description>",
        ),
      ),
    );
    const cleaned = await clean(file(more));
    expect(same(cleaned.output as Uint8Array, more)).toBe(false);
    expect(leaks(cleaned.output as Uint8Array)).toBe(false);
  });
});

test("removed is read from the copy: a HEIC's kept XMP keeps its place", async () => {
  const packet = bytes(
    RDF(
      `xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"`,
      "",
      ` Iptc4xmpExt:DigitalSourceType="${AI}" exif:GPSLatitude="51,28.614N" exif:GPSLongitude="0,0.030W"`,
    ),
  );
  const b = heic([
    { id: 1, type: "hvc1", payload: [0x77, 0x77, 0x77, 0x77] },
    { id: 2, type: "Exif", payload: exifPayload([[ARTIST, "LEAK-ARTIST"]]) },
    { id: 3, type: "xmp", payload: packet },
  ]);
  const copy = await clean(file(b));
  expect(copy.removed).toEqual(["other-text"]);
  expect(
    (await inspect(file(copy.output as Uint8Array))).findings.map(
      (f) => f.group,
    ),
  ).toContain("location");
});

test("a damaged PNG cleaned: the note says the picture may be cut", async () => {
  const b = fixture("ai/paint-drawing.png");
  const idat = pngChunks(b).list.find((c) => c.type === "IDAT");
  if (!idat) throw new Error("no IDAT");
  const cut = b.slice(0, idat.end + 20);
  const copy = await clean(file(cut));
  expect(copy.cleaned).toBe(true);
  expect(copy.notes).toContain(en.clean.partial);
});
