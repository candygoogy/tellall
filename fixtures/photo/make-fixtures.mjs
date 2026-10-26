// Makes the synthetic test photos in test/fixtures/: small generated
// gradients carrying made-up metadata (no real photo, place or person),
// and the page's example photo, src/example.jpg.
//   node photo/test/make-fixtures.mjs
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import sharp from "sharp";

const OUT = join(import.meta.dirname, "fixtures");
const W = 160;
const H = 120;

// A soft two-way gradient, so pixel comparisons have something to compare.
const pixels = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    pixels[i] = Math.round((x / W) * 255);
    pixels[i + 1] = Math.round((y / H) * 255);
    pixels[i + 2] = 160;
  }
}
const image = () =>
  sharp(pixels, { raw: { width: W, height: H, channels: 3 } });

// The Royal Observatory, Greenwich, on the prime meridian: 51.4769° N,
// 0.0005° W, in degrees, minutes, seconds.
const GPS = {
  GPSLatitudeRef: "N",
  GPSLatitude: "51/1 28/1 3684/100",
  GPSLongitudeRef: "W",
  GPSLongitude: "0/1 0/1 180/100",
};
const EXIF = {
  IFD0: {
    Make: "Example",
    Model: "Cam 1",
    Artist: "Test Person",
    Software: "Example Editor 2",
  },
  IFD2: { DateTimeOriginal: "2026:10:01 12:00:00", LensModel: "Example 35mm" },
  IFD3: GPS,
};
const XMP = (body) =>
  `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:exif="http://ns.adobe.com/exif/1.0/">${body}</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
const XMP_CREATOR = XMP(
  `<dc:creator><rdf:Seq><rdf:li>Test Person</rdf:li></rdf:Seq></dc:creator>`,
);

// --- JPEG segments added by hand: Photoshop IPTC (APP13) and a comment.

const segment = (marker, payload) => {
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xff00 | marker, 0);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
};

const iptc = () => {
  // IPTC record 2, dataset 80 (By-line): the photographer's name.
  const name = Buffer.from("Test Person");
  const dataset = Buffer.concat([
    Buffer.from([0x1c, 0x02, 0x50, 0x00, name.length]),
    name,
  ]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(dataset.length);
  const block = Buffer.concat([
    Buffer.from("8BIM"),
    Buffer.from([0x04, 0x04, 0x00, 0x00]),
    size,
    dataset,
    dataset.length % 2 ? Buffer.from([0]) : Buffer.alloc(0),
  ]);
  return segment(0xed, Buffer.concat([Buffer.from("Photoshop 3.0\0"), block]));
};

/** Inserts segments after the last APPn segment at the start. */
const insertJpeg = (jpeg, extra) => {
  let at = 2;
  while (jpeg[at] === 0xff && jpeg[at + 1] >= 0xe0 && jpeg[at + 1] <= 0xef) {
    at += 2 + jpeg.readUInt16BE(at + 2);
  }
  return Buffer.concat([jpeg.subarray(0, at), ...extra, jpeg.subarray(at)]);
};

// --- PNG chunks added by hand.

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/** Inserts chunks right after IHDR. */
const insertPng = (png, extra) => {
  const at = 8 + 12 + png.readUInt32BE(8);
  return Buffer.concat([png.subarray(0, at), ...extra, png.subarray(at)]);
};

const files = {};

files["gps.jpg"] = insertJpeg(
  await image()
    .jpeg({ quality: 85 })
    .withIccProfile("srgb")
    .withExif(EXIF)
    .withXmp(XMP_CREATOR)
    .toBuffer(),
  [iptc(), segment(0xfe, Buffer.from("Made for a test"))],
);

files["rotated.jpg"] = await image()
  .jpeg({ quality: 85 })
  .withMetadata({ orientation: 6 })
  .withExif({ IFD0: { Make: "Example", Model: "Cam 1" } })
  .toBuffer();

files["clean.jpg"] = await image().jpeg({ quality: 85 }).toBuffer();

files["xmp-gps.jpg"] = await image()
  .jpeg({ quality: 85 })
  .withXmp(
    XMP(
      `<exif:GPSLatitude>51,28.614N</exif:GPSLatitude><exif:GPSLongitude>0,0.03W</exif:GPSLongitude>`,
    ),
  )
  .toBuffer();

const tIME = Buffer.from([0x07, 0xea, 10, 1, 12, 0, 0]); // 2026-10-01 12:00:00
files["meta.png"] = insertPng(await image().png().withExif(EXIF).toBuffer(), [
  chunk("tEXt", Buffer.from("Author\0Test Person", "latin1")),
  chunk("tIME", tIME),
  chunk(
    "iTXt",
    Buffer.concat([
      Buffer.from("XML:com.adobe.xmp\0\0\0\0\0", "latin1"),
      Buffer.from(XMP_CREATOR),
    ]),
  ),
]);

files["meta.webp"] = await image()
  .webp({ quality: 85 })
  .withExif(EXIF)
  .withXmp(XMP_CREATOR)
  .toBuffer();

// HEIC: browsers can't write it and this toolchain has no HEVC encoder,
// so this is a HEIF container (an AV1 picture inside) labelled as HEIC.
// It's enough for what the page does with HEIC: recognise it and explain.
const heif = Buffer.from(
  await image()
    .heif({ compression: "av1", quality: 50 })
    .withExif({ IFD0: { Make: "Example", Model: "Cam 1" } })
    .toBuffer(),
);
const ftyp = heif.readUInt32BE(0);
for (let o = 8; o < ftyp; o += 4) {
  if (heif.toString("latin1", o, o + 4) === "avif")
    heif.write("heic", o, "latin1");
}
files["sample.heic"] = heif;

// --- HEIC laid out the way an iPhone writes it: a long ftyp (more brands
// than older readers expect), a grid of tiles as the main picture, an HDR
// gain map with its own XMP, a thumbnail, a tone map and a styles item,
// Exif describing the picture and the tone map, the grid's description in
// idat, and every other payload in mdat. The tiles are filler bytes, not a
// picture: this file is for finding and blanking metadata, not decoding.
// One addition to what the phone writes: an XMP packet about the main
// picture, so blanking XMP is covered too.

const u8 = (n) => Buffer.from([n]);
const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const box = (type, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([u32(8 + body.length), Buffer.from(type), body]);
};
const full = (type, version, flags, ...parts) =>
  box(type, u8(version), u8(flags >> 16), u16(flags & 0xffff), ...parts);

/** The TIFF block sharp writes for EXIF, without JPEG's "Exif\0\0". */
const tiffOf = async (exif) => {
  const jpeg = await image().jpeg().withExif(exif).toBuffer();
  for (let at = 2; at < jpeg.length;) {
    const length = jpeg.readUInt16BE(at + 2);
    if (
      jpeg[at + 1] === 0xe1 &&
      jpeg.toString("latin1", at + 4, at + 10) === "Exif\0\0"
    ) {
      return jpeg.subarray(at + 10, at + 2 + length);
    }
    at += 2 + length;
  }
  throw new Error("no Exif");
};

const filler = (n, seed) =>
  Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + seed * 17) & 0xff));

async function iphoneHeic() {
  const TILES = [1, 2, 3, 4];
  const GRID = 5;
  const GAIN = 6;
  const GAIN_XMP = 7;
  const THUMB = 8;
  const TMAP = 9;
  const STYLES = 10;
  const EXIF_ID = 11;
  const XMP_ID = 12;

  const infe = (id, type, extra = Buffer.alloc(0)) =>
    full(
      "infe",
      2,
      0,
      u16(id),
      u16(0),
      Buffer.from(type),
      Buffer.from("\0"),
      extra,
    );
  const items = [
    ...TILES.map((id) => infe(id, "hvc1")),
    infe(GRID, "grid"),
    infe(GAIN, "hvc1"),
    infe(GAIN_XMP, "mime", Buffer.from("application/rdf+xml\0")),
    infe(THUMB, "hvc1"),
    infe(TMAP, "tmap"),
    infe(
      STYLES,
      "uri ",
      Buffer.from("tag:example.com,2026:photo:metadata:styles\0"),
    ),
    infe(EXIF_ID, "Exif"),
    infe(XMP_ID, "mime", Buffer.from("application/rdf+xml\0")),
  ];
  const ref = (type, from, to) =>
    box(type, u16(from), u16(to.length), ...to.map(u16));
  const iref = full(
    "iref",
    0,
    0,
    ref("dimg", GRID, TILES),
    ref("auxl", GAIN, [GRID]),
    ref("cdsc", GAIN_XMP, [GAIN]),
    ref("thmb", THUMB, [GRID]),
    ref("dimg", TMAP, [GRID, GAIN]),
    ref("cdsc", STYLES, [GRID, TMAP]),
    ref("cdsc", EXIF_ID, [GRID, TMAP]),
    ref("cdsc", XMP_ID, [GRID]),
  );
  const ispe = (w, h) => full("ispe", 0, 0, u32(w), u32(h));
  const ipco = box(
    "ipco",
    box("colr", Buffer.from("nclx"), u16(1), u16(13), u16(1), u8(0x80)),
    ispe(32, 32), // a tile
    ispe(64, 64), // the grid
    box("irot", u8(3)),
    full("pixi", 0, 0, u8(3), u8(8), u8(8), u8(8)),
    box("hvcC", filler(23, 1)),
    full(
      "auxC",
      0,
      0,
      Buffer.from("urn:com:apple:photo:2020:aux:hdrgainmap\0"),
    ),
  );
  // Properties by index (from 1): colr 1, tile size 2, grid size 3, irot 4,
  // pixi 5, hvcC 6, auxC 7.
  const assoc = (id, ...props) =>
    Buffer.concat([u16(id), u8(props.length), ...props.map(u8)]);
  const ipma = full(
    "ipma",
    0,
    0,
    u32(TILES.length + 4),
    ...TILES.map((id) => assoc(id, 0x86, 2)),
    assoc(GRID, 1, 3, 0x84, 5),
    assoc(GAIN, 0x86, 2, 0x87),
    assoc(THUMB, 0x86, 2),
    assoc(TMAP, 3),
  );

  // The grid (2 × 2 tiles, 64 × 64) and the tone map live in idat.
  const grid = Buffer.concat([u8(0), u8(0), u8(1), u8(1), u16(64), u16(64)]);
  const tmap = filler(62, 2);
  const idat = box("idat", grid, tmap);

  // The gain map's XMP, laid out the way the phone writes it.
  const gainXmp = Buffer.from(
    [
      `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core 6.0.0">`,
      `   <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">`,
      `      <rdf:Description rdf:about=""`,
      `            xmlns:HDRGainMap="http://ns.apple.com/HDRGainMap/1.0/">`,
      `         <HDRGainMap:HDRGainMapVersion>131072</HDRGainMap:HDRGainMapVersion>`,
      `         <HDRGainMap:HDRGainMapHeadroom>2.852</HDRGainMap:HDRGainMapHeadroom>`,
      `      </rdf:Description>`,
      `   </rdf:RDF>`,
      `</x:xmpmeta>`,
      ``,
    ].join("\n"),
  );
  const exif = Buffer.concat([
    u32(6),
    Buffer.from("Exif\0\0"),
    await tiffOf(EXIF),
  ]);
  // In mdat, in this order.
  const payloads = [
    ...TILES.map((id) => [id, filler(96, id)]),
    [GAIN, filler(64, 6)],
    [THUMB, filler(48, 8)],
    [GAIN_XMP, gainXmp],
    [STYLES, filler(120, 10)],
    [EXIF_ID, exif],
    [XMP_ID, Buffer.from(XMP_CREATOR)],
  ];

  const ftyp = box(
    "ftyp",
    Buffer.from("heic"),
    u32(0),
    Buffer.from("mif1MiHBMiHAheixMiHEMiPrheicmiaftmap"),
  );
  // iloc version 1: 4-byte offsets and lengths, no base offset.
  const iloc = (mdatStart) => {
    const entries = [];
    let at = mdatStart + 8;
    for (const [id, bytes] of payloads) {
      entries.push(
        Buffer.concat([
          u16(id),
          u16(0),
          u16(0),
          u16(1),
          u32(at),
          u32(bytes.length),
        ]),
      );
      at += bytes.length;
    }
    entries.push(
      Buffer.concat([
        u16(GRID),
        u16(1),
        u16(0),
        u16(1),
        u32(0),
        u32(grid.length),
      ]),
    );
    entries.push(
      Buffer.concat([
        u16(TMAP),
        u16(1),
        u16(0),
        u16(1),
        u32(grid.length),
        u32(tmap.length),
      ]),
    );
    return full(
      "iloc",
      1,
      0,
      u8(0x44),
      u8(0x00),
      u16(entries.length),
      ...entries,
    );
  };
  const meta = (mdatStart) =>
    full(
      "meta",
      0,
      0,
      full(
        "hdlr",
        0,
        0,
        u32(0),
        Buffer.from("pict"),
        Buffer.alloc(12),
        Buffer.from("\0"),
      ),
      box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1))),
      full("pitm", 0, 0, u16(GRID)),
      full("iinf", 0, 0, u16(items.length), ...items),
      iref,
      box("iprp", ipco, ipma),
      box("grpl", full("altr", 0, 0, u32(13), u32(2), u32(GRID), u32(TMAP))),
      idat,
      iloc(mdatStart),
    );
  // The meta box's size doesn't depend on the offsets, so measure it first.
  const mdatStart = ftyp.length + meta(0).length;
  const mdat = box("mdat", ...payloads.map(([, bytes]) => bytes));
  return Buffer.concat([ftyp, meta(mdatStart), mdat]);
}

