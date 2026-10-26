// A clean HEIC keeps only what its picture needs (an allowlist), cleaned
// in place: every box and item keeps its size and place, so no offset in
// the file changes and the picture's bytes stay exactly as they were.
//
// Kept: the file type (ftyp), its known brands; in meta, the handler, the
// primary item, the item list, locations and references, the properties a
// picture is drawn with (codec setup, size, colour, turn, crop, alpha, HDR
// levels…), and the groups; the bytes of every item the picture is drawn
// from (heif.ts), and a gain map's XMP, written anew from its values
// (gain-map.ts).
//
// Everything else is blanked: in mdat and idat, every byte no picture
// uses (the Exif, the XMP, a styles or other item, a picture nothing
// leads to, anything hidden in between); any other box or property
// becomes an empty "free" box; whatever follows the last whole box is cut
// off. Inside the boxes kept, the words: the handler's name, item names
// and content types (spaces; XMP's says only that it's XMP), a data
// reference's location, the colour profile's words (icc.ts) and whatever
// follows a colour property's fields, a helper's type unless it's a known
// one, and the file type's unknown brands and trailing bytes. A JPEG the
// picture is drawn from is cleaned in place (jpeg.ts). A picture left out
// (a helper other than the gain map or an alpha map, such as a depth map
// or a matte, or a picture nothing leads to) keeps its entry, location
// and properties, so the file still adds up, but its bytes are blanked,
// its entry is marked hidden, and the references from it, or only to such
// pictures, become "free".
//
// Each Exif item keeps its offset (and "Exif\0\0", if the writer put it
// before the TIFF header) and then holds an empty TIFF, or one with only
// the turn when the photo is turned, so it still reads as Exif. Each XMP
// packet becomes spaces: nothing for a reader to find, and nothing that
// breaks one. A file whose details are stored inside another item, or
// that's a sequence (moov), isn't cleaned at all; nor is one that names no
// main picture, or names one item twice.
//
// An AI label (Content Credentials, C2PA) is a top-level uuid box with
// C2PA's user type. With labels kept it stays, byte for byte; removed, it
// becomes a "free" box of the same size, like any other box no picture
// needs. With labels kept and a DigitalSourceType given, an XMP item that
// holds it is kept whole (its entry's words still go).
import { ascii, startsWith } from "../../bytes.ts";
import {
  CantClean,
  exifTiff,
  find,
  heifLayout,
  itemBytes,
  type Box,
  type Item,
  type Reader,
} from "../heif.ts";
import { gainMapPacket } from "../gain-map.ts";
import { cleanIcc } from "../icc.ts";
import { cleanJpegInPlace, isTurned, orientationTiff } from "./jpeg.ts";
import { KEEP_LABELS, sourceType, type CleanOptions } from "./options.ts";

/** C2PA's uuid box user type, in hex. */
const C2PA_UUID = "d8fec3d61b0e483c92975828877ec481";

/** Whether a top-level box is an AI label: a uuid box with C2PA's type. */
function isLabel(b: Uint8Array, box: Box): boolean {
  if (box.type !== "uuid" || box.body + 16 > box.end) return false;
  let hex = "";
  for (const x of b.subarray(box.body, box.body + 16)) {
    hex += x.toString(16).padStart(2, "0");
  }
  return hex === C2PA_UUID;
}

// prettier-ignore
const EMPTY_TIFF = new Uint8Array([
  0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian, IFD0 at 8
  0x00, 0x00,                                     // no entries
  0x00, 0x00, 0x00, 0x00,                         // no next IFD
]);

