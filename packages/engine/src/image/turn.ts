// The turn a photo is shown with: Exif's Orientation, read only where a
// browser reads it, so the clean copy is shown exactly the way up the
// photo is. Never from XMP, IPTC or a block the browser skips: a turn kept
// only there isn't one, and writing it into the clean copy would turn a
// picture that was never shown turned.
//
// - JPEG: the first Exif segment before the picture's first scan.
// - PNG: the first eXIf chunk before the picture's data, a bare TIFF.
// - WebP: browsers don't turn a WebP at all, but other readers turn it by
//   the first EXIF chunk when the extended header flags one; the clean
//   copy keeps that turn, so it looks the same in both.
// - HEIC: the picture is turned by its own properties (kept as they are);
//   the photo's own Exif turn is kept beside them, as the photo had it.
//
// In each, the turn is the Orientation entry of the first IFD, one SHORT,
// 1 to 8; anything else counts as upright.
import { startsWith } from "../bytes.ts";
import type { ImageType } from "./detect.ts";
import { exifTiff, heifLayout, itemBytes } from "./heif.ts";
import { segments } from "./strip/jpeg.ts";
import { chunks as pngChunks } from "./strip/png.ts";
import { chunks as webpChunks, declaredEnd } from "./strip/webp.ts";

const ORIENTATION = 0x0112;
const SHORT = 3;

/** The Orientation in a TIFF block's first IFD, or 1. */
export function tiffTurn(tiff: Uint8Array): number {
  if (tiff.length < 8) return 1;
  const little = startsWith(tiff, 0, "II*\0");
  if (!little && !startsWith(tiff, 0, "MM\0*")) return 1;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return 1;
  const count = u16(ifd);
  for (let n = 0; n < count; n++) {
    const at = ifd + 2 + n * 12;
    if (at + 12 > tiff.length) return 1;
    if (u16(at) !== ORIENTATION) continue;
    if (u16(at + 2) !== SHORT || u32(at + 4) !== 1) return 1;
    const turn = u16(at + 8);
    return turn >= 1 && turn <= 8 ? turn : 1;
  }
  return 1;
}

function jpegTurn(b: Uint8Array): number {
  for (const s of segments(b).list) {
    if (s.marker === 0xda) break;
    if (s.marker === 0xe1 && startsWith(b, s.body, "Exif\0")) {
      return tiffTurn(b.subarray(s.body + 6, s.end));
    }
  }
  return 1;
}

function pngTurn(b: Uint8Array): number {
  for (const c of pngChunks(b).list) {
    if (c.type === "IDAT") break;
    if (c.type === "eXIf") return tiffTurn(b.subarray(c.data, c.end - 4));
  }
  return 1;
}

function webpTurn(b: Uint8Array): number {
  const list = webpChunks(b, 12, declaredEnd(b));
  const [first] = list;
  if (first?.type !== "VP8X" || !((b[first.body] ?? 0) & 0x08)) return 1;
  const exif = list.find((c) => c.type === "EXIF");
  if (!exif) return 1;
  let tiff = b.subarray(exif.body, exif.body + exif.size);
  if (startsWith(tiff, 0, "Exif\0\0")) tiff = tiff.subarray(6);
  return tiffTurn(tiff);
}

function heicTurn(b: Uint8Array): number {
  const [first] = heifLayout(b).exif;
  const tiff = first ? exifTiff(itemBytes(b, first)) : null;
  return tiff ? tiffTurn(tiff) : 1;
}

/** The turn the photo is shown with, 1 to 8 (1 is upright). A file that
 * can't be followed is upright: it has no turn anyone could read. */
export function turnOf(b: Uint8Array, type: ImageType): number {
  try {
    if (type === "jpeg") return jpegTurn(b);
    if (type === "png") return pngTurn(b);
    if (type === "webp") return webpTurn(b);
    return heicTurn(b);
  } catch {
    return 1;
  }
}
