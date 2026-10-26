// A clean WebP is always written anew from the chunks a picture needs (an
// allowlist), each only as decoders read it:
// - the picture (VP8 or VP8L, the first one) and its alpha (ALPH, right
//   before a VP8 picture);
// - the extended header (VP8X): its 10 bytes, its reserved bits zeroed,
//   its flags saying only what the clean copy holds;
// - the colour profile (ICCP), when the header flags it (browsers ignore
//   it otherwise), cleaned (icc.ts);
// - in an animation, its header (ANIM, 6 bytes) and each frame (ANMF),
//   with only one picture and its alpha inside.
// Everything else goes: EXIF, XMP, a second picture, any chunk this list
// doesn't name, and every byte after the size the file declares. The RIFF
// size is written for what's left. A turned picture gets an EXIF chunk
// back that holds only the turn, flagged in VP8X again.
//
// An AI label (Content Credentials, C2PA) is a C2PA chunk. With labels
// kept it stays, its content byte for byte, after the picture and its
// metadata; removed, it goes. With labels kept and a DigitalSourceType
// given, an XMP chunk holding only that comes back too (xmp-min.ts),
// flagged in VP8X (a file without VP8X can't carry one); one the file
// already has that holds only it keeps its content as it is.
import { cleanIcc } from "../icc.ts";
import { technicalOnly } from "../technical.ts";
import { minimalXmpBytes, sourceOnly } from "../xmp-min.ts";
import { isTurned, join, orientationTiff } from "./jpeg.ts";
import { KEEP_LABELS, sourceType, type CleanOptions } from "./options.ts";

// VP8X flags: animation, XMP, Exif, alpha, ICC profile. Its other bits
// are reserved.
const ANIMATION = 0x02;
const XMP_FLAG = 0x04;
const EXIF_FLAG = 0x08;
const ALPHA = 0x10;
const ICC_FLAG = 0x20;
const VP8X_SIZE = 10;
const ANIM_SIZE = 6;
// An animation frame: where it goes, its size and timing, then its chunks.
const FRAME_HEADER = 16;
// A frame's flags byte: how it's blended and disposed of (2 bits).
const FRAME_FLAGS = 0x03;

export interface Chunk {
  type: string;
  start: number;
  /** Its content, and where the next chunk starts (after any padding). */
  body: number;
  size: number;
  next: number;
}

/** The chunks from `from` to `to`. Throws when one runs past `to`. */
export function chunks(b: Uint8Array, from: number, to: number): Chunk[] {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const list: Chunk[] = [];
  for (let i = from; i + 8 <= to;) {
    const size = view.getUint32(i + 4, true);
    const next = i + 8 + size + (size % 2);
    // A last chunk may leave out its padding byte.
    if (i + 8 + size > to) throw new Error("The WebP ends early.");
    const type = String.fromCharCode(...b.subarray(i, i + 4));
    list.push({ type, start: i, body: i + 8, size, next });
    i = next;
  }
  return list;
}

/** The size the file declares, as the end of its chunks. */
export const declaredEnd = (b: Uint8Array) =>
  Math.min(
    b.length,
    8 + new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(4, true),
  );

/** A chunk with this type and content, padded to an even length. */
function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length + (body.length % 2));
  for (let i = 0; i < 4; i++) out[i] = type.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}

const body = (b: Uint8Array, c: Chunk) => b.subarray(c.body, c.body + c.size);

/** A picture as decoders take it from these chunks: the first VP8 or VP8L,
 * and the alpha right before it when it's a VP8. */
function picture(b: Uint8Array, list: Chunk[]): Uint8Array[] {
  const at = list.findIndex((c) => c.type === "VP8 " || c.type === "VP8L");
  const image = list[at];
  if (!image) return [];
  const alpha = list[at - 1];
  const out = [chunk(image.type, body(b, image))];
  if (image.type === "VP8 " && alpha?.type === "ALPH") {
    out.unshift(chunk("ALPH", body(b, alpha)));
  }
  return out;
}

