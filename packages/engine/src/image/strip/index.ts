import { stripHeic } from "./heic.ts";
import { stripJpeg } from "./jpeg.ts";
import { KEEP_LABELS, type CleanOptions } from "./options.ts";
import { stripPng } from "./png.ts";
import { stripWebp } from "./webp.ts";
import type { ImageType } from "../detect.ts";

export { stripHeic, stripJpeg, stripPng, stripWebp };
export { KEEP_LABELS, type CleanOptions };

/** A copy without the photo's metadata, the picture itself untouched; its
 * AI label kept or removed as `opts` says (options.ts). */
export function cleanImage(
  b: Uint8Array,
  type: ImageType,
  orientation: number,
  opts: CleanOptions,
): Uint8Array {
  if (type === "jpeg") return stripJpeg(b, orientation, opts);
  if (type === "png") return stripPng(b, orientation, opts);
  if (type === "heic") return stripHeic(b, orientation, opts);
  return stripWebp(b, orientation, opts);
}
