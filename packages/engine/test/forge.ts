// Metadata made up for the tests and put where phones, cameras and editors
// put it, and where they shouldn't: Exif with a place, a maker note, a
// comment and serial numbers; XMP; IPTC; and blocks no known writer uses.
// Every value that mustn't survive a clean copy contains LEAK, so a test
// can look for that one word.
import { deflateSync } from "node:zlib";
import { crc32 } from "../src/image/crc32.ts";

export const LEAK = "LEAK";
export const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0) & 0xff);
const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number) => [
  (n >>> 24) & 0xff,
  (n >> 16) & 0xff,
  (n >> 8) & 0xff,
  n & 0xff,
];
const le32 = (n: number) => u32(n).reverse();

/** A latin-1 view of bytes, for looking for text in them. */
export const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");
/** Whether any LEAK is left, as bytes or as UTF-16 (Windows' XP tags). */
export const leaks = (b: Uint8Array) =>
  text(b).includes(LEAK) || Buffer.from(b).toString("utf16le").includes(LEAK);

interface Entry {
  tag: number;
  type: number; // 1 BYTE, 2 ASCII, 3 SHORT, 4 LONG, 5 RATIONAL, 7 UNDEFINED
  count: number;
  data: number[];
}
const asciiEntry = (tag: number, s: string): Entry => ({
  tag,
  type: 2,
  count: s.length + 1,
  data: [...ascii(s), 0],
});
const rationals = (tag: number, values: number[]): Entry => ({
  tag,
  type: 5,
  count: values.length,
  data: values.flatMap((v) => [...u32(Math.round(v * 100)), ...u32(100)]),
});
const bytesEntry = (tag: number, type: number, data: number[]): Entry => ({
  tag,
  type,
  count: data.length,
  data,
});

/** A big-endian TIFF with IFD0, an Exif IFD and a GPS IFD. */
function tiff(ifd0: Entry[], exif: Entry[], gps: Entry[]): number[] {
  // Laid out: header, IFD0, Exif IFD, GPS IFD, then every value too big
  // to sit in its entry.
  const size = (n: number) => 2 + n * 12 + 4;
  const ifd0Entries = [
    ...ifd0,
    { tag: 0x8769, type: 4, count: 1, data: [] as number[] },
    { tag: 0x8825, type: 4, count: 1, data: [] as number[] },
  ].sort((a, b) => a.tag - b.tag);
  const at0 = 8;
  const atExif = at0 + size(ifd0Entries.length);
  const atGps = atExif + size(exif.length);
  let atData = atGps + size(gps.length);
  const values: number[] = [];
  const write = (entries: Entry[]) => {
    const out = [...u16(entries.length)];
    for (const e of entries) {
      let data = e.data;
      if (e.tag === 0x8769) data = u32(atExif);
      if (e.tag === 0x8825) data = u32(atGps);
      out.push(...u16(e.tag), ...u16(e.type), ...u32(e.count));
      if (data.length <= 4) {
        out.push(...data, ...new Array<number>(4 - data.length).fill(0));
      } else {
        out.push(...u32(atData));
        values.push(...data, ...(data.length % 2 ? [0] : []));
        atData += data.length + (data.length % 2);
      }
    }
    out.push(...u32(0));
    return out;
  };
  const blocks = [write(ifd0Entries), write(exif), write(gps)];
  return [...ascii("MM"), 0, 42, ...u32(at0), ...blocks.flat(), ...values];
}

/** Exif as a phone writes it, and more: the place, the camera and its
 * serial numbers, the owner, a maker note, a comment, Windows' author. */