// Boxes inside meta a picture needs.
const META_BOXES = new Set([
  "hdlr",
  "pitm",
  "iinf",
  "iloc",
  "iref",
  "iprp",
  "idat",
  "dinf",
  "grpl",
]);
// Properties a picture is drawn with.
const PROPERTIES = new Set([
  "hvcC",
  "lhvC",
  "av1C",
  "avcC",
  "vvcC",
  "jpgC",
  "j2kH",
  "uncC",
  "cmpd",
  "ispe",
  "colr",
  "pixi",
  "rloc",
  "irot",
  "imir",
  "clap",
  "auxC",
  "lsel",
  "a1op",
  "a1lx",
  "pasp",
  "clli",
  "mdcv",
  "cclv",
  "amve",
  "oinf",
  "tols",
  "iscl",
]);
// The brands HEIF, HEIC, AVIF and their relatives name themselves with.
const BRANDS = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "hevm",
  "hevs",
  "heif",
  "mif1",
  "mif2",
  "mif3",
  "msf1",
  "miaf",
  "MiHA",
  "MiHB",
  "MiHE",
  "MiPr",
  "MiAn",
  "MiCm",
  "MiCh",
  "tmap",
  "avif",
  "avis",
  "avio",
  "MA1A",
  "MA1B",
  "jpeg",
  "jpgs",
  "avci",
  "avcs",
  "vvic",
  "vvis",
  "j2ki",
  "j2is",
  "unif",
  "iso8",
  "isom",
  "mp41",
  "mp42",
]);
// The helper (auxiliary) picture types readers know: alpha, depth, and
// Apple's gain map and mattes. Another type is blanked.
const HELPER_TYPES = new Set([
  "urn:mpeg:hevc:2015:auxid:1",
  "urn:mpeg:hevc:2015:auxid:2",
  "urn:mpeg:mpegB:cicp:systems:auxiliary:alpha",
  "urn:mpeg:mpegB:cicp:systems:auxiliary:depth",
  "urn:com:apple:photo:2020:aux:hdrgainmap",
  "urn:com:apple:photo:2018:aux:portraiteffectsmatte",
  "urn:com:apple:photo:2019:aux:semanticskinmatte",
  "urn:com:apple:photo:2019:aux:semantichairmatte",
  "urn:com:apple:photo:2019:aux:semanticteethmatte",
  "urn:com:apple:photo:2020:aux:semanticglassesmatte",
  "urn:com:apple:photo:2023:aux:semanticskymatte",
]);
const XMP_TYPE = "application/rdf+xml";
// A colour property's own fields, after its type: primaries, transfer,
// matrix (2 bytes each) and full range (1).
const NCLX_FIELDS = 7;

/** A box becomes an empty "free" box of the same size. */
function free(out: Uint8Array, box: Box) {
  out.set([0x66, 0x72, 0x65, 0x65], box.start + 4); // "free"
  out.fill(0, box.body, box.end);
}

/** Writes a new payload over an item's extents, in order. */
function overwrite(out: Uint8Array, item: Item, payload: Uint8Array) {
  let at = 0;
  for (const x of item.extents) {
    out.set(payload.subarray(at, at + x.length), x.offset);
    at += x.length;
  }
}

function blankExif(b: Uint8Array, item: Item, orientation: number) {
  const old = itemBytes(b, item);
  const tiff = exifTiff(old);
  const payload = new Uint8Array(old.length);
  // Keep the offset to the TIFF header, and "Exif\0\0" when that's all it
  // skips, so the item still reads as Exif. Anything else it skips goes.
  const head = tiff ? old.length - tiff.length : 0;
  payload.set(old.subarray(0, Math.min(head, 4)));
  if (head === 10 && startsWith(old, 4, "Exif\0\0")) {
    payload.set(old.subarray(4, 10), 4);
  }
  const fresh = isTurned(orientation)
    ? orientationTiff(orientation)
    : EMPTY_TIFF;
  // Too small for even an empty TIFF: zeros, which no reader takes for one.
  if (tiff && fresh.length <= tiff.length) payload.set(fresh, head);
  return payload;
}

/** Zeros every byte of [from, to) outside the kept spans (sorted). */
function blankAround(
  out: Uint8Array,
  from: number,
  to: number,
  kept: { from: number; to: number }[],
) {
  let at = from;
  for (const span of kept) {
    if (span.to <= at) continue;
    if (span.from >= to) break;
    if (span.from > at) out.fill(0, at, span.from);
    at = Math.max(at, span.to);
  }
  if (at < to) out.fill(0, at, to);
}

/** An item entry's item id. */
function entryId(out: Uint8Array, box: Box): number {
  const idSize = (out[box.body] ?? 0) === 3 ? 4 : 2;
  let id = 0;
  for (let i = 0; i < idSize; i++) id = id * 256 + (out[box.body + 4 + i] ?? 0);
  return id;
}

