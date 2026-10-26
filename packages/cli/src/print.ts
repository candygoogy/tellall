// How a report reads in a terminal (spec §5.2's example): the file, its
// headline, a bullet per finding; with --all, the raw fields under each.
import type { Report } from "@tellall/engine";

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

const lines = (list: string[]) => list.map((l) => safe(l) + "\n").join("");

/** One report. Harmless findings (spec §5.4) are left out. */
export function formatReport(report: Report, all: boolean): string {
  const list = [report.name, `  ${report.headline}`];
  for (const finding of report.findings) {
    if (finding.kind === "harmless") continue;
    list.push(`  · ${finding.sentence}`);
    if (!all) continue;
    for (const f of finding.fields) {
      list.push(`      ${f.name}: ${f.value} (${f.from})`);
    }
  }
  return lines(list);
}

/** A file and indented lines under it. */
export const block = (name: string, under: string[]) =>
  lines([name, ...under.map((l) => `  ${l}`)]);
