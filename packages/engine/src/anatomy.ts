// A file's parts to scale, for the anatomy map (spec §5.1a): header,
// label, metadata, pixels and the rest, from the file's own structure.
// Each walk is tolerant: where a file can't be followed, the rest is one
// "other" part saying so. The parts cover the file exactly, in order.
import { ascii, startsWith } from "./bytes.ts";
import type { Range } from "./c2pa/locate.ts";
import type { ImageType } from "./image/detect.ts";
import { heifLayout } from "./image/heif.ts";
import { en } from "./words/en.ts";

export type Part = "header" | "label" | "metadata" | "pixels" | "other";

export interface Piece {
  part: Part;
  offset: number;
  length: number;
  note: string;
}

const words = en.anatomy;

type Span = [from: number, to: number, part: Part, note: string];

/** The file's parts: added in order by a walk, then a few painted over
 * them (a label, a HEIC's metadata items), a later paint winning. */
class Canvas {
  private spans: Span[] = [];
  private done = false;
  constructor(readonly length: number) {}

  /** The next part a walk found; a neighbour like it grows instead. */
  add(from: number, to: number, part: Part, note: string) {
    const last = this.spans.at(-1);
    from = Math.max(from, last ? last[1] : 0);
    to = Math.min(this.length, to);
    if (to <= from) return;
    if (last && last[1] === from && last[2] === part && last[3] === note) {
      last[1] = to;
    } else this.spans.push([from, to, part, note]);
  }

  /** The walk's parts with the gaps between them filled in. */
  private finish() {
    if (this.done) return;
    this.done = true;
    const out: Span[] = [];
    let at = 0;
    for (const s of this.spans) {
      if (s[0] > at) out.push([at, s[0], "other", words.gap]);
      out.push(s);
      at = s[1];
    }
    if (at < this.length) out.push([at, this.length, "other", words.gap]);
    this.spans = out;
  }

  paint(from: number, to: number, part: Part, note: string) {
    this.finish();
    from = Math.max(0, from);
    to = Math.min(this.length, to);
    if (to <= from) return;
    const out: Span[] = [];
    for (const s of this.spans) {
      const [a, b] = s;
      if (b <= from || a >= to) {
        out.push(s);
        continue;
      }
      if (a < from) out.push([a, from, s[2], s[3]]);
      if (b > to) out.push([to, b, s[2], s[3]]);
    }
    out.push([from, to, part, note]);
    this.spans = out.sort((x, y) => x[0] - y[0]);
  }

  /** Neighbours of the same part made one, their notes listed once. */
  pieces(): Piece[] {
    this.finish();
    const out: Piece[] = [];
    let notes: string[] = [];
    for (const [from, to, part, note] of this.spans) {
      const last = out.at(-1);
      if (last && last.part === part && last.offset + last.length === from) {
        last.length += to - from;
        if (!notes.includes(note)) {
          notes.push(note);
          last.note = notes.join(", ");
        }
        continue;
      }
      notes = [note];
      out.push({ part, offset: from, length: to - from, note });
    }
    return out;
  }
}

const u32 = (b: Uint8Array, at: number, little = false) =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at, little);

function png(b: Uint8Array, c: Canvas) {
  c.add(0, 8, "header", words.signature);
  let i = 8;
  for (; i + 8 <= b.length;) {
    const end = i + 12 + u32(b, i);
    const type = ascii(b, i + 4, i + 8);
    if (end > b.length) {
      c.add(i, b.length, "other", words.cutShort);
      return;
    }
    if (type === "IHDR") c.add(i, end, "header", words.imageHeader);
    else if (type === "PLTE") c.add(i, end, "header", type);
    else if (type === "IDAT" || type === "fdAT")
      c.add(i, end, "pixels", words.pixels);
    else if (type === "eXIf" || type === "exIf")
      c.add(i, end, "metadata", words.exif);
    else if (type === "iTXt" && startsWith(b, i + 8, "XML:com.adobe.xmp\0")) {
      c.add(i, end, "metadata", words.xmp);
    } else if (type === "tEXt" || type === "zTXt" || type === "iTXt") {
      c.add(i, end, "metadata", words.text);
    } else if (type === "tIME") c.add(i, end, "metadata", words.time);
    else if (type === "iCCP") c.add(i, end, "other", words.profile);
    else if (type === "IEND") c.add(i, end, "other", words.end);
    else c.add(i, end, "other", type);
    i = end;
    if (type === "IEND") break;
  }
  if (i < b.length) {
    c.add(
      i,
      b.length,
      "other",
      i + 8 > b.length ? words.cutShort : words.afterEnd,
    );
  }
}

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;

/** Where a scan's data ends: at the next marker that isn't a stuffed
 * byte, a restart or fill. */
function scanEnd(b: Uint8Array, from: number): number {
  for (let i = from; i + 1 < b.length; i++) {
    if (b[i] !== 0xff) continue;
    const next = b[i + 1] ?? 0;
    if (next === 0x00 || next === 0xff || (next >= 0xd0 && next <= 0xd7))
      continue;
    return i;
  }
  return b.length;
}

