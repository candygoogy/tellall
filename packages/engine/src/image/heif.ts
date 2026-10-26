// Finds the metadata inside a HEIC (HEIF) file. The file is a tree of
// boxes; its "meta" box lists every item (each picture tile, the Exif
// block, XMP packets) in iinf, says where each one's bytes are in iloc,
// and links them in iref: "cdsc" says which picture a metadata item
// describes, "auxl" marks a helper picture (an HDR gain map, a depth or
// segmentation map) and the picture it belongs to.
//
// Every Exif item counts, whatever picture it describes: Exif can carry a
// place, a time and a device wherever it's attached, and no picture needs
// it to be drawn. XMP counts too, unless it's about a helper picture that
// is drawn and says nothing but how to draw a gain map (gain-map.ts).
//
// The picture is what a reader draws: the primary item, the pictures it's
// made from (a grid's tiles), its alternatives (an HDR tone map), and its
// thumbnails and the helpers that change how it looks (an HDR gain map,
// an alpha map: told apart by their auxC type), each of a type that holds
// a picture. Any other helper (a depth map, Apple's portrait and
// segmentation mattes) is left out, and so is a picture item nothing
// leads to: metadata to a clean copy (strip/heic.ts).
import { ascii, startsWith } from "../bytes.ts";
import { gainMapPacket } from "./gain-map.ts";
//
// Every read stays inside its own box, and every count is checked against
// the bytes its box has left, so a crafted file can't make reading it run
// long. No item can be bigger than the file or cover the same bytes twice.

export interface Extent {
  /** Where the bytes start, from the start of the file. */
  offset: number;
  length: number;
}

export interface Item {
  id: number;
  /** The item's type; empty for an entry older than item types. */
  type: string;
  /** For "mime" items, the content type: XMP is application/rdf+xml. */
  contentType: string;
  extents: Extent[];
  /** Stored inside another item (iloc's construction method 2), which
   * this page doesn't follow. */
  inItem?: true;
}

/** A photo whose details are stored in a way this page can't clean. */
export class CantClean extends Error {}

export interface HeifMeta {
  /** Exif items: each starts with a 4-byte offset to its TIFF header. */
  exif: Item[];
  /** XMP packets. */
  xmp: Item[];
}

export interface Box {
  type: string;
  /** The box's first byte, its content's first byte and its end. */
  start: number;
  body: number;
  end: number;
}

export class Reader {
  readonly view: DataView;
  constructor(readonly b: Uint8Array) {
    this.view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }

  /** A whole number of 0, 2, 4 or 8 bytes, from inside [at, end). */
  uint(at: number, size: number, end = this.b.length): number {
    if (size === 0) return 0;
    if (at + size > Math.min(end, this.b.length)) {
      throw new Error("A HEIC box ends early.");
    }
    if (size === 1) return this.view.getUint8(at);
    if (size === 2) return this.view.getUint16(at);
    if (size === 4) return this.view.getUint32(at);
    if (size === 8) {
      const n = this.view.getBigUint64(at);
      if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Too big.");
      return Number(n);
    }
    throw new Error("A field size HEIC doesn't use.");
  }

  /** The boxes from `from` to `to`, one level deep. */
  boxes(from: number, to: number): Box[] {
    const out: Box[] = [];
    let at = from;
    while (at + 8 <= to) {
      let size = this.uint(at, 4);
      let body = at + 8;
      if (size === 1) {
        size = this.uint(at + 8, 8);
        body += 8;
      } else if (size === 0) {
        size = to - at;
      }
      if (size < body - at || at + size > to) {
        throw new Error("A HEIC box runs past its end.");
      }
      out.push({
        type: ascii(this.b, at + 4, at + 8),
        start: at,
        body,
        end: at + size,
      });
      at += size;
    }
    return out;
  }
}

export const find = (boxes: Box[], type: string) =>
  boxes.find((x) => x.type === type);

