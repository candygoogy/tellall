// What a clean copy does with an AI label. Kept (the default, and all the
// page ever does): the label's own blocks stay byte for byte, and the
// IPTC DigitalSourceType it names stays too, in a minimal XMP packet
// (xmp-min.ts). Removed (the CLI's --remove-labels): both go.

export interface CleanOptions {
  keepLabels: boolean;
  /** The picture's IPTC DigitalSourceType, read from its XMP, to carry
   * over into the clean copy (only when labels are kept). */
  digitalSourceType?: string;
  /** Keep what the picture is drawn with (its colour profile, Adobe's
   * segment) as it is rather than written anew. Never for a copy: it
   * tells whether a file has anything to remove besides those. */
  drawnAsIs?: boolean;
  /** With drawnAsIs, also keep as it is every block tellall reads (Exif,
   * XMP, IPTC, comments and text): what's left to differ is what it
   * doesn't read. Never for a copy either. */
  keepRead?: boolean;
}

export const KEEP_LABELS: CleanOptions = { keepLabels: true };

/** The source type the clean copy gets, if any. */
export const sourceType = (opts: CleanOptions) =>
  opts.keepLabels ? opts.digitalSourceType : undefined;
