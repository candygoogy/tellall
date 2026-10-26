// Exif that says only how the picture is stored: its resolution and unit,
// YCbCr positioning and subsampling, colour space, pixel size, Exif and
// Flashpix versions, components configuration, orientation, and the
// pointers between its IFDs. No one is given away by these, so they're no
// finding, and a file whose only metadata they are has nothing to remove
// (a clean copy still drops them, with the rest of the Exif, when it has
// something else to remove).
//
// A block counts only when every byte of it is accounted for: the header,
// each IFD, each value, and zeros between them. Anything else (another
// tag, a thumbnail IFD, bytes no tag points at) and it's the photo's own.

/** The tags, by the IFD they belong in. */
const IFD0 = new Set([
  0x0100, // ImageWidth
  0x0101, // ImageLength
  0x0112, // Orientation
  0x011a, // XResolution
  0x011b, // YResolution
  0x0128, // ResolutionUnit
  0x0212, // YCbCrSubSampling
  0x0213, // YCbCrPositioning
]);
const EXIF = new Set([
  0x9000, // ExifVersion
  0x9101, // ComponentsConfiguration
  0xa000, // FlashpixVersion
  0xa001, // ColorSpace
  0xa002, // PixelXDimension
  0xa003, // PixelYDimension
]);
const INTEROP = new Set([
  0x0001, // InteroperabilityIndex
  0x0002, // InteroperabilityVersion
]);
const EXIF_POINTER = 0x8769;
const INTEROP_POINTER = 0xa005;

/** The same fields as exifr names them, for reports. */
export const TECHNICAL_KEYS = new Set([
  "ImageWidth",
  "ImageHeight",
  "Orientation",
  "XResolution",
  "YResolution",
  "ResolutionUnit",
  "YCbCrSubSampling",
  "YCbCrPositioning",
  "ExifVersion",
  "ComponentsConfiguration",
  "FlashpixVersion",
  "ColorSpace",
  "ExifImageWidth",
  "ExifImageHeight",
  "InteropIndex",
  "InteropVersion",
]);

/** Bytes per value of each TIFF type. */
const SIZES: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
};
/** The most a technical value can take: a few numbers, or "R98". */
const LONGEST_VALUE = 16;

/** Whether a TIFF block (Exif without its "Exif\0\0") holds only the
 * technical tags above, and nothing between or after them but zeros. */
export function technicalOnly(tiff: Uint8Array): boolean {
  if (tiff.length < 8 || tiff.length > 4096) return false;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return false;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  if (u16(2) !== 42) return false;
  const covered = new Uint8Array(tiff.length);
  const cover = (from: number, length: number) => {
    if (from < 0 || from + length > tiff.length) return false;
    for (let i = from; i < from + length; i++) {
      if (covered[i]) return false;
      covered[i] = 1;
    }
    return true;
  };
  cover(0, 8);
  const ifd = (at: number, tags: Set<number>, depth: number): boolean => {
    if (depth > 2 || at + 2 > tiff.length) return false;
    const count = u16(at);
    if (!cover(at, 2 + count * 12 + 4)) return false;
    // A next IFD is a thumbnail's.
    if (u32(at + 2 + count * 12) !== 0) return false;
    for (let n = 0; n < count; n++) {
      const e = at + 2 + n * 12;
      const tag = u16(e);
      const type = u16(e + 2);
      const size = (SIZES[type] ?? 0) * u32(e + 4);
      if (!size || size > LONGEST_VALUE) {
        if (!(tag === EXIF_POINTER || tag === INTEROP_POINTER)) return false;
      }
      if (tag === EXIF_POINTER && tags === IFD0) {
        if (!ifd(u32(e + 8), EXIF, depth + 1)) return false;
      } else if (tag === INTEROP_POINTER && tags === EXIF) {
        if (!ifd(u32(e + 8), INTEROP, depth + 1)) return false;
      } else if (!tags.has(tag)) return false;
      else if (size > 4 && !cover(u32(e + 8), size)) return false;
    }
    return true;
  };
  if (!ifd(u32(4), IFD0, 0)) return false;
  return tiff.every((byte, i) => covered[i] || byte === 0);
}