/** Every item's type, from iinf. */
export function itemTypes(r: Reader, iinf: Box): Map<number, Item> {
  const version = r.uint(iinf.body, 1, iinf.end);
  const countSize = version === 0 ? 2 : 4;
  const count = r.uint(iinf.body + 4, countSize, iinf.end);
  const first = iinf.body + 4 + countSize;
  const items = new Map<number, Item>();
  for (const infe of r.boxes(first, iinf.end).slice(0, count)) {
    if (infe.type !== "infe") continue;
    const end = infe.end;
    const v = r.uint(infe.body, 1, end);
    let at = infe.body + 4;
    const idSize = v === 3 ? 4 : 2;
    const id = r.uint(at, idSize, end);
    // One id, one item: a second entry could pass one item off as another.
    if (items.has(id)) throw new Error("A HEIC lists one item twice.");
    at += idSize + 2; // and the protection index
    // Versions 0 and 1 predate item types: never a picture.
    if (v < 2) {
      items.set(id, { id, type: "", contentType: "", extents: [] });
      continue;
    }
    if (at + 4 > end) throw new Error("A HEIC item entry ends early.");
    const type = ascii(r.b, at, at + 4);
    at += 4;
    let contentType = "";
    if (type === "mime") {
      // The item's name, then its content type, each ending in a zero. A
      // content type is short; past this, it isn't XMP's.
      const rest = ascii(r.b, at, Math.min(end, at + 512)).split("\0");
      contentType = rest[1] ?? "";
    }
    items.set(id, { id, type, contentType, extents: [] });
  }
  return items;
}

/** Where each item's bytes are, from iloc (idat holds some of them). */
export function locate(
  r: Reader,
  iloc: Box,
  idat: Box | undefined,
  items: Map<number, Item>,
) {
  const end = iloc.end;
  const u = (at: number, size: number) => r.uint(at, size, end);
  const version = u(iloc.body, 1);
  let at = iloc.body + 4;
  const sizes = u(at, 1);
  const more = u(at + 1, 1);
  at += 2;
  const offsetSize = sizes >> 4;
  const lengthSize = sizes & 0x0f;
  const baseSize = more >> 4;
  const indexSize = version >= 1 ? more & 0x0f : 0;
  const idSize = version === 2 ? 4 : 2;
  const count = u(at, idSize);
  at += idSize;
  // No count can ask for more entries than the box has bytes left for.
  const entrySize = idSize + (version >= 1 ? 2 : 0) + 2 + baseSize + 2;
  const extentSize = indexSize + offsetSize + lengthSize;
  const tooMany = () =>
    new Error("The HEIC's item locations run past their box.");
  if (count * entrySize > end - at) throw tooMany();
  for (let n = 0; n < count; n++) {
    const id = u(at, idSize);
    at += idSize;
    let method = 0;
    if (version >= 1) {
      method = u(at, 2) & 0x0f;
      at += 2;
    }
    at += 2; // data reference index: always this file
    const base = u(at, baseSize);
    at += baseSize;
    const extentCount = u(at, 2);
    at += 2;
    // Extents without any fields can't say anything past the first.
    if (extentSize ? extentCount * extentSize > end - at : extentCount > 1) {
      throw tooMany();
    }
    const extents: Extent[] = [];
    for (let e = 0; e < extentCount; e++) {
      at += indexSize;
      const offset = u(at, offsetSize);
      at += offsetSize;
      const length = u(at, lengthSize);
      at += lengthSize;
      extents.push({ offset: base + offset, length });
    }
    const item = items.get(id);
    if (!item) continue;
    // Method 0 counts from the file's start, method 1 from idat's
    // content; method 2 (bytes inside another item) isn't followed.
    if (method > 1) {
      item.inItem = true;
      continue;
    }
    // Bytes counted from idat's content stay inside idat.
    let limit = r.b.length;
    if (method === 1) {
      if (!idat) throw new Error("The HEIC points into an idat it lacks.");
      for (const x of extents) x.offset += idat.body;
      limit = idat.end;
    }
    // A zero length means "to the end" (of the file, or of idat), with
    // one extent.
    for (const x of extents) {
      if (x.length === 0 && extents.length === 1) x.length = limit - x.offset;
      if (x.offset + x.length > limit) {
        throw new Error("A HEIC item runs past the end of its data.");
      }
    }
    // An item is never bigger than the file, and never covers the same
    // bytes twice: a small file can't make reading it take gigabytes.
    const sorted = [...extents].sort((x, y) => x.offset - y.offset);
    let total = 0;
    let reach = 0;
    for (const x of sorted) {
      if (x.length > 0 && x.offset < reach) {
        throw new Error("A HEIC item covers the same bytes twice.");
      }
      reach = Math.max(reach, x.offset + x.length);
      total += x.length;
    }
    if (total > r.b.length) {
      throw new Error("A HEIC item is bigger than the file.");
    }
    item.extents = extents;
  }
}

