// A clean JPEG keeps only what the picture needs to be drawn, and nothing
// else: an allowlist, so a kind of metadata this page has never heard of
// goes too. Kept, byte for byte: the tables (DQT, DHT, DAC, DRI), the
// frame header (SOFn), each scan with its compressed data, each only when
// it's exactly as long as its content (a decoder refuses any other).
// Kept, written anew: the colour profile (APP2 ICC_PROFILE), cleaned
// (icc.ts); Adobe's colour transform (APP14), its transform alone; JFIF
// (APP0), without its thumbnail. The profile and Adobe's segment count
// only before the first scan, where decoders read them. Everything else
// goes, wherever it sits, between scans too: Exif and XMP (APP1), the
// index of extra pictures (MPF) along with those pictures after the end
// (but a gain map, below),
// Photoshop's IPTC (APP13), comments (COM), the number of lines (DNL,
// which decoders don't use), and any segment this list doesn't name. A
// photo turned by its Exif gets a minimal Exif back that holds only that
// turn. A JPEG cut short keeps what's there of its picture and gets its
// end marker back.
//
// An AI label (Content Credentials, C2PA) is APP11 segments holding JUMBF
// boxes before the first scan: the JPEG XT box instance whose first box
// is a C2PA manifest store (a label split over several segments repeats
// its box header in each). With labels kept they all stay, byte for byte,
// where they were; removed, they all go. Any other JUMBF is metadata. With
// labels kept and a DigitalSourceType given, an APP1 XMP packet holding
// only that comes back too (xmp-min.ts), after JFIF and the turn; one the
// file already has that holds only it stays where it is, byte for byte.
//
// An HDR gain map stored after the picture (Ultra HDR: a JPEG with ISO
// 21496-1's block or a gain map's XMP, listed in MPF) is kept, cleaned on
// its own the same way, with its gain map block and its XMP written anew
// from its values (gain-map.ts); the picture keeps its own ISO 21496-1
// block and gets an MPF written anew that lists only it and its gain
// maps. Any other extra picture goes.
import { startsWith } from "../../bytes.ts";
import { cleanIcc } from "../icc.ts";
import { c2paInstance } from "../../c2pa/locate.ts";
import { gainMapPacket } from "../gain-map.ts";
import { mpfOf, mpfPayload, type MpImage } from "../mpf.ts";
import { technicalOnly } from "../technical.ts";
import { minimalXmpBytes, sourceOnly } from "../xmp-min.ts";
import { KEEP_LABELS, sourceType, type CleanOptions } from "./options.ts";

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP11 = 0xeb;
const APP14 = 0xee;
const DHT = 0xc4;
const DAC = 0xcc;
const DQT = 0xdb;
const DRI = 0xdd;
const EXP = 0xdf;

/** Segments the picture needs: DHT, DAC, DQT, DRI, DHP, EXP and every
 * frame header (SOF0 to SOF15, apart from DHT, JPG and DAC's codes). */
const TABLES = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcc, 0xcd,
  0xce, 0xcf, 0xdb, 0xdd, 0xde, 0xdf,
]);
const ICC = "ICC_PROFILE\0";
/** ISO 21496-1's gain map block (APP2), and the most it holds after its
 * name: a few numbers for each of three channels. */
const ISO = "urn:iso:std:iso:ts:21496:-1\0";
const ISO_MOST = 512;
const XMP = "http://ns.adobe.com/xap/1.0/\0";
/** The most profile one APP2 segment holds, after its 14-byte header. */
const ICC_PIECE = 65_519;

export interface Segment {
  marker: number;
  /** The segment's first byte (its 0xFF) and its end. */
  start: number;
  end: number;
  /** Where its content starts, after the marker and the length. */
  body: number;
  /** For SOS: the compressed data after the header, up to the next marker. */
  scan?: number;
  /** Whether a scan came before it. */
  late: boolean;
}

/** Where a scan's compressed data ends: at the next real marker. Inside
 * it, 0xFF is followed by 0x00 (a stuffed byte), a restart marker, or more
 * 0xFF (fill). */