export function exifTiff(): number[] {
  const xpAuthor = [...Buffer.from("LEAK-XPAUTHOR\0", "utf16le")];
  return tiff(
    [
      asciiEntry(0x010f, "LEAK-MAKE"),
      asciiEntry(0x0110, "LEAK-MODEL"),
      asciiEntry(0x0131, "LEAK-SOFTWARE 1"),
      asciiEntry(0x013b, "LEAK-ARTIST"),
      asciiEntry(0x010e, "LEAK-DESCRIPTION"),
      bytesEntry(0x9c9d, 1, xpAuthor),
    ],
    [
      asciiEntry(0x9003, "2026:10:01 12:00:00"),
      bytesEntry(0x927c, 7, ascii("LEAK-MAKERNOTE with its own GPS")),
      bytesEntry(0x9286, 7, [...ascii("ASCII\0\0\0"), ...ascii("LEAK-USER")]),
      asciiEntry(0xa430, "LEAK-OWNER"),
      asciiEntry(0xa431, "LEAK-SERIAL"),
      asciiEntry(0xa435, "LEAK-LENSSERIAL"),
    ].sort((a, b) => a.tag - b.tag),
    [
      asciiEntry(0x0001, "N"),
      rationals(0x0002, [51, 28, 36.84]),
      asciiEntry(0x0003, "W"),
      rationals(0x0004, [0, 0, 1.8]),
    ],
  );
}

/** XMP with a place, contact details, rights and a creator. */
export const xmp = (extra = "") =>
  ascii(
    `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/" photoshop:City="LEAK-XMPCITY" photoshop:Country="LEAK-XMPCOUNTRY"><dc:creator><rdf:Seq><rdf:li>LEAK-CREATOR</rdf:li></rdf:Seq></dc:creator><dc:rights><rdf:Alt><rdf:li xml:lang="x-default">LEAK-RIGHTS</rdf:li></rdf:Alt></dc:rights><Iptc4xmpCore:CreatorContactInfo rdf:parseType="Resource"><Iptc4xmpCore:CiEmailWork>leak@example.com</Iptc4xmpCore:CiEmailWork></Iptc4xmpCore:CreatorContactInfo>${extra}</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`,
  );

/** IPTC (IIM) with a by-line and a place. */
export function iim(): number[] {
  const set = (dataset: number, value: string) => [
    0x1c,
    2,
    dataset,
    ...u16(value.length),
    ...ascii(value),
  ];
  return [
    ...set(80, "LEAK-BYLINE"),
    ...set(90, "LEAK-CITY"),
    ...set(92, "LEAK-SUBLOCATION"),
    ...set(101, "LEAK-COUNTRY"),
  ];
}

/** Photoshop's resources holding that IPTC: an APP13's content. */
export function photoshop(): number[] {
  const data = iim();
  return [
    ...ascii("Photoshop 3.0\0"),
    ...ascii("8BIM"),
    0x04,
    0x04,
    0,
    0,
    ...u32(data.length),
    ...data,
    ...(data.length % 2 ? [0] : []),
  ];
}

/** A JPEG marker segment. */
export const segment = (marker: number, payload: number[]) => [
  0xff,
  marker,
  ...u16(payload.length + 2),
  ...payload,
];

/** A PNG chunk, with its checksum. */
export function pngChunk(type: string, data: number[] | Uint8Array): number[] {
  const body = new Uint8Array([...ascii(type), ...data]);
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}

/** ImageMagick's way of keeping Exif in PNG text: hex, compressed. */
export function rawProfile(name: string, bytes: number[]): number[] {
  const hex = Buffer.from(bytes)
    .toString("hex")
    .replace(/.{1,72}/g, "$&\n");
  const value = `\n${name}\n${String(bytes.length).padStart(8)}\n${hex}`;
  return [
    ...ascii(`Raw profile type ${name}\0`),
    0,
    ...deflateSync(Buffer.from(value, "latin1")),
  ];
}

/** A compressed iTXt chunk's content. */
export const compressedItxt = (keyword: string, value: number[]) => [
  ...ascii(`${keyword}\0`),
  1,
  0,
  0,
  0,
  ...deflateSync(Buffer.from(value)),
];

/** A WebP chunk, padded. */
export function webpChunk(type: string, data: number[] | Uint8Array): number[] {
  const out = [...ascii(type), ...le32(data.length), ...data];
  return data.length % 2 ? [...out, 0] : out;
}

/** A RIFF WebP around these chunks, its size counting only them. */
export const riff = (chunks: number[]) => [
  ...ascii("RIFF"),
  ...le32(chunks.length + 4),
  ...ascii("WEBP"),
  ...chunks,
];

export { u16, u32 };
