// How a report reads in a terminal (spec §5.2's example): the file, its
// headline, a bullet per finding; with --all, the raw fields under each.
// On a terminal the name is bold and the headline and bullet dots take the
// colour of their kind; nothing else is coloured.
import { words, type Finding, type Report } from "@tellall/engine";

/** Control characters, and the ones that reorder text, shown as escapes:
 * a file's metadata mustn't be able to move the cursor or recolour the
 * terminal. */
const UNSAFE =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

export const safe = (s: string) =>
  s.replace(
    UNSAFE,
    (c) => `\\u{${(c.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}}`,
  );

/** The colour of a kind of result. Basic ANSI colours only, the ones that
 * read on dark and light backgrounds alike (yellow is the weakest on
 * light ones, so it's kept for what tellall couldn't read). */
export type Tone = "label" | "private" | "clear" | "unread";
const SGR: Record<Tone, number> = {
  label: 35, // magenta
  private: 31, // red
  clear: 32, // green
  unread: 33, // yellow
};

export interface Paint {
  bold: (s: string) => string;
  tone: (tone: Tone, s: string) => string;
}

/** Colours on or off. Applied after safe(), so a file's own text never
 * carries an escape. */
export const paint = (on: boolean): Paint => ({
  bold: (s) => (on ? `\x1b[1m${s}\x1b[22m` : s),
  tone: (tone, s) => (on ? `\x1b[${SGR[tone]}m${s}\x1b[39m` : s),
});

const PLAIN = paint(false);

/** What a report comes to, as its headline says it: one of these each. */
type Outcome =
  "label" | "personal" | "hidden" | "unnamed" | "clear" | "damaged" | "unknown";

const has = (report: Report, kind: Finding["kind"]) =>
  report.findings.some((f) => f.kind === kind);

function outcomeOf(report: Report): Outcome {
  if (report.format === "unknown") return "unknown";
  if (has(report, "label")) return "label";
  if (report.headline === words.headline.notNamed) return "unnamed";
  if (has(report, "private")) {
    return report.format === "text" ? "hidden" : "personal";
  }
  if (report.headline === words.headline.damaged) return "damaged";
  return "clear";
}

/** Each outcome's colour and its words in the count line, in the order
 * the count line gives them. */
const OUTCOMES: [Outcome, Tone, string][] = [
  ["label", "label", "with an AI label"],
  ["personal", "private", "with personal data"],
  ["hidden", "private", "with hidden characters"],
  ["unnamed", "private", "with details tellall doesn't name"],
  ["clear", "clear", "with nothing found"],
  ["damaged", "unread", "damaged"],
  ["unknown", "unread", "tellall can't read"],
];

const toneOf = (outcome: Outcome) =>
  (OUTCOMES.find(([o]) => o === outcome) as [Outcome, Tone, string])[1];

const DOT: Partial<Record<Finding["kind"], Tone>> = {
  label: "label",
  private: "private",
};

/** One report. Harmless findings (spec §5.4) are left out. */
export function formatReport(report: Report, all: boolean, p = PLAIN): string {
  const list = [
    p.bold(safe(report.name)),
    `  ${p.tone(toneOf(outcomeOf(report)), safe(report.headline))}`,
  ];
  for (const finding of report.findings) {
    if (finding.kind === "harmless") continue;
    const tone = DOT[finding.kind];
    const dot = tone ? p.tone(tone, "·") : "·";
    list.push(`  ${dot} ${safe(finding.sentence)}`);
    if (!all) continue;
    for (const f of finding.fields) {
      list.push(safe(`      ${f.name}: ${f.value} (${f.from})`));
    }
  }
  return list.map((l) => l + "\n").join("");
}

/** "a, b and c" */
export const listed = (items: string[]) =>
  items.length > 1
    ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
    : (items[0] ?? "");

/** "3 files: 1 with an AI label, 1 with personal data and 1 with nothing
 * found." Only the outcomes that occur. */
export function countLine(reports: Report[], p = PLAIN): string {
  const counts = new Map<Outcome, number>();
  for (const r of reports) {
    const o = outcomeOf(r);
    counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  const parts = OUTCOMES.filter(([o]) => counts.has(o)).map(([o, tone, said]) =>
    p.tone(tone, `${counts.get(o)} ${said}`),
  );
  return `${reports.length} files: ${listed(parts)}.\n`;
}

/** A file and indented lines under it. */
export const block = (name: string, under: string[], p = PLAIN) =>
  [p.bold(safe(name)), ...under.map((l) => safe(`  ${l}`))]
    .map((l) => l + "\n")
    .join("");