/** An item entry's words: its name (and, for older entries and mime and
 * uri items, its content type, encoding or uri type) become spaces of the
 * same length, and whatever follows them, zeros. XMP keeps a content type
 * that says only that it's XMP. */
function blankEntry(out: Uint8Array, box: Box, xmp: Set<number>) {
  const version = out[box.body] ?? 0;
  const idSize = version === 3 ? 4 : 2;
  const id = entryId(out, box);
  let at = box.body + 4 + idSize + 2;
  let type = "";
  if (version >= 2) {
    type = ascii(out, at, at + 4);
    at += 4;
  }
  const strings = version < 2 || type === "mime" ? 3 : type === "uri " ? 2 : 1;
  for (let n = 0; n < strings && at < box.end; n++) {
    let end = out.indexOf(0, at);
    if (end < 0 || end >= box.end) end = box.end;
    out.fill(0x20, at, end);
    if (n === 1 && type === "mime" && xmp.has(id)) {
      out.set(new TextEncoder().encode(XMP_TYPE).subarray(0, end - at), at);
    }
    at = end + 1;
  }
  if (at < box.end) out.fill(0, at, box.end);
}

/** The file type: its known brands kept, any other replaced by a known
 * one, its minor version and any bytes past the last brand zeroed. */
function cleanFileType(out: Uint8Array, box: Box) {
  const brands: number[] = [];
  for (let at = box.body; at + 4 <= box.end; at += 4) {
    if (at !== box.body + 4) brands.push(at);
  }
  const known = brands
    .map((at) => ascii(out, at, at + 4))
    .find((brand) => BRANDS.has(brand));
  const stand = new TextEncoder().encode(known ?? "mif1");
  for (const at of brands) {
    if (!BRANDS.has(ascii(out, at, at + 4))) out.set(stand, at);
  }
  out.fill(0, box.body + 4, Math.min(box.end, box.body + 8));
  const last = (brands.at(-1) ?? box.body + 4) + 4;
  out.fill(0, last, box.end);
}

/** A property kept: its words and whatever follows its fields cleaned. */
function cleanProperty(out: Uint8Array, property: Box) {
  const { body, end } = property;
  if (property.type === "colr") {
    const kind = ascii(out, body, body + 4);
    if (kind === "nclx") {
      out.fill(0, Math.min(end, body + 4 + NCLX_FIELDS), end);
    } else if (kind === "prof" || kind === "rICC") {
      const profile = cleanIcc(out.subarray(body + 4, end));
      if (!profile) return free(out, property);
      out.fill(0, body + 4, end);
      out.set(profile, body + 4);
    } else free(out, property);
  } else if (property.type === "auxC") {
    // A full box: version and flags, then the helper's type.
    const start = body + 4;
    let stop = out.indexOf(0, start);
    if (stop < 0 || stop >= end) stop = end;
    if (!HELPER_TYPES.has(ascii(out, start, stop))) out.fill(0, start, end);
  }
}

/** A data reference's locations (url, urn): emptied. */
function cleanReferences(out: Uint8Array, r: Reader, dinf: Box) {
  const dref = find(r.boxes(dinf.body, dinf.end), "dref");
  if (!dref) return;
  // A full box and a count, then its entries, each a full box.
  for (const entry of r.boxes(dref.body + 8, dref.end)) {
    out.fill(0, Math.min(entry.end, entry.body + 4), entry.end);
  }
}