files["iphone.heic"] = await iphoneHeic();

// --- The page's example (not a test photo): a drawn dusk landscape, the
// metadata a phone would write, and a stand-in for the owner's name.

const DUSK = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5d7290"/><stop offset="0.55" stop-color="#c9a48f"/><stop offset="1" stop-color="#f0c79a"/></linearGradient>
<radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff4dc"/><stop offset="0.45" stop-color="#ffe2b0" stop-opacity="0.9"/><stop offset="1" stop-color="#ffd6a0" stop-opacity="0"/></radialGradient>
<linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9b393"/><stop offset="1" stop-color="#4f5f78"/></linearGradient>
</defs>
<rect width="480" height="360" fill="url(#sky)"/>
<circle cx="318" cy="196" r="70" fill="url(#sun)"/>
<circle cx="318" cy="196" r="17" fill="#fff6e6"/>
<path d="M0 214 C60 180 110 170 170 190 S280 176 340 196 S430 186 480 200 L480 260 L0 260Z" fill="#8a7f8c" opacity="0.75"/>
<path d="M0 232 C50 206 120 200 190 218 S300 214 360 226 S440 220 480 228 L480 260 L0 260Z" fill="#5e5a6e"/>
<rect y="248" width="480" height="112" fill="url(#water)"/>
<rect x="296" y="252" width="44" height="3" fill="#fff1d6" opacity="0.8"/>
<rect x="304" y="262" width="28" height="2" fill="#fff1d6" opacity="0.6"/>
<rect x="310" y="272" width="16" height="2" fill="#fff1d6" opacity="0.45"/>
<path d="M0 300 C80 284 150 296 230 306 S380 300 480 318 L480 360 L0 360Z" fill="#2f3446"/>
</svg>`;

const example = await sharp(Buffer.from(DUSK))
  .jpeg({ quality: 80, mozjpeg: true })
  .withExif({
    IFD0: { Make: "Example", Model: "Phone 1", Artist: "Your Name" },
    IFD2: { DateTimeOriginal: "2026:10:01 18:42:00" },
    IFD3: GPS,
  })
  .toBuffer();
await writeFile(join(import.meta.dirname, "..", "src", "example.jpg"), example);
console.log(`../src/example.jpg ${example.length} B`);

// A JPEG whose Exif segment claims more bytes than the file has.
files["damaged.jpg"] = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00]),
  Buffer.from("Exif\0\0MM\0\x2a\0\0\0\x08\xff\xff", "latin1"),
]);

files["note.txt"] = Buffer.from("Not a photo.\n");

for (const [name, bytes] of Object.entries(files)) {
  await writeFile(join(OUT, name), bytes);
  console.log(`${name} ${bytes.length} B`);
}
