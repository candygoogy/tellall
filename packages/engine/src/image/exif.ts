// exifr's part of reading a photo: each block handed to it, and what it
// makes of each, nothing more. The page runs this in a worker of its own
// (exif-worker.ts), so a block that keeps exifr busy can't hold up the
// page; where there's no worker (Node, for the page's build), read.ts runs
// it directly.
import type { parse, sidecar } from "exifr";

export type Meta = Record<string, unknown>;

/** A block for exifr: a TIFF block (Exif), Photoshop's resources as the
 * JPEG segment they'd be in (IPTC), or an XMP packet. */
export interface Job {
  kind: "tiff" | "iptc" | "xmp";
  bytes: Uint8Array;
}

/** What exifr made of a block (nothing found: no fields), or null when
 * it gave up on it. */
export type Answer = Meta | null;

/** What the worker says once it has started, exifr with it. */
export const READY = "ready";

/** exifr's readers. */
export interface Exifr {
  parse: typeof parse;
  sidecar: typeof sidecar;
}

const OPTIONS = {
  tiff: true,
  exif: true,
  gps: true,
  xmp: true,
  iptc: true,
  icc: false,
  jfif: false,
  ihdr: false,
  interop: false,
  makerNote: false,
  userComment: true,
  multiSegment: true,
  mergeOutput: false,
  // Values as the file stores them: dates as written, orientation as a
  // number, coordinates as degrees, minutes and seconds.
  reviveValues: false,
  translateValues: false,
} satisfies Parameters<typeof parse>[1];

/** Each block read on its own, in order. */
export async function readJobs(exifr: Exifr, jobs: Job[]): Promise<Answer[]> {
  const answers: Answer[] = [];
  for (const { kind, bytes } of jobs) {
    const out =
      kind === "xmp"
        ? exifr.sidecar(bytes, OPTIONS, "xmp")
        : exifr.parse(
            bytes,
            kind === "iptc" ? { ...OPTIONS, tiff: false, xmp: false } : OPTIONS,
          );
    answers.push(
      await out.then(
        (fields) => (fields ?? {}) as Meta,
        () => null,
      ),
    );
  }
  return answers;
}