export function stripHeic(
  b: Uint8Array,
  orientation = 1,
  opts: CleanOptions = KEEP_LABELS,
): Uint8Array {
  const layout = heifLayout(b);
  const { reader: r, top, meta, inside, exif } = layout;
  if (find(top, "moov")) {
    throw new CantClean("This HEIC is a sequence tellall can't clean.");
  }
  if (!layout.primary) throw new Error("This HEIC names no main picture.");
  const last = top.at(-1);
  // Whatever follows the last whole box isn't part of the photo.
  const out = b.slice(0, last ? last.end : 0);

  // XMP that names the source type, kept whole; the rest becomes spaces.
  const sourceXmp =
    sourceType(opts) === undefined
      ? []
      : layout.xmp.filter((item) =>
          ascii(itemBytes(b, item)).includes("DigitalSourceType"),
        );
  const xmp = layout.xmp.filter((item) => !sourceXmp.includes(item));

  // The bytes the picture is drawn from (and the XMP kept), in file order.
  const kept = [...layout.pictures, ...layout.helperXmp, ...sourceXmp]
    .flatMap((item) => item.extents)
    .map((x) => ({ from: x.offset, to: x.offset + x.length }))
    .sort((x, y) => x.from - y.from);

  for (const box of top) {
    if (box === meta) continue;
    if (opts.keepLabels && isLabel(out, box)) continue;
    if (box.type === "ftyp") cleanFileType(out, box);
    else if (box.type === "mdat") blankAround(out, box.body, box.end, kept);
    else free(out, box);
  }
  const xmpIds = new Set([...layout.xmp, ...layout.helperXmp].map((x) => x.id));
  const leftOut = new Set(layout.leftOut.map((x) => x.id));
  for (const box of inside) {
    if (!META_BOXES.has(box.type)) free(out, box);
    else if (box.type === "idat") blankAround(out, box.body, box.end, kept);
    // The handler's name, after its type and reserved fields.
    else if (box.type === "hdlr") out.fill(0, box.body + 24, box.end);
    else if (box.type === "dinf") cleanReferences(out, r, box);
    else if (box.type === "iinf") {
      const countSize = (out[box.body] ?? 0) === 0 ? 2 : 4;
      for (const entry of r.boxes(box.body + 4 + countSize, box.end)) {
        if (entry.type !== "infe") continue;
        blankEntry(out, entry, xmpIds);
        // A picture left out is marked hidden (the entry's flags), so no
        // reader shows it as a picture of its own.
        if (leftOut.has(entryId(out, entry))) {
          out[entry.body + 3] = (out[entry.body + 3] ?? 0) | 1;
        }
      }
    } else if (box.type === "iref") {
      // A reference from a picture left out (a depth map's or a matte's
      // auxl, to the photo), or only to such pictures, stops being one:
      // its type becomes "free", which readers skip. Its ids stay, so a
      // reader that reads it anyway finds items that are there.
      for (const ref of layout.references) {
        const { from, to } = ref;
        if (
          leftOut.has(from) ||
          (to.length && to.every((t) => leftOut.has(t)))
        ) {
          out.set([0x66, 0x72, 0x65, 0x65], ref.box.start + 4); // "free"
        }
      }
    } else if (box.type === "iprp") {
      for (const part of r.boxes(box.body, box.end)) {
        if (part.type === "ipma") continue;
        if (part.type !== "ipco") {
          free(out, part);
          continue;
        }
        for (const property of r.boxes(part.body, part.end)) {
          if (!PROPERTIES.has(property.type)) free(out, property);
          else cleanProperty(out, property);
        }
      }
    }
  }
  // Any other item's bytes, wherever they are, unless a picture uses them.
  const pictures = new Set([
    ...layout.pictures,
    ...layout.helperXmp,
    ...sourceXmp,
  ]);
  for (const item of layout.items) {
    if (pictures.has(item)) continue;
    for (const x of item.extents) {
      blankAround(out, x.offset, x.offset + x.length, kept);
    }
  }
  // A JPEG the picture is drawn from: cleaned without moving a byte.
  for (const item of layout.pictures) {
    if (item.type === "jpeg") {
      overwrite(out, item, cleanJpegInPlace(itemBytes(b, item)));
    }
  }
  for (const item of exif) {
    overwrite(out, item, blankExif(b, item, orientation));
  }
  for (const item of xmp) {
    const length = item.extents.reduce((n, x) => n + x.length, 0);
    overwrite(out, item, new Uint8Array(length).fill(0x20));
  }
  // A gain map's XMP, written anew from its values alone.
  for (const item of layout.helperXmp) {
    const packet = gainMapPacket(itemBytes(b, item));
    if (packet) overwrite(out, item, packet);
  }
  return out;
}