function scanEnd(b: Uint8Array, from: number): number {
  for (let i = from; i + 1 < b.length; i++) {
    if (b[i] !== 0xff) continue;
    const next = b[i + 1] ?? 0;
    if (next === 0x00 || next === 0xff || (next >= 0xd0 && next <= 0xd7)) {
      continue;
    }
    return i;
  }
  return b.length;
}

/** Every segment from SOI to EOI, scans and what lies between them
 * included. Stops at the end marker, or where the file is cut short (a
 * segment running past the end is left out). Throws when the segments
 * before the first scan don't add up. */
export function segments(b: Uint8Array): {
  list: Segment[];
  ended: boolean;
  /** Just after the end marker; where the walk stopped, when there's none. */
  end: number;
} {
  if (b[0] !== 0xff || b[1] !== SOI) throw new Error("Not a JPEG.");
  const list: Segment[] = [];
  let late = false;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) {
      // Past a scan, stray bytes before the next marker are skipped, as
      // decoders do; before one, the file isn't what it says.
      if (!late) throw new Error("The JPEG's segments don't add up.");
      i++;
      continue;
    }
    const marker = b[i + 1];
    if (marker === undefined) break;
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === EOI) return { list, ended: true, end: i + 2 };
    // Markers without a length (a restart, TEM) carry nothing: skipped.
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (i + 4 > b.length) break;
    const length = ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
    const end = i + 2 + length;
    if (length < 2) throw new Error("The JPEG's segments don't add up.");
    if (end > b.length) {
      if (!late) throw new Error("The JPEG's segments don't add up.");
      break;
    }
    if (marker === SOS) {
      const stop = scanEnd(b, end);
      list.push({ marker, start: i, end: stop, body: i + 4, scan: end, late });
      late = true;
      i = stop;
      continue;
    }
    list.push({ marker, start: i, end, body: i + 4, late });
    i = end;
  }
  return { list, ended: false, end: Math.min(i, b.length) };
}

/** A minimal Exif block (TIFF) holding only the Orientation tag. */
export function orientationTiff(orientation: number): Uint8Array {
  // prettier-ignore
  return new Uint8Array([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian, IFD0 at 8
    0x00, 0x01,                                     // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, // Orientation, SHORT, 1
    0x00, orientation, 0x00, 0x00,                  // its value
    0x00, 0x00, 0x00, 0x00,                         // no next IFD
  ]);
}

/** Exif's turns and flips: 2 to 8 change how the picture is shown. */
export const isTurned = (orientation: number) =>
  Number.isInteger(orientation) && orientation >= 2 && orientation <= 8;

/** A marker segment around a payload. */
function segment(marker: number, payload: Uint8Array | number[]): Uint8Array {
  const length = payload.length + 2;
  return new Uint8Array([0xff, marker, length >> 8, length & 0xff, ...payload]);
}

const EXIF_HEAD = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

/** JFIF's version, density and units, with no thumbnail: 14 bytes. */
function jfifPayload(b: Uint8Array, s: Segment): Uint8Array {
  const payload = b.slice(s.body, s.body + 14);
  payload[12] = 0;
  payload[13] = 0;
  return payload;
}

/** Adobe's segment as decoders read it: its version (100), no flags, and
 * the one byte they use, how the colours were stored (needed for CMYK). */
function adobePayload(b: Uint8Array, s: Segment): Uint8Array {
  const payload = new Uint8Array(12);
  payload.set(b.subarray(s.body, s.body + 5)); // "Adobe"
  payload[6] = 100;
  payload[11] = b[s.body + 11] ?? 0;
  return payload;
}

/** Whether a picture segment is exactly as long as its content says.
 * Decoders refuse one that isn't, so nothing can sit at its end. */
function fits(b: Uint8Array, s: Segment): boolean {
  const { marker, body } = s;
  const end = s.scan ?? s.end;
  const length = end - body;
  const at = (n: number) => b[body + n] ?? 0;
  if (marker === SOS) return length >= 1 && length === 4 + 2 * at(0);
  if (marker === DRI) return length === 2;
  if (marker === EXP) return length === 1;
  if (marker === DAC) return length > 0 && length % 2 === 0;
  if (marker === DQT) {
    let i = body;
    while (i < end) i += 1 + ((b[i] ?? 0) >> 4 ? 128 : 64);
    return length > 0 && i === end;
  }
  if (marker === DHT) {
    let i = body;
    while (i + 17 <= end) {
      let values = 0;
      for (let k = 1; k <= 16; k++) values += b[i + k] ?? 0;
      i += 17 + values;
    }
    return length > 0 && i === end;
  }
  // A frame header (SOFn, or DHP): 6 bytes and 3 for each component.
  return length >= 6 && length === 6 + 3 * at(5);
}