export interface Property {
  type: string;
  box: Box;
}

/** iprp's properties (ipco), and which ones each item has (ipma). */
export function properties(r: Reader, iprp: Box): Map<number, Property[]> {
  const inside = r.boxes(iprp.body, iprp.end);
  const ipco = find(inside, "ipco");
  const out = new Map<number, Property[]>();
  if (!ipco) return out;
  const all = r.boxes(ipco.body, ipco.end);
  for (const ipma of inside.filter((x) => x.type === "ipma")) {
    const end = ipma.end;
    const version = r.uint(ipma.body, 1, end);
    const wide = (r.uint(ipma.body + 3, 1, end) & 1) === 1;
    const count = r.uint(ipma.body + 4, 4, end);
    let at = ipma.body + 8;
    const idSize = version < 1 ? 2 : 4;
    // Each entry takes at least its id and its count.
    if (count * (idSize + 1) > end - at) {
      throw new Error("The HEIC's property list runs past its box.");
    }
    for (let n = 0; n < count; n++) {
      const id = r.uint(at, idSize, end);
      at += idSize;
      const links = r.uint(at, 1, end);
      at += 1;
      const list: Property[] = [];
      for (let k = 0; k < links; k++) {
        const value = r.uint(at, wide ? 2 : 1, end);
        at += wide ? 2 : 1;
        const index = value & (wide ? 0x7fff : 0x7f);
        const box = all[index - 1];
        if (box) list.push({ type: box.type, box });
      }
      out.set(id, [...(out.get(id) ?? []), ...list]);
    }
  }
  return out;
}

/** Whether a metadata item's bytes are also another item's (the picture's,
 * say): blanking them would change that item. */
function overlaps(all: Item[], metadata: Set<Item>): boolean {
  const spans = all.flatMap((item) =>
    item.extents
      .filter((x) => x.length > 0)
      .map((x) => ({ item, from: x.offset, to: x.offset + x.length })),
  );
  spans.sort((a, b) => a.from - b.from);
  let widest: (typeof spans)[number] | undefined;
  for (const span of spans) {
    if (
      widest &&
      span.from < widest.to &&
      span.item !== widest.item &&
      (metadata.has(span.item) || metadata.has(widest.item))
    ) {
      return true;
    }
    if (!widest || span.to > widest.to) widest = span;
  }
  return false;
}

/** One reference in iref: its box, and from which item to which. */
export interface Reference {
  box: Box;
  from: number;
  to: number[];
}

/** Which items describe which pictures, which pictures are helpers, and
 * how pictures are linked: what each is made from (a grid's tiles), and
 * which are thumbnails or helpers of which. And every reference. */
function links(r: Reader, iref: Box | undefined) {
  const describes = new Map<number, number[]>();
  const helpers = new Set<number>();
  const parts = new Map<number, number[]>();
  /** Thumbnails and helpers: [the item, the pictures it belongs to, which
   * of the two it is]. */
  const belongs: [number, number[], "thmb" | "auxl"][] = [];
  const references: Reference[] = [];
  if (!iref) return { describes, helpers, parts, belongs, references };
  const wide = r.uint(iref.body, 1, iref.end) === 1;
  const idSize = wide ? 4 : 2;
  for (const ref of r.boxes(iref.body + 4, iref.end)) {
    const from = r.uint(ref.body, idSize, ref.end);
    const count = r.uint(ref.body + idSize, 2, ref.end);
    const first = ref.body + idSize + 2;
    if (count * idSize > ref.end - first) {
      throw new Error("A HEIC reference runs past its box.");
    }
    const to: number[] = [];
    for (let i = 0; i < count; i++) {
      to.push(r.uint(first + i * idSize, idSize, ref.end));
    }
    if (ref.type === "cdsc")
      describes.set(from, [...(describes.get(from) ?? []), ...to]);
    if (ref.type === "auxl") helpers.add(from);
    if (ref.type === "auxl" || ref.type === "thmb") {
      belongs.push([from, to, ref.type]);
    }
    if (ref.type === "dimg")
      parts.set(from, [...(parts.get(from) ?? []), ...to]);
    references.push({ box: ref, from, to });
  }
  return { describes, helpers, parts, belongs, references };
}

/** The alternatives groups in grpl: pictures a reader may draw instead of
 * one another (the photo and its HDR tone map). */
