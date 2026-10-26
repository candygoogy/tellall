// HEIC pieces for the tests: boxes, items, an Exif TIFF and an XMP packet,
// all made up.
export const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
export const u32 = (n: number) => [
  (n >>> 24) & 0xff,
  (n >> 16) & 0xff,
  (n >> 8) & 0xff,
  n & 0xff,
];
export const bytes = (s: string) => [...s].map((c) => c.charCodeAt(0) & 0xff);
export const box = (type: string, ...body: (number[] | Uint8Array)[]) => {
  const flat = body.flatMap((b) => [...b]);
  return [...u32(8 + flat.length), ...bytes(type), ...flat];
};
export const full = (type: string, version: number, ...body: number[][]) =>
  box(type, [version, 0, 0, 0], ...body);
export const FTYP = box("ftyp", bytes("heic"), u32(0), bytes("mif1heic"));

export interface Spec {
  id: number;
  type: "hvc1" | "Exif" | "xmp";
  payload?: number[];
  /** iloc's construction method. */
  method?: number;
  /** For a helper picture, its type (an auxC property). */
  aux?: string;
}

/** A HEIC with these items (their payloads in mdat), references and
 * helper types; its main picture is item 1. */
export function heic(items: Spec[], refs: number[][] = []): Uint8Array {
  const infe = (x: Spec) =>
    x.type === "xmp"
      ? full(
          "infe",
          2,
          u16(x.id),
          u16(0),
          bytes("mime"),
          [0],
          bytes("application/rdf+xml"),
          [0],
        )
      : full("infe", 2, u16(x.id), u16(0), bytes(x.type), [0]);
  const iinf = full("iinf", 0, u16(items.length), ...items.map(infe));
  const iref = refs.length ? full("iref", 0, ...refs) : [];
  const stored = items.filter((x) => x.payload);
  const iloc = (mdat: number) => {
    let at = mdat + 8;
    const entries = stored.map((x) => {
      const entry = [
        ...u16(x.id),
        ...u16(x.method ?? 0),
        ...u16(0),
        ...u16(1),
        ...u32(at),
        ...u32(x.payload?.length ?? 0),
      ];
      at += x.payload?.length ?? 0;
      return entry;
    });
    return full("iloc", 1, [0x44, 0x00], u16(stored.length), ...entries);
  };
  const pitm = items.some((x) => x.id === 1) ? full("pitm", 0, u16(1)) : [];
  // Each helper's auxC, and which helper has which.
  const helpers = items.filter((x) => x.aux !== undefined);
  const iprp = helpers.length
    ? box(
        "iprp",
        box(
          "ipco",
          ...helpers.map((x) => full("auxC", 0, bytes(`${x.aux}\0`))),
        ),
        full(
          "ipma",
          0,
          u32(helpers.length),
          ...helpers.map((x, i) => [...u16(x.id), 1, 0x81 + i]),
        ),
      )
    : [];
  const size =
    FTYP.length + full("meta", 0, pitm, iinf, iloc(0), iref, iprp).length;
  const meta = full("meta", 0, pitm, iinf, iloc(size), iref, iprp);
  const mdat = box("mdat", ...stored.map((x) => x.payload ?? []));
  return new Uint8Array([...FTYP, ...meta, ...mdat]);
}

/** A big-endian TIFF with these ASCII tags, after Exif's 4-byte offset. */
export function exifPayload(tags: [number, string][]): number[] {
  const ifd = 8;
  const count = tags.length;
  let data = ifd + 2 + count * 12 + 4;
  const entries: number[] = [];
  const values: number[] = [];
  for (const [tag, text] of tags) {
    const value = [...bytes(text), 0];
    entries.push(...u16(tag), ...u16(2), ...u32(value.length), ...u32(data));
    values.push(...value);
    data += value.length;
  }
  const tiff = [
    ...bytes("MM"),
    0,
    0x2a,
    ...u32(ifd),
    ...u16(count),
    ...entries,
    ...u32(0),
    ...values,
  ];
  return [...u32(0), ...tiff];
}

export const ARTIST = 0x013b;
export const DESCRIPTION = 0x010e;
/** A made-up value no clean copy may keep. */
export const MARKER = "GPS-MARKER-51.48N-0.00W";

export const xmpPacket = (creator: string, padding = 0) =>
  bytes(
    `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"><photoshop:Instructions>${"x".repeat(padding)}</photoshop:Instructions><dc:creator><rdf:Seq><rdf:li>${creator}</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>`,
  );

export const GAIN_MAP = "urn:com:apple:photo:2020:aux:hdrgainmap";
// Item 1 is the photo, item 2 a helper picture (a gain map) for it.
export const HELPER = box("auxl", u16(2), u16(1), u16(1));
export const PICTURES: Spec[] = [
  { id: 1, type: "hvc1", payload: [0x77, 0x77, 0x77, 0x77] },
  { id: 2, type: "hvc1", payload: [0x66, 0x66, 0x66, 0x66], aux: GAIN_MAP },
];