/** The AI label's segments: APP11 before the first scan, the JPEG XT
 * boxes of the one instance whose first box is a C2PA manifest store (as
 * c2pa/locate.ts finds the label). Any other JUMBF is metadata. */
function labelSegments(b: Uint8Array, list: Segment[]): Set<Segment> {
  const out = new Set<Segment>();
  let instance: number | null = null;
  for (const s of list) {
    if (s.late || s.marker !== APP11) continue;
    instance ??= c2paInstance(b, s.body);
    if (
      instance !== null &&
      s.body + 4 <= s.end &&
      startsWith(b, s.body, "JP") &&
      (((b[s.body + 2] ?? 0) << 8) | (b[s.body + 3] ?? 0)) === instance
    ) {
      out.add(s);
    }
  }
  return out;
}

const isIcc = (b: Uint8Array, s: Segment) =>
  s.marker === APP2 && startsWith(b, s.body, ICC);

/** The colour profile decoders read: the APP2 pieces before the first
 * scan, numbered 1 to their count, each once. Null when there's none, or
 * the pieces don't add up (decoders then use none). */
function iccPieces(b: Uint8Array, list: Segment[]): Segment[] | null {
  const pieces = list.filter((s) => !s.late && isIcc(b, s));
  const count = pieces.length;
  if (!count) return null;
  const sorted: Segment[] = [];
  for (const s of pieces) {
    if (s.end - s.body < 14) return null;
    const n = b[s.body + 12] ?? 0;
    if (b[s.body + 13] !== count || n < 1 || n > count || sorted[n - 1]) {
      return null;
    }
    sorted[n - 1] = s;
  }
  return sorted;
}

/** The profile, cleaned, from its pieces; null when it isn't one. */
function iccProfile(b: Uint8Array, pieces: Segment[]): Uint8Array | null {
  return cleanIcc(join(pieces.map((s) => b.subarray(s.body + 14, s.end))));
}

/** A profile as APP2 segments, as many as it takes. */
function iccSegments(profile: Uint8Array): Uint8Array[] {
  const count = Math.ceil(profile.length / ICC_PIECE);
  return Array.from({ length: count }, (_, n) =>
    segment(APP2, [
      ...new TextEncoder().encode(ICC),
      n + 1,
      count,
      ...profile.subarray(n * ICC_PIECE, (n + 1) * ICC_PIECE),
    ]),
  );
}

/** What a clean copy keeps besides the picture: the label's segments,
 * an XMP packet holding only the source type (kept whole), and, for a
 * picture with a gain map or for the gain map itself, what draws it. */
interface Keeping {
  labels: Set<Segment>;
  source?: Segment | undefined;
  /** Keep ISO 21496-1's gain map block, and the gain map's own XMP
   * written anew from its values (gain-map.ts). */
  gainMap?: boolean;
  /** Keep the profile and Adobe's segment as they are (options.ts). */
  asIs?: boolean;
  /** An Exif segment holding only technical tags, kept as it is (with
   * `asIs`): it already holds any turn. */
  technical?: Segment | undefined;
  /** Keep every block tellall reads as it is (options.ts). */
  read?: boolean;
  /** The MPF segment, kept as it is (with `asIs`). */
  mpf?: Segment | undefined;
}

const EXIF = "Exif\0\0";
const isExif = (b: Uint8Array, s: Segment) =>
  s.marker === APP1 && startsWith(b, s.body, EXIF);
const isXmp = (b: Uint8Array, s: Segment) =>
  s.marker === APP1 && startsWith(b, s.body, XMP);
/** The blocks image/read.ts reads: Exif, XMP (extended too), Photoshop's
 * IPTC, comments. */