/** A frame with its header (reserved bits zeroed) and one picture. */
function frame(b: Uint8Array, c: Chunk): Uint8Array {
  if (c.size < FRAME_HEADER) throw new Error("A WebP frame ends early.");
  const head = b.slice(c.body, c.body + FRAME_HEADER);
  head[FRAME_HEADER - 1] = (head[FRAME_HEADER - 1] ?? 0) & FRAME_FLAGS;
  const inner = chunks(b, c.body + FRAME_HEADER, c.body + c.size);
  return chunk("ANMF", join([head, ...picture(b, inner)]));
}

export function stripWebp(
  b: Uint8Array,
  orientation = 1,
  opts: CleanOptions = KEEP_LABELS,
): Uint8Array {
  const list = chunks(b, 12, declaredEnd(b));
  const header = list[0]?.type === "VP8X" ? list[0] : undefined;
  const flags = header ? (b[header.body] ?? 0) : 0;
  const animated = (flags & ANIMATION) !== 0;
  // Frames count only in a file flagged animated; otherwise the picture
  // is the VP8 or VP8L at the top.
  if (!list.some((c) => c.type === "VP8 " || c.type === "VP8L")) {
    if (!animated || !list.some((c) => c.type === "ANMF")) {
      throw new Error("The WebP has no picture.");
    }
  }
  // A turn can only be carried where there's a VP8X header to flag it.
  const turn = isTurned(orientation) && header !== undefined;
  const iccChunk = flags & ICC_FLAG && list.find((c) => c.type === "ICCP");
  const cleanProfile = iccChunk ? cleanIcc(body(b, iccChunk)) : null;
  const profile =
    iccChunk && cleanProfile && opts.drawnAsIs
      ? body(b, iccChunk)
      : cleanProfile;
  const anim = animated && list.find((c) => c.type === "ANIM");
  const source = header && sourceType(opts);
  const labels = opts.keepLabels ? list.filter((c) => c.type === "C2PA") : [];
  // Kept as they are only to tell whether there's anything to remove
  // (options.ts): Exif with only technical tags, or every block read.
  const exifBody = (c: Chunk) => {
    const x = body(b, c);
    return x[0] === 0x45 && x[1] === 0x78 && x[2] === 0x69 && x[3] === 0x66
      ? x.subarray(6)
      : x;
  };
  const read = opts.keepRead === true && header !== undefined;
  const ownExif = header
    ? list.filter(
        (c) =>
          c.type === "EXIF" &&
          (read || (opts.drawnAsIs && technicalOnly(exifBody(c)))),
      )
    : [];
  const ownXmp = read ? list.filter((c) => c.type === "XMP ") : [];

  const kept: Uint8Array[] = [];
  if (header) {
    if (header.size < VP8X_SIZE) throw new Error("The WebP's header is short.");
    const vp8x = b.slice(header.body, header.body + VP8X_SIZE);
    vp8x[0] =
      (flags & (ANIMATION | ALPHA)) |
      (profile ? ICC_FLAG : 0) |
      (turn || ownExif.length ? EXIF_FLAG : 0) |
      (source !== undefined || ownXmp.length ? XMP_FLAG : 0);
    vp8x.fill(0, 1, 4);
    kept.push(chunk("VP8X", vp8x));
  }
  if (profile) kept.push(chunk("ICCP", profile));
  if (anim && anim.size >= ANIM_SIZE) {
    kept.push(chunk("ANIM", b.subarray(anim.body, anim.body + ANIM_SIZE)));
  }
  if (animated) {
    for (const c of list) if (c.type === "ANMF") kept.push(frame(b, c));
  } else kept.push(...picture(b, list));
  for (const c of ownExif) kept.push(chunk("EXIF", body(b, c)));
  if (turn && !ownExif.length) {
    kept.push(chunk("EXIF", orientationTiff(orientation)));
  }
  for (const c of ownXmp) kept.push(chunk("XMP ", body(b, c)));
  if (source !== undefined && !ownXmp.length) {
    const own = list.find(
      (c) => c.type === "XMP " && sourceOnly(body(b, c)) === source,
    );
    kept.push(chunk("XMP ", own ? body(b, own) : minimalXmpBytes(source)));
  }
  for (const c of labels) kept.push(chunk("C2PA", body(b, c)));
  const out = join([b.subarray(0, 12), ...kept]);
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return out;
}
