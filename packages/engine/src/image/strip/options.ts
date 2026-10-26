// What a clean copy does with an AI label. Kept (the default, and all the
// page ever does): the label's own blocks stay byte for byte, and the
// IPTC DigitalSourceType it names stays too, in a minimal XMP packet
// (xmp-min.ts). Removed (the CLI's --remove-labels): both go.

export interface CleanOptions {
  keepLabels: boolean;
  /** The picture's IPTC DigitalSourceType, read from its XMP, to carry
   * over into the clean copy (only when labels are kept). */
  digitalSourceType?: string;
}

export const KEEP_LABELS: CleanOptions = { keepLabels: true };

/** The source type the clean copy gets, if any. */
export const sourceType = (opts: CleanOptions) =>
  opts.keepLabels ? opts.digitalSourceType : undefined;