const isRead = (b: Uint8Array, s: Segment) =>
  (s.marker === APP1 &&
    (startsWith(b, s.body, EXIF) ||
      startsWith(b, s.body, "http://ns.adobe.com/xap/1.0/\0") ||
      startsWith(b, s.body, "http://ns.adobe.com/xmp/extension/\0"))) ||
  (s.marker === 0xed && startsWith(b, s.body, "Photoshop 3.0\0")) ||
  s.marker === 0xfe;

const NOTHING: Keeping = { labels: new Set() };

/** What a segment's content becomes in the clean copy (marker and length
 * aside): itself, a payload written anew, or null to drop it. The colour
 * profile isn't decided here. */
function keep(
  b: Uint8Array,
  s: Segment,
  first: boolean,
  keeping: Keeping = NOTHING,
): "whole" | Uint8Array | null {
  const { marker, body, end } = s;
  if (marker === SOS || TABLES.has(marker)) return fits(b, s) ? "whole" : null;
  if (keeping.labels.has(s) || keeping.source === s) return "whole";
  if (keeping.technical === s || keeping.mpf === s) return "whole";
  if (keeping.read && isRead(b, s)) return "whole";
  // JFIF only as the first segment, where it belongs.
  if (marker === APP0 && first && end - body >= 14) {
    if (startsWith(b, body, "JFIF\0")) return jfifPayload(b, s);
  }
  if (marker === APP14 && !s.late && end - body >= 12) {
    if (startsWith(b, body, "Adobe")) {
      return keeping.asIs && end - body === 12 ? "whole" : adobePayload(b, s);
    }
  }
  if (keeping.gainMap && !s.late) {
    // ISO 21496-1's block holds only numbers: a version, or the gain
    // map's values.
    if (isIso(b, s) && end - body <= ISO.length + ISO_MOST) return "whole";
    if (marker === APP1 && startsWith(b, body, XMP)) {
      const packet = gainMapPacket(b.subarray(body + XMP.length, end));
      if (packet && keeping.asIs) return "whole";
      return packet && join([new TextEncoder().encode(XMP), packet]);
    }
  }
  return null;
}

const isIso = (b: Uint8Array, s: Segment) =>
  s.marker === APP2 && startsWith(b, s.body, ISO);

/** Whether a JPEG is an HDR gain map: it carries ISO 21496-1's block or a
 * gain map's XMP. */
function isGainMap(b: Uint8Array, list: Segment[]): boolean {
  return list.some(
    (s) =>
      !s.late &&
      (isIso(b, s) ||
        (s.marker === APP1 &&
          startsWith(b, s.body, XMP) &&
          gainMapPacket(b.subarray(s.body + XMP.length, s.end)) !== null)),
  );
}

/** A gain map stored after the picture (Ultra HDR), cleaned on its own;
 * null when it isn't one, or can't be cleaned. */
function cleanGainMap(b: Uint8Array, opts: CleanOptions): Uint8Array | null {
  try {
    const { list } = segments(b);
    if (!list.some((s) => s.marker === SOS) || !isGainMap(b, list)) {
      return null;
    }
    const keeping = {
      ...keepingFor(b, list, { keepLabels: false, ...asIsOf(opts) }),
      gainMap: true,
    };
    return join(parts(b, list, 1, undefined, keeping));
  } catch {
    return null;
  }
}

/** The extra pictures a JPEG's MPF lists that are gain maps, cleaned. */
function gainMaps(b: Uint8Array, list: Segment[], opts: CleanOptions) {
  const images: MpImage[] = [];
  const bytes: Uint8Array[] = [];
  for (const image of mpfOf(b, list)?.extra ?? []) {
    const clean = cleanGainMap(
      b.subarray(image.offset, image.offset + image.length),
      opts,
    );
    if (!clean) continue;
    images.push({ ...image, length: clean.length });
    bytes.push(clean);
  }
  return { images, bytes };
}

/** How many HDR gain maps a JPEG carries: those its MPF lists, else one
 * right after its end. */
