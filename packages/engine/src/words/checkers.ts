// Where a person can check an invisible watermark that an AI label states:
// the makers' own checkers, which the page links under that sentence.
// Plain links; tellall itself sends nothing anywhere.
//
// Chosen from the sentence the person reads, so a link never says more
// than it does: Google's SynthID Detector only when the label named
// SynthID, a maker's own checker only when that maker signed the label.
// No imports: the page's main script uses this without the engine.

export interface Checker {
  /** The link's words. */
  text: string;
  url: string;
}

/** Google's, public since 2026-10-07; it needs sign-in. */
export const SYNTHID_DETECTOR: Checker = {
  text: "Check for SynthID with Google's SynthID Detector (needs sign-in)",
  url: "https://synthid.com/",
};

/** Each maker's own checker, by the signer's first word as the sentence
 * says it. */
export const MAKER_CHECKERS: Readonly<Record<string, Checker>> = {
  OpenAI: {
    text: "Check with OpenAI's own checker",
    url: "https://openai.com/verify",
  },
};

// en.label.watermark's sentence: who, and the name if the label gave one.
const WATERMARK =
  /^The label says (.+?) also put an invisible watermark(?:, (SynthID),)? in the pixels\./;

/** The checkers for a finding's sentence: none unless it states a
 * watermark. */
export function watermarkCheckers(sentence: string): Checker[] {
  const m = WATERMARK.exec(sentence);
  if (!m) return [];
  const out: Checker[] = [];
  if (m[2]) out.push(SYNTHID_DETECTOR);
  const who = m[1] ?? "";
  if (Object.hasOwn(MAKER_CHECKERS, who)) {
    out.push(MAKER_CHECKERS[who] as Checker);
  }
  return out;
}
