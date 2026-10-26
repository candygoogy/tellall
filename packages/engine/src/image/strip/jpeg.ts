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
// index of extra pictures (MPF) along with those pictures after the end,
// Photoshop's IPTC (APP13), comments (COM), the number of lines (DNL,
// which decoders don't use), and any segment this list doesn't name. A
// photo turned by its Exif gets a minimal Exif back that holds only that
// turn. A JPEG cut short keeps what's there of its picture and gets its
// end marker back.
//
// An AI label (Content Credentials, C2PA) is APP11 segments holding JUMBF
// boxes, each with "jumb" in its first 64 bytes (a label split over
// several segments repeats its box header in each). With labels kept they
// all stay, byte for byte, where they were; removed, they all go. With
// labels kept and a DigitalSourceType given, an APP1 XMP packet holding
// only that comes back too (xmp-min.ts), after JFIF and the turn.
import { ascii, startsWith } from "../../bytes.ts";
import { cleanIcc } from "../icc.ts";
import { minimalXmpBytes } from "../xmp-min.ts";
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
const XMP = "http://ns.adobe.com/xap/1.0/\0";
/** How far into an APP11 segment a label's "jumb" may sit. */
const LABEL_REACH = 64;
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
export function segments(b: Uint8Array): { list: Segment[]; ended: boolean } {
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
    if (marker === EOI) return { list, ended: true };
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
  return { list, ended: false };
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

/** An AI label's segment: APP11 with a JUMBF box ("jumb") near its start. */
const isLabel = (b: Uint8Array, s: Segment) =>
  s.marker === APP11 &&
  ascii(b, s.body, Math.min(s.end, s.body + LABEL_REACH)).includes("jumb");

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

/** What a segment's content becomes in the clean copy (marker and length
 * aside): itself, a payload written anew, or null to drop it. The colour
 * profile isn't decided here, and a label is kept only when `labels`. */
function keep(
  b: Uint8Array,
  s: Segment,
  first: boolean,
  labels = false,
): "whole" | Uint8Array | null {
  const { marker, body, end } = s;
  if (marker === SOS || TABLES.has(marker)) return fits(b, s) ? "whole" : null;
  if (labels && isLabel(b, s)) return "whole";
  // JFIF only as the first segment, where it belongs.
  if (marker === APP0 && first && end - body >= 14) {
    if (startsWith(b, body, "JFIF\0")) return jfifPayload(b, s);
  }
  if (marker === APP14 && !s.late && end - body >= 12) {
    if (startsWith(b, body, "Adobe")) return adobePayload(b, s);
  }
  return null;
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
  const pieces = iccPieces(b, list);
  const profile = pieces && iccProfile(b, pieces);
  const firstIcc = list.find((s) => isIcc(b, s));
  const kept: Uint8Array[] = [b.subarray(0, 2)];
  let afterJfif = 1;
  list.forEach((s, n) => {
    // The profile, written anew where its first piece was.
    if (isIcc(b, s)) {
      if (profile && s === firstIcc) kept.push(...iccSegments(profile));
      return;
    }
    const part = keep(b, s, n === 0, opts.keepLabels);
    if (!part) return;
    kept.push(
      part === "whole" ? b.subarray(s.start, s.end) : segment(s.marker, part),
    );
    if (s.marker === APP0) afterJfif = kept.length;
  });
  const added: Uint8Array[] = [];
  if (isTurned(orientation)) {
    added.push(segment(APP1, [...EXIF_HEAD, ...orientationTiff(orientation)]));
  }
  const source = sourceType(opts);
  if (source !== undefined) {
    const payload = join([
      new TextEncoder().encode(XMP),
      minimalXmpBytes(source),
    ]);
    // One segment holds at most 65,533 bytes; a longer value isn't one.
    if (payload.length <= 0xffff - 2) added.push(segment(APP1, payload));
  }
  kept.splice(afterJfif, 0, ...added);
  // The end marker, always: after a file cut short too.
  kept.push(new Uint8Array([0xff, EOI]));
  return join(kept);
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
