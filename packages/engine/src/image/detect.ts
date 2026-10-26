// What a file is, from its first bytes. The name and the type the browser
// reports are never trusted: a PNG renamed to .jpg is still a PNG.

import { ascii } from "../bytes.ts";

export type ImageType = "jpeg" | "png" | "webp" | "heic";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// A file whose main brand is AVIF's isn't HEIC. Otherwise one of HEVC's
// brands makes it HEIC, and plain HEIF's (mif1, msf1) do too, unless it
// also names AVIF's: an AVIF lists mif1 as well.
const HEVC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);
const HEIF_BRANDS = new Set(["mif1", "msf1"]);

export function detect(b: Uint8Array): ImageType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "jpeg";
  }
  if (b.length >= 8 && PNG.every((v, i) => b[i] === v)) return "png";
  if (
    b.length >= 12 &&
    ascii(b, 0, 4) === "RIFF" &&
    ascii(b, 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  // ISO media files: a size, "ftyp", the major brand, a version, then the
  // compatible brands, up to the box's end.
  if (b.length >= 16 && ascii(b, 4, 8) === "ftyp") {
    const major = ascii(b, 8, 12);
    if (AVIF_BRANDS.has(major)) return null;
    const end = Math.min(
      b.length,
      new DataView(b.buffer, b.byteOffset).getUint32(0),
    );
    const brands = [major];
    for (let o = 16; o + 4 <= end; o += 4) brands.push(ascii(b, o, o + 4));
    const any = (set: Set<string>) => brands.some((brand) => set.has(brand));
    if (any(HEVC_BRANDS)) return "heic";
    if (any(AVIF_BRANDS)) return null;
    if (any(HEIF_BRANDS)) return "heic";
  }
  return null;
}