function alternatives(r: Reader, grpl: Box | undefined): number[][] {
  if (!grpl) return [];
  return r
    .boxes(grpl.body, grpl.end)
    .filter((group) => group.type === "altr")
    .map((group) => {
      // A full box: version and flags, the group's id, then its members.
      const count = r.uint(group.body + 8, 4, group.end);
      const first = group.body + 12;
      if (count * 4 > group.end - first) {
        throw new Error("A HEIC group runs past its box.");
      }
      return Array.from({ length: count }, (_, i) =>
        r.uint(first + i * 4, 4, group.end),
      );
    });
}

/** The file's top-level boxes, up to the first one that doesn't fit in
 * it: whatever follows isn't part of the photo. */
export function topBoxes(r: Reader): Box[] {
  const out: Box[] = [];
  const length = r.b.length;
  let at = 0;
  while (at + 8 <= length) {
    let size = r.uint(at, 4);
    let body = at + 8;
    if (size === 1) {
      if (at + 16 > length) break;
      size = r.uint(at + 8, 8);
      body += 8;
    } else if (size === 0) size = length - at;
    if (size < body - at || at + size > length) break;
    out.push({
      type: ascii(r.b, at + 4, at + 8),
      start: at,
      body,
      end: at + size,
    });
    at += size;
  }
  return out;
}

export interface HeifLayout extends HeifMeta {
  reader: Reader;
  top: Box[];
  meta: Box;
  /** The boxes inside meta. */
  inside: Box[];
  items: Item[];
  /** The main picture, when the file names one of a picture's type. */
  primary: Item | undefined;
  /** Items the picture is drawn from: kept byte for byte. */
  pictures: Item[];
  /** XMP about a helper picture that says only how to draw it. */
  helperXmp: Item[];
  /** Items of a picture's type that aren't the picture: a helper left
   * out, or a picture nothing leads to. */
  leftOut: Item[];
  /** Every reference in iref. */
  references: Reference[];
}

// Item types that hold a picture, or say how to put one together.
const PICTURES = new Set([
  "hvc1",
  "hvt1",
  "lhv1",
  "av01",
  "avc1",
  "vvc1",
  "evc1",
  "jpeg",
  "j2k1",
  "unci",
  "grid",
  "iovl",
  "iden",
  "tmap",
  "mski",
]);

// The helper pictures kept, by their type (auxC), each because it changes
// how the photo looks: Apple's HDR gain map (on an HDR screen), and an
// alpha map (where the photo is see-through), under either of its names.
// Any other helper (a depth map, Apple's mattes of a portrait's subject
// and of hair, skin, teeth, glasses and sky) is left out.
const KEPT_HELPERS = [
  "urn:com:apple:photo:2020:aux:hdrgainmap",
  "urn:mpeg:hevc:2015:auxid:1",
  "urn:mpeg:mpegB:cicp:systems:auxiliary:alpha",
];

/** The file's structure: its boxes, its items, which of them are the
 * picture and which its metadata. Throws when the structure can't be
 * followed, and CantClean when the metadata is stored inside another item
 * or shares its bytes. */
