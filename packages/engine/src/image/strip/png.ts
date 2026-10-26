// A clean PNG keeps only the chunks a picture needs to be drawn (an
// allowlist): its header, palette, data and end, transparency, colour
// (gamma, chromaticities, sRGB, ICC profile, cICP and HDR levels),
// significant bits, background, pixel size, and the frames of an
// animation. Everything else goes, known or not: Exif (eXIf, and the
// unofficial exIf and zxIf), text of every kind (tEXt, zTXt, iTXt, where
// XMP lives too), the time (tIME), and anything after the end.
//
// An AI label (Content Credentials, C2PA) is a caBX chunk. With labels
// kept it stays, byte for byte, where it was; removed, it goes. With
// labels kept and a DigitalSourceType given, an iTXt XMP chunk
// (XML:com.adobe.xmp) holding only that comes back too (xmp-min.ts),
// right after the header and the turn.
//
// A kept chunk is kept only as decoders read it, so nothing can hide in
// one: at its own size (pHYs is 9 bytes, gAMA 4, and so on), once when
// there can only be one, before the picture's data when it belongs there,
// with a checksum that matches; the data in one unbroken run; animation
// frames only in an animation. Those stay byte for byte, checksums
// included. The ICC profile is cleaned (icc.ts) and named just "icc".
// A turned picture gets an Exif chunk back that holds only the turn,
// right after the header. A PNG cut short keeps its whole chunks and gets
// its end chunk back.
import { Unzlib, zlibSync } from "fflate";
import { cleanIcc } from "../icc.ts";
import { crc32 } from "../crc32.ts";
import { minimalXmpBytes } from "../xmp-min.ts";
import { isTurned, join, orientationTiff } from "./jpeg.ts";
import { KEEP_LABELS, sourceType, type CleanOptions } from "./options.ts";

const LABEL = "caBX";
/** An iTXt chunk's start for XMP: its keyword, uncompressed, no language
 * and no translated keyword. */
const XMP_HEAD = "XML:com.adobe.xmp\0\0\0\0\0";

const KEEP = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "tRNS",
  "cHRM",
  "gAMA",
  "iCCP",
  "sBIT",
  "sRGB",
  "cICP",
  "mDCV",
  "cLLI",
  "bKGD",
  "pHYs",
  "acTL",
  "fcTL",
  "fdAT",
]);
/** Chunks a PNG holds at most one of: decoders read the first. */
const ONCE = new Set([
  "IHDR",
  "PLTE",
  "tRNS",
  "cHRM",
  "gAMA",
  "iCCP",
  "sBIT",
  "sRGB",
  "cICP",
  "mDCV",
  "cLLI",
  "bKGD",
  "pHYs",
  "acTL",
]);
/** Chunks of one size. */
const SIZE: Record<string, number> = {
  IHDR: 13,
  cHRM: 32,
  gAMA: 4,
  sRGB: 1,
  cICP: 4,
  mDCV: 24,
  cLLI: 8,
  pHYs: 9,
  acTL: 8,
  fcTL: 26,
};
/** Chunks whose size follows the colour type (0, 2, 3, 4 or 6). */
const BY_COLOUR: Record<string, Record<number, number>> = {
  sBIT: { 0: 1, 2: 3, 3: 3, 4: 2, 6: 4 },
  bKGD: { 0: 2, 2: 6, 3: 1, 4: 2, 6: 6 },
  tRNS: { 0: 2, 2: 6 },
};
const SIGNATURE = 8;
/** The largest profile inflated (as libpng allows). */
const LARGEST_PROFILE = 8 << 20;

export interface Chunk {
  type: string;
  /** The chunk's first byte (its length), its data and its end. */
  start: number;
  data: number;
  end: number;
}

/** The PNG's whole chunks, up to IEND or where the file is cut short. */
export function chunks(b: Uint8Array): { list: Chunk[]; ended: boolean } {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const list: Chunk[] = [];
  for (let i = SIGNATURE; i + 12 <= b.length;) {
    const end = i + 12 + view.getUint32(i);
    if (end > b.length) break;
    const type = String.fromCharCode(...b.subarray(i + 4, i + 8));
    if (type === "IEND") return { list, ended: true };
    list.push({ type, start: i, data: i + 8, end });
    i = end;
  }
  return { list, ended: false };
}

