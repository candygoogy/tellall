// The shape of the example readings (virtual:examples). Every report and
// clean result in it is the engine's own output on the repo's fixtures,
// made when the page is built (build/examples.ts); nothing is typed by hand.
import type { Group, Report } from "@tellall/engine";

export type ExampleId = "chatgpt" | "gemini" | "gps" | "damaged";

export interface ExampleClean {
  /** False when no clean copy could be made (notes say why). */
  cleaned: boolean;
  removed: Group[];
  notes: string[];
  /** The clean copy's size in bytes. */
  size: number;
  /** The clean copy is the original, byte for byte. */
  same: boolean;
}

export interface ExampleFile {
  id: ExampleId;
  name: string;
  report: Report;
  /** The file's size in bytes. */
  size: number;
  /** The abstract plate standing in for the picture, and its thumbnail. */
  plate: string;
  thumb: string;
  plateDims: [number, number];
  /** CSS aspect-ratio of the picture. */
  ar: string;
  /** "1,254 × 1,254 PNG". */
  desc: string;
  cleaned: ExampleClean;
  /** The hint under an AI label, and the command in it, from the engine's
   * words; null without a label. */
  hint: string | null;
  command: string | null;
  /** The file itself (base64), for the small ones whose example download
   * runs the real engine in the page. */
  bytes?: string;
  /** The first 16 bytes of the AI label, as hex. */
  labelHead?: string;
  /** Whether the label's signature matches the file, as the engine said. */
  signatureMatches?: boolean | null;
}

export interface ExampleText {
  plain: string;
  /** What Copy clean text writes. */
  clean: string;
  report: Report;
}

export interface ExampleData {
  files: Record<ExampleId, ExampleFile>;
  /** gps.jpg's clean copy, inspected. */
  gpsClean: Report;
  text: ExampleText;
  /** A formatted copy (the ChatGPT copy-button fixture), in bytes. */
  copy: { html: number; header: number; plain: number };
}