export function heifLayout(b: Uint8Array): HeifLayout {
  const r = new Reader(b);
  const top = topBoxes(r);
  const meta = find(top, "meta");
  if (!meta) throw new Error("This HEIC has no meta box.");
  // meta is a full box: a version and flags come before its boxes.
  const inside = r.boxes(meta.body + 4, meta.end);
  const iinf = find(inside, "iinf");
  const iloc = find(inside, "iloc");
  const items = iinf ? itemTypes(r, iinf) : new Map<number, Item>();
  if (iloc) locate(r, iloc, find(inside, "idat"), items);
  const { describes, helpers, parts, belongs, references } = links(
    r,
    find(inside, "iref"),
  );
  const groups = alternatives(r, find(inside, "grpl"));
  const all = [...items.values()];

  // Whether a helper is one that's kept, from its auxC property. The
  // properties are read only when a helper asks. When they can't be read,
  // no helper is kept: the photo's details still read, and a clean copy
  // leaves the helpers out.
  const iprp = find(inside, "iprp");
  let props: Map<number, Property[]> | undefined;
  const readProps = () => {
    try {
      return iprp ? properties(r, iprp) : new Map<number, Property[]>();
    } catch {
      return new Map<number, Property[]>();
    }
  };
  const isKeptHelper = (id: number) => {
    props ??= readProps();
    const auxC = props.get(id)?.find((p) => p.type === "auxC")?.box;
    if (!auxC) return false;
    // A full box: version and flags, then the type, up to a zero (or the
    // box's end, as strip/heic.ts reads it), then any subtype.
    const start = auxC.body + 4;
    let stop = r.b.indexOf(0, start);
    if (stop < 0 || stop > auxC.end) stop = auxC.end;
    return KEPT_HELPERS.some(
      (type) => stop - start === type.length && startsWith(r.b, start, type),
    );
  };

  // The picture: the primary item, then whatever a kept picture is made
  // from, drawn instead of, or has as its thumbnail or kept helper. Only items
  // of a picture's type: a text item named as a part isn't drawn.
  const pitm = find(inside, "pitm");
  let primary: Item | undefined;
  if (pitm) {
    const wide = r.uint(pitm.body, 1, pitm.end) > 0;
    primary = items.get(r.uint(pitm.body + 4, wide ? 4 : 2, pitm.end));
    if (primary && !PICTURES.has(primary.type)) primary = undefined;
  }
  const keep = new Set<Item>();
  const todo: Item[] = [];
  const add = (id: number) => {
    const item = items.get(id);
    if (!item || keep.has(item) || !PICTURES.has(item.type)) return;
    keep.add(item);
    todo.push(item);
  };
  if (primary) add(primary.id);
  for (let item = todo.pop(); item; item = todo.pop()) {
    const id = item.id;
    for (const part of parts.get(id) ?? []) add(part);
    for (const group of groups) if (group.includes(id)) group.forEach(add);
    for (const [from, to, type] of belongs) {
      if (to.includes(id) && (type === "thmb" || isKeptHelper(from))) add(from);
    }
  }

  // XMP about helper pictures only is the helpers' own business, when the
  // helpers are drawn and it says nothing but how to draw a gain map.
  const aboutThePhoto = (item: Item) => {
    const targets = describes.get(item.id);
    return !targets?.length || targets.some((t) => !helpers.has(t));
  };
  const aboutKeptHelpers = (item: Item) =>
    !aboutThePhoto(item) &&
    (describes.get(item.id) ?? []).every((t) => {
      const target = items.get(t);
      return target !== undefined && keep.has(target);
    });
  const isXmp = (x: Item) =>
    x.type === "mime" &&
    x.contentType.split(";")[0]?.trim() === "application/rdf+xml";
  const helperXmp = all.filter(
    (x) =>
      isXmp(x) &&
      aboutKeptHelpers(x) &&
      !x.inItem &&
      gainMapPacket(itemBytes(b, x)) !== null,
  );
  // The photo's own Exif first: its values win when they differ.
  const exif = all
    .filter((x) => x.type === "Exif")
    .sort((x, y) => Number(aboutThePhoto(y)) - Number(aboutThePhoto(x)));
  const xmp = all.filter((x) => isXmp(x) && !helperXmp.includes(x));
  if ([...exif, ...xmp].some((x) => x.inItem)) {
    throw new CantClean("This HEIC keeps its details inside another item.");
  }
  if (overlaps(all, new Set([...exif, ...xmp]))) {
    throw new CantClean(
      "This HEIC shares its details' bytes with another item.",
    );
  }
  const located = (x: Item) => x.extents.length > 0;
  return {
    reader: r,
    top,
    meta,
    inside,
    items: all,
    primary,
    pictures: [...keep],
    helperXmp,
    leftOut: all.filter((x) => PICTURES.has(x.type) && !keep.has(x)),
    references,
    exif: exif.filter(located),
    xmp: xmp.filter(located),
  };
}

/** The photo's own Exif and XMP items. */
export function heifMeta(b: Uint8Array): HeifMeta {
  const { exif, xmp } = heifLayout(b);
  return { exif, xmp };
}

/** An item's bytes, its extents joined. */
export function itemBytes(b: Uint8Array, item: Item): Uint8Array {
  const total = item.extents.reduce((n, x) => n + x.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const x of item.extents) {
    out.set(b.subarray(x.offset, x.offset + x.length), at);
    at += x.length;
  }
  return out;
}

/** An Exif item's TIFF block, after its 4-byte offset (and the "Exif\0\0"
 * some writers put before the TIFF header). */
export function exifTiff(payload: Uint8Array): Uint8Array | null {
  if (payload.length < 4) return null;
  const skip = new DataView(payload.buffer, payload.byteOffset).getUint32(0);
  const start = 4 + skip;
  return start < payload.length ? payload.subarray(start) : null;
}