export function gainMapCount(b: Uint8Array): number {
  const isOne = (sub: Uint8Array) => {
    try {
      return isGainMap(sub, segments(sub).list);
    } catch {
      return false;
    }
  };
  try {
    const { list, end } = segments(b);
    const listed = (mpfOf(b, list)?.extra ?? []).filter((image) =>
      isOne(b.subarray(image.offset, image.offset + image.length)),
    ).length;
    if (listed || b[end] !== 0xff || b[end + 1] !== SOI) return listed;
    return isOne(b.subarray(end)) ? 1 : 0;
  } catch {
    return 0;
  }
}

/** The clean copy's segments, from SOI to EOI. `source` is the source type
 * to carry in a minimal XMP packet, unless a packet holding only it is
 * kept whole; `extra` is a segment to add with the turn (the MPF). */
function parts(
  b: Uint8Array,
  list: Segment[],
  orientation: number,
  source: string | undefined,
  keeping: Keeping,
  extra?: Uint8Array,
): Uint8Array[] {
  const pieces = iccPieces(b, list);
  const profile = pieces && iccProfile(b, pieces);
  const firstIcc = list.find((s) => isIcc(b, s));
  const kept: Uint8Array[] = [b.subarray(0, 2)];
  let afterJfif = 1;
  list.forEach((s, n) => {
    // The profile, written anew where its first piece was.
    if (isIcc(b, s)) {
      if (keeping.asIs) {
        if (profile && pieces.includes(s))
          kept.push(b.subarray(s.start, s.end));
      } else if (profile && s === firstIcc) kept.push(...iccSegments(profile));
      return;
    }
    const part = keep(b, s, n === 0, keeping);
    if (!part) return;
    kept.push(
      part === "whole" ? b.subarray(s.start, s.end) : segment(s.marker, part),
    );
    if (s.marker === APP0) afterJfif = kept.length;
  });
  const added: Uint8Array[] = [];
  // Exif or XMP kept as it is already says what the added ones would.
  const exifKept =
    keeping.technical || (keeping.read && list.some((s) => isExif(b, s)));
  const xmpKept = keeping.read && list.some((s) => isXmp(b, s));
  if (isTurned(orientation) && !exifKept) {
    added.push(segment(APP1, [...EXIF_HEAD, ...orientationTiff(orientation)]));
  }
  if (source !== undefined && !keeping.source && !xmpKept) {
    const payload = join([
      new TextEncoder().encode(XMP),
      minimalXmpBytes(source),
    ]);
    // One segment holds at most 65,533 bytes; a longer value isn't one.
    if (payload.length <= 0xffff - 2) added.push(segment(APP1, payload));
  }
  if (extra) added.push(extra);
  kept.splice(afterJfif, 0, ...added);
  // The end marker, always: after a file cut short too.
  kept.push(new Uint8Array([0xff, EOI]));
  return kept;
}

export function stripJpeg(
  b: Uint8Array,
  orientation: number,
  opts: CleanOptions = KEEP_LABELS,
): Uint8Array {
  const { list } = segments(b);
  if (!list.some((s) => s.marker === SOS)) {
    throw new Error("The JPEG ends before its picture starts.");
  }
  const source = sourceType(opts);
  const keeping = keepingFor(b, list, opts);
  const maps = gainMaps(b, list, opts);
  if (!maps.images.length) {
    return join(parts(b, list, orientation, source, keeping));
  }
  // With a gain map: its block in the picture kept too, a new MPF listing
  // the picture and its gain maps, and the gain maps after the end.
  keeping.gainMap = true;
  if (keeping.asIs) {
    // Nothing moved: the MPF as it is still points where it did.
    keeping.mpf = mpfOf(b, list)?.segment;
    return join([
      ...parts(b, list, orientation, source, keeping),
      ...maps.bytes,
    ]);
  }
  const primary = mpfOf(b, list)?.primary ?? 0;
  const all = (length: number, tiff: number): MpImage[] => {
    let at = length;
    return [
      { attribute: primary, offset: 0, length },
      ...maps.images.map((image) => {
        const placed = { ...image, offset: at - tiff };
        at += image.length;
        return placed;
      }),
    ];
  };
  const placeholder = segment(APP2, mpfPayload(all(0, 0)));
  const kept = parts(b, list, orientation, source, keeping, placeholder);
  const index = kept.indexOf(placeholder);
  const before = kept.slice(0, index).reduce((n, p) => n + p.length, 0);
  const length = kept.reduce((n, p) => n + p.length, 0);
  // Offsets count from the MPF's TIFF header: after the marker, the
  // length and "MPF\0".
  kept[index] = segment(APP2, mpfPayload(all(length, before + 8)));
  return join([...kept, ...maps.bytes]);
}

