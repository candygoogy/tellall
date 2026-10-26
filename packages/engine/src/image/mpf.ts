// A JPEG's index of extra pictures (MPF, CIPA DC-007): an APP2 segment
// before the first scan, holding a TIFF block whose MPEntry lists each
// picture's size and where it starts. The first is the JPEG itself; the
// others sit after its end: an HDR gain map (Ultra HDR, ISO 21496-1), a
// large preview, a depth map. Only what can be followed is listed: at most
// a few pictures, each inside the file and starting as a JPEG does.
import { startsWith } from "../bytes.ts";
import type { Segment } from "./strip/jpeg.ts";

export interface MpImage {
  /** MPEntry's attribute (flags and the picture's type). */
  attribute: number;
  /** From the start of the file. */
  offset: number;
  length: number;
}

export interface Mpf {
  segment: Segment;
  /** The first picture's attribute (this JPEG's own). */
  primary: number;
  /** The pictures after the first, in MPEntry's order. */
  extra: MpImage[];
}

const MPF = "MPF\0";
const MP_ENTRY = 0xb002;
/** The most pictures followed: phones store two or three. */
const MOST = 8;

/** The index, from the JPEG's segments; null when there's none, or it
 * doesn't add up. */
export function mpfOf(b: Uint8Array, list: Segment[]): Mpf | null {
  const segment = list.find(
    (s) => !s.late && s.marker === 0xe2 && startsWith(b, s.body, MPF),
  );
  if (!segment) return null;
  const tiff = segment.body + MPF.length;
  const end = segment.end;
  if (tiff + 8 > end) return null;
  const little = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
  if (!little && !(b[tiff] === 0x4d && b[tiff + 1] === 0x4d)) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return null;
  const count = u16(ifd);
  if (ifd + 2 + count * 12 > end) return null;
  for (let n = 0; n < count; n++) {
    const at = ifd + 2 + n * 12;
    if (u16(at) !== MP_ENTRY || u16(at + 2) !== 7) continue;
    const size = u32(at + 4);
    if (size % 16 || size < 32) return null;
    const data = size <= 4 ? at + 8 : tiff + u32(at + 8);
    if (data + size > end) return null;
    const extra: MpImage[] = [];
    for (let k = 1; k < Math.min(size / 16, MOST + 1); k++) {
      const e = data + k * 16;
      const length = u32(e + 4);
      const offset = tiff + u32(e + 8);
      if (u32(e + 8) === 0 || length < 4 || offset + length > b.length)
        continue;
      if (b[offset] !== 0xff || b[offset + 1] !== 0xd8) continue;
      extra.push({ attribute: u32(e), offset, length });
    }
    return { segment, primary: u32(data), extra };
  }
  return null;
}

/** An MPF segment's payload for these pictures (sizes and attributes;
 * the offsets each from the TIFF header, which starts 4 bytes into the
 * payload), big-endian: MPFVersion, NumberOfImages and MPEntry, nothing
 * else (no image IDs). */
export function mpfPayload(images: MpImage[]): Uint8Array {
  const entries = 3;
  const ifdSize = 2 + entries * 12 + 4;
  const data = 8 + ifdSize;
  const out = new Uint8Array(MPF.length + data + images.length * 16);
  const view = new DataView(out.buffer);
  out.set([0x4d, 0x50, 0x46, 0x00, 0x4d, 0x4d, 0x00, 0x2a]);
  view.setUint32(8, 8);
  let at = 12;
  view.setUint16(at, entries);
  at += 2;
  const entry = (tag: number, type: number, count: number, value: number) => {
    view.setUint16(at, tag);
    view.setUint16(at + 2, type);
    view.setUint32(at + 4, count);
    view.setUint32(at + 8, value);
    at += 12;
  };
  entry(0xb000, 7, 4, 0x30313030); // "0100"
  entry(0xb001, 4, 1, images.length);
  entry(MP_ENTRY, 7, images.length * 16, data);
  view.setUint32(at, 0); // no next IFD
  images.forEach((image, n) => {
    const e = MPF.length + data + n * 16;
    view.setUint32(e, image.attribute);
    view.setUint32(e + 4, image.length);
    view.setUint32(e + 8, image.offset);
  });
  return out;
}