/** Whether a chunk's checksum matches what it holds. */
function checks(b: Uint8Array, c: Chunk): boolean {
  const stored = new DataView(b.buffer, b.byteOffset).getUint32(c.end - 4);
  return crc32(b.subarray(c.start + 4, c.end - 4)) === stored;
}

/** Inflated zlib data, or null when it's broken or too large. */
function inflated(data: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [];
  let total = 0;
  let done = false;
  try {
    const stream = new Unzlib((part, final) => {
      total += part.length;
      if (total > LARGEST_PROFILE) throw new Error("Too large.");
      parts.push(part);
      done ||= final;
    });
    stream.push(data, true);
  } catch {
    return null;
  }
  return done ? join(parts) : null;
}

/** The ICC profile chunk, cleaned, its name "icc"; null when its profile
 * can't be read (decoders then ignore it too). */
function iccChunk(data: Uint8Array): Uint8Array | null {
  const zero = data.indexOf(0);
  if (zero < 1 || zero > 79 || data[zero + 1] !== 0) return null;
  const profile = inflated(data.subarray(zero + 2));
  const clean = profile && cleanIcc(profile);
  if (!clean) return null;
  const name = [0x69, 0x63, 0x63, 0, 0]; // "icc", its end, deflate
  return pngChunk("iCCP", join([new Uint8Array(name), zlibSync(clean)]));
}

export function stripPng(
  b: Uint8Array,
  orientation = 1,
  opts: CleanOptions = KEEP_LABELS,
): Uint8Array {
  const source = sourceType(opts);
  const { list } = chunks(b);
  const [ihdr] = list;
  if (ihdr?.type !== "IHDR" || !list.some((c) => c.type === "IDAT")) {
    throw new Error("The PNG ends before its picture does.");
  }
  const colour = b[ihdr.data + 9] ?? 0;
  const firstData = list.findIndex((c) => c.type === "IDAT");
  const palette = list.find((c, n) => c.type === "PLTE" && n < firstData);
  const entries = palette ? (palette.end - 12 - palette.start) / 3 : 0;
  const animated = list.some(
    (c, n) => c.type === "acTL" && n < firstData && c.end - c.start === 20,
  );
  const seen = new Set<string>();
  let dataEnded = false;
  const kept: Uint8Array[] = [b.subarray(0, SIGNATURE)];
  list.forEach((c, n) => {
    const { type } = c;
    const size = c.end - c.start - 12;
    // The picture's data: one unbroken run, as decoders read it.
    if (n > firstData && list[n - 1]?.type !== "IDAT") dataEnded = true;
    if (type === LABEL) {
      if (opts.keepLabels) kept.push(b.subarray(c.start, c.end));
      return;
    }
    if (!KEEP.has(type)) return;
    if (type === "IDAT") {
      if (!dataEnded) kept.push(b.subarray(c.start, c.end));
      return;
    }
    if (ONCE.has(type)) {
      if (seen.has(type)) return;
      seen.add(type);
    }
    // Only a frame's own chunks come after the data; frames only in an
    // animation.
    const late = n > firstData;
    if (type === "fcTL" || type === "fdAT") {
      if (!animated || (type === "fdAT" && (!late || size < 4))) return;
    } else if (late) return;
    const expected = SIZE[type] ?? BY_COLOUR[type]?.[colour];
    if (expected !== undefined && size !== expected) {
      if (!(type === "tRNS" && colour === 3)) return;
    }
    if (type === "tRNS" && colour === 3 && (size < 1 || size > entries)) return;
    if (type === "tRNS" && (colour === 4 || colour === 6)) return;
    if (type === "PLTE" && (size % 3 || size < 3 || size > 768)) return;
    if (type !== "fdAT" && type !== "IHDR" && !checks(b, c)) return;
    if (type === "iCCP") {
      const icc = iccChunk(b.subarray(c.data, c.end - 4));
      if (icc) kept.push(icc);
      return;
    }
    kept.push(b.subarray(c.start, c.end));
    if (type === "IHDR" && isTurned(orientation)) {
      kept.push(pngChunk("eXIf", orientationTiff(orientation)));
    }
    if (type === "IHDR" && source !== undefined) {
      const head = new TextEncoder().encode(XMP_HEAD);
      kept.push(pngChunk("iTXt", join([head, minimalXmpBytes(source)])));
    }
  });
  kept.push(pngChunk("IEND", new Uint8Array(0)));
  return join(kept);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