/** Only what options.ts says about keeping as it is. */
const asIsOf = (opts: CleanOptions) => ({
  ...(opts.drawnAsIs ? { drawnAsIs: true } : {}),
  ...(opts.keepRead ? { keepRead: true } : {}),
});

/** What a clean copy of this JPEG keeps besides the picture. */
function keepingFor(
  b: Uint8Array,
  list: Segment[],
  opts: CleanOptions,
): Keeping {
  const source = sourceType(opts);
  const asIs = opts.drawnAsIs === true || opts.keepRead === true;
  return {
    asIs,
    read: opts.keepRead === true,
    technical: asIs
      ? list.find(
          (s) =>
            !s.late &&
            isExif(b, s) &&
            technicalOnly(b.subarray(s.body + EXIF.length, s.end)),
        )
      : undefined,
    labels: opts.keepLabels ? labelSegments(b, list) : new Set(),
    source:
      source === undefined
        ? undefined
        : list.find(
            (s) =>
              !s.late &&
              s.marker === APP1 &&
              startsWith(b, s.body, XMP) &&
              sourceOnly(b.subarray(s.body + XMP.length, s.end)) === source,
          ),
  };
}

/** A JPEG cleaned without moving a byte, for one stored inside another
 * file (a HEIC's JPEG item): each segment a clean copy would drop keeps
 * its marker and length but holds only zeros; JFIF loses its thumbnail,
 * Adobe's segment its flags, the profile its words (icc.ts); bytes between
 * segments, and a segment cut off by the file's end, become fill (0xFF),
 * and whatever follows the end marker, zeros. A file that isn't a JPEG
 * with a picture comes back as zeros. */
export function cleanJpegInPlace(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(b.length);
  let parsed: ReturnType<typeof segments>;
  try {
    parsed = segments(b);
  } catch {
    return out;
  }
  const { list, ended } = parsed;
  if (!list.some((s) => s.marker === SOS)) return out;
  out.set(b);
  // Between segments: fill bytes, which decoders skip.
  let reach = 2;
  for (const s of list) {
    out.fill(0xff, reach, s.start);
    reach = s.end;
  }
  if (ended) {
    // Fill up to the end marker (only fill and stray bytes come before
    // it), then nothing after it. The marker is the pair FF D9: a stray
    // 0xD9 on its own isn't it.
    let eoi = reach + 1;
    while (eoi < b.length && (b[eoi - 1] !== 0xff || b[eoi] !== EOI)) eoi++;
    out.fill(0xff, reach, eoi);
    out.fill(0, eoi + 1);
  } else {
    // Cut short: what's after the last whole segment is a segment cut off
    // (a comment, Exif, words of any kind), a marker's first bytes, or
    // stray bytes. It becomes fill too. None of it is picture: a scan's
    // data runs up to the next marker, or to the end, inside its segment.
    out.fill(0xff, reach);
  }
  list.forEach((s, n) => {
    if (isIcc(b, s)) return;
    const part = keep(b, s, n === 0);
    if (part === "whole") return;
    out.fill(0, s.body, s.end);
    if (part) out.set(part.subarray(0, s.end - s.body), s.body);
  });
  // The profile, cleaned, over its own pieces in order; or none at all.
  const pieces = iccPieces(b, list);
  const profile = pieces && iccProfile(b, pieces);
  for (const s of list.filter((x) => isIcc(b, x))) {
    if (!profile || !pieces?.includes(s)) out.fill(0, s.body, s.end);
  }
  if (profile && pieces) {
    let at = 0;
    for (const s of pieces) {
      out.fill(0, s.body + 14, s.end);
      out.set(profile.subarray(at, at + s.end - s.body - 14), s.body + 14);
      at += s.end - s.body - 14;
    }
  }
  return out;
}

export function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