function jpegNote(b: Uint8Array, marker: number, body: number): [Part, string] {
  if (marker === 0xe0) return ["header", words.jfif];
  if (marker === 0xe1 && startsWith(b, body, "Exif\0"))
    return ["metadata", words.exif];
  if (marker === 0xe1 && startsWith(b, body, "http://ns.adobe.com/")) {
    return ["metadata", words.xmp];
  }
  if (marker === 0xe2 && startsWith(b, body, "ICC_PROFILE\0")) {
    return ["other", words.profile];
  }
  if (marker === 0xed) return ["metadata", words.iptc];
  if (marker === 0xfe) return ["metadata", words.comment];
  // APP11 is the label's (painted over from its range) or JPEG XT's.
  if (marker >= 0xe0 && marker <= 0xef) {
    return ["metadata", `APP${marker - 0xe0}`];
  }
  if (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    ![0xc4, 0xc8, 0xcc].includes(marker)
  ) {
    return ["header", words.imageHeader];
  }
  if ([0xc4, 0xcc, 0xdb, 0xdd, 0xde, 0xdf].includes(marker)) {
    return ["header", words.tables];
  }
  return ["other", `0xFF${marker.toString(16).toUpperCase()}`];
}

function jpeg(b: Uint8Array, c: Canvas) {
  c.add(0, 2, "header", words.signature);
  let i = 2;
  let scanned = false;
  while (i < b.length) {
    if (b[i] !== 0xff) {
      if (!scanned) {
        c.add(i, b.length, "other", words.unreadable);
        return;
      }
      i++; // stray bytes between scans: left as unused
      continue;
    }
    const marker = b[i + 1];
    if (marker === undefined) break;
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === EOI) {
      c.add(i, i + 2, "other", words.end);
      i += 2;
      if (i < b.length) c.add(i, b.length, "other", words.afterEnd);
      return;
    }
    if (
      marker === SOI ||
      (marker >= 0xd0 && marker <= 0xd7) ||
      marker === 0x01
    ) {
      i += 2;
      continue;
    }
    if (i + 4 > b.length) break;
    const length = ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
    const end = i + 2 + length;
    if (length < 2) {
      c.add(i, b.length, "other", words.unreadable);
      return;
    }
    if (end > b.length) break;
    if (marker === SOS) {
      const stop = scanEnd(b, end);
      c.add(i, stop, "pixels", words.pixels);
      scanned = true;
      i = stop;
      continue;
    }
    const [part, note] = jpegNote(b, marker, i + 4);
    c.add(i, end, part, note);
    i = end;
  }
  if (i < b.length) c.add(i, b.length, "other", words.cutShort);
}

function webp(b: Uint8Array, c: Canvas) {
  c.add(0, 12, "header", words.signature);
  const declared = b.length >= 8 ? 8 + u32(b, 4, true) : b.length;
  const to = Math.min(b.length, declared);
  let i = 12;
  for (; i + 8 <= to;) {
    const size = u32(b, i + 4, true);
    const type = ascii(b, i, i + 4);
    const next = i + 8 + size + (size % 2);
    if (i + 8 + size > b.length) {
      c.add(i, b.length, "other", words.cutShort);
      return;
    }
    const end = Math.min(next, b.length);
    if (type === "VP8X" || type === "ANIM")
      c.add(i, end, "header", words.imageHeader);
    else if (["VP8 ", "VP8L", "ALPH", "ANMF"].includes(type)) {
      c.add(i, end, "pixels", words.pixels);
    } else if (type === "EXIF") c.add(i, end, "metadata", words.exif);
    else if (type === "XMP ") c.add(i, end, "metadata", words.xmp);
    else if (type === "ICCP") c.add(i, end, "other", words.profile);
    else c.add(i, end, "other", type.trim());
    i = next;
  }
  if (declared > b.length)
    c.add(Math.min(i, b.length), b.length, "other", words.cutShort);
  else if (to < b.length) c.add(to, b.length, "other", words.afterEnd);
}

function heic(b: Uint8Array, c: Canvas) {
  let i = 0;
  while (i + 8 <= b.length) {
    let size = u32(b, i);
    let header = 8;
    if (size === 1) {
      if (i + 16 > b.length) break;
      size = Number(new DataView(b.buffer, b.byteOffset).getBigUint64(i + 8));
      header = 16;
    } else if (size === 0) size = b.length - i;
    if (size < header) {
      c.add(i, b.length, "other", words.unreadable);
      return;
    }
    const type = ascii(b, i + 4, i + 8);
    const end = i + size;
    if (end > b.length) {
      c.add(i, b.length, "other", words.cutShort);
      return;
    }
    if (type === "ftyp") c.add(i, end, "header", words.signature);
    else if (type === "meta") c.add(i, end, "header", words.items);
    else if (type === "mdat") c.add(i, end, "pixels", words.pixels);
    else c.add(i, end, "other", type);
    i = end;
  }
  if (i < b.length) c.add(i, b.length, "other", words.cutShort);
  // The photo's Exif and XMP items, wherever their bytes sit.
  try {
    const { exif, xmp } = heifLayout(b);
    for (const item of exif) {
      for (const x of item.extents)
        c.paint(x.offset, x.offset + x.length, "metadata", words.exif);
    }
    for (const item of xmp) {
      for (const x of item.extents)
        c.paint(x.offset, x.offset + x.length, "metadata", words.xmp);
    }
  } catch {
    // The items can't be followed: the boxes alone are drawn.
  }
}

/** The file's parts, in order; the label's range (from c2pa/locate.ts)
 * drawn over whatever holds it. Never throws. */
export function anatomy(
  b: Uint8Array,
  type: ImageType,
  label: { range: Range | null; signer: string | null } | null,
): Piece[] {
  const c = new Canvas(b.length);
  try {
    if (type === "png") png(b, c);
    else if (type === "jpeg") jpeg(b, c);
    else if (type === "webp") webp(b, c);
    else heic(b, c);
  } catch {
    // What was drawn stays; the rest is left as it was.
  }
  if (label?.range) {
    const { offset, length } = label.range;
    c.paint(offset, offset + length, "label", words.label(label.signer));
  }
  return c.pieces();
}
