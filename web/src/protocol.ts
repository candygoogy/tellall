// What the page and the engine's worker say to each other.
import type { Group, Report } from "@tellall/engine";

/** The worker's first message: it has started, with the engine loaded. */
export const READY = "tellall-ready";

export type AskInput =
  | { kind: "file"; name: string; bytes: Uint8Array }
  | { kind: "text"; plain: string; html?: string };

export interface Ask {
  id: number;
  input: AskInput;
}

export interface CleanedCopy {
  cleaned: boolean;
  output: Uint8Array | string;
  removed: Group[];
  notes: string[];
}

export interface Reading {
  report: Report;
  /** How long inspect() took, in ms. */
  ms: number;
  cleaned: CleanedCopy;
  /** The hint under an AI label, and the command in it, from the
   * engine's words. */
  hint: string | null;
  command: string | null;
}

export type Answer =
  | ({ id: number; ok: true } & Reading)
  | { id: number; ok: false; error: string; missing?: boolean }
  /** Inspected; the clean pass starts (its own time limit). */
  | { id: number; phase: "inspected" };
