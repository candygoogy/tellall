// tellall's engine: inspect() says what a file or a pasted text gives
// away, clean() makes a copy without it (spec §7.2). No DOM or Node APIs:
// the CLI and the page's worker run this same code.
import { anatomy, type Piece } from "./anatomy.ts";
import { readLabel, type Label } from "./c2pa/read.ts";
import {
  GROUPS,
  labelFindings,
  metaFindings,
  pngTime,
  saysAi,
  textFindings,
  xmpSource,
} from "./findings.ts";
import { detect, type ImageType } from "./image/detect.ts";
import { CantClean, heifLayout } from "./image/heif.ts";
import { ReaderMissing, readImage, type Read } from "./image/read.ts";
import { cleanImage } from "./image/strip/index.ts";
import { gainMapCount, segments } from "./image/strip/jpeg.ts";
import { chunks as pngChunks } from "./image/strip/png.ts";
import { chunks as webpChunks } from "./image/strip/webp.ts";
import { TECHNICAL_KEYS } from "./image/technical.ts";
import { turnOf } from "./image/turn.ts";
import { cleanText, scanText } from "./text/hidden.ts";
import { scanHtml } from "./text/html.ts";
import { en } from "./words/en.ts";

export { en as words };
export { detect, ReaderMissing };

export type Input =
  | { kind: "file"; name: string; bytes: Uint8Array }
  | { kind: "text"; plain: string; html?: string };

export type Group =
  | "ai-label"
  | "ai-source"
  | "location"
  | "device"
  | "dates"
  | "software"
  | "ids"
  | "other-text"
  | "hidden-chars"
  | "copy-extras";

export interface Field {
  name: string;
  value: string;
  from: string;
}

export interface Finding {
  group: Group;
  kind: "label" | "private" | "info" | "harmless";
  /** From words/. */
  sentence: string;
  /** For "Show everything". */
  fields: Field[];
  /** What removes it. */
  cleanedBy: "clean" | "remove-labels" | "nothing";
}

export interface Report {
  name: string;
  format: "jpeg" | "png" | "webp" | "heic" | "text" | "unknown";
  headline: string;
  findings: Finding[];
  empty: boolean;
  /** The file's parts to scale, for the anatomy map (images only). */
  anatomy: Piece[];
}

export interface Cleaned {
  /** False when no clean copy could be made (`notes` says why). True
   * otherwise, also when there was nothing to remove. */
  cleaned: boolean;
  /** The clean copy: bytes for a file, plain text for a text. Empty bytes
   * when `cleaned` is false. */
  output: Uint8Array | string;
  /** The groups the copy no longer carries. */
  removed: Group[];
  notes: string[];
}

/** What inspect() found, and what clean() needs from it. */
interface Examined {
  report: Report;
  type: ImageType | null;
  read: Read | undefined;
  label: Label | null;
  /** The structure is broken or the details couldn't be read. */
  damaged: boolean;
  /** Whether a clean copy with labels kept would be the file itself:
   * nothing in it but the picture, what draws it, and what's kept. */
  untouched: boolean;
}

/** Whether the file's own structure is cut short or doesn't add up. */
function brokenStructure(b: Uint8Array, type: ImageType): boolean {
  try {
    if (type === "png") return !pngChunks(b).ended;
    if (type === "jpeg") return !segments(b).ended;
    if (type === "webp") {
      const declared =
        8 +
        new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(4, true);
      if (declared > b.length) return true;
      webpChunks(b, 12, declared);
      return false;
    }
    heifLayout(b);
    return false;
  } catch (e) {
    return !(e instanceof CantClean);
  }
}

const unknown = (name: string): Report => ({
  name,
  format: "unknown",
  headline: en.headline.unknown,
  findings: [],
  empty: false,
  anatomy: [],
});

/** Groups once each, in report order. */
const groupsOf = (findings: Finding[]) =>
  GROUPS.filter((g) => findings.some((f) => f.group === g));

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** What a clean copy with labels kept would keep, never a copy itself
 * (options.ts): what the picture is drawn with as it is (`drawnAsIs`:
 * its colour profile, technical-only Exif), and, with `keepRead`, every
 * block tellall reads as well. Null when it can't be made. */
function keptAsIs(
  bytes: Uint8Array,
  type: ImageType,
  read: Read | undefined,
  keepRead: boolean,
): Uint8Array | null {
  const source = xmpSource(read);
  try {
    return cleanImage(bytes, type, turnOf(bytes, type), {
      keepLabels: true,
      drawnAsIs: true,
      keepRead,
      ...(source ? { digitalSourceType: source } : {}),
    });
  } catch {
    return null;
  }
}

/** What the label's own metadata gives away: the same findings a file's
 * metadata makes, said of the label, and removed only with it. */
function labelMetaFindings(label: Label | null): Finding[] {
  if (!label || !Object.keys(label.metadata).length) return [];
  const read: Read = {
    meta: label.metadata,
    groups: [["xmp", label.metadata]],
  };
  return metaFindings(read, null, "C2PA label")
    .filter((f) => f.kind === "private")
    .map((f) => ({
      ...f,
      sentence: en.label.holds(f.sentence),
      fields: f.fields.map((x) => ({ ...x, from: "C2PA metadata assertion" })),
      cleanedBy: "remove-labels",
    }));
}

const BLOCK_NAMES = {
  exif: "Exif",
  gps: "Exif GPS",
  xmp: "XMP",
  iptc: "IPTC",
  text: "Text",
} as const;

/** The anatomy's notes for the blocks tellall reads. */
const READ_NOTES = new Set([
  en.anatomy.exif,
  en.anatomy.xmp,
  en.anatomy.iptc,
  en.anatomy.comment,
  en.anatomy.text,
  en.anatomy.time,
]);

/** Details a clean copy removes that no finding names: a block of a kind
 * this doesn't read, a field it doesn't list, data after the picture's
 * end. Listed by where they sit, for "Show everything". */
function notNamed(read: Read | undefined, named: Finding[], parts: Piece[]) {
  const listed = new Set(named.flatMap((f) => f.fields.map((x) => x.name)));
  const fields: Field[] = [];
  for (const [block, meta] of read?.groups ?? []) {
    for (const [key, value] of Object.entries(meta)) {
      if (fields.length >= 100) break;
      if (listed.has(key) || TECHNICAL_KEYS.has(key)) continue;
      // exifr's own readings of GPS, not fields of the file.
      if (key === "latitude" || key === "longitude") continue;
      const from = BLOCK_NAMES[block];
      const text =
        typeof value === "string" || typeof value === "number"
          ? String(value).slice(0, 120)
          : "";
      fields.push({ name: key, value: text, from });
    }
  }
  for (const piece of parts) {
    if (fields.length >= 200) break;
    if (piece.part !== "metadata" && piece.part !== "other") continue;
    if (piece.note === en.anatomy.profile || piece.note === en.anatomy.end) {
      continue;
    }
    // Blocks tellall reads: their fields are listed above.
    if (piece.note.split(", ").every((note) => READ_NOTES.has(note))) continue;
    fields.push({
      name: piece.note,
      value: `${piece.length} bytes at ${piece.offset}`,
      from: "File structure",
    });
  }
  return fields;
}

async function examineFile(name: string, bytes: Uint8Array): Promise<Examined> {
  const type = detect(bytes);
  if (!type) {
    return {
      report: unknown(name),
      type,
      read: undefined,
      label: null,
      damaged: false,
      untouched: false,
    };
  }
  let read: Read | undefined;
  let damaged = brokenStructure(bytes, type);
  let storedOddly = false;
  try {
    read = await readImage(bytes, type);
  } catch (e) {
    // Not the file's fault: inspect() fails rather than call it damaged.
    if (e instanceof ReaderMissing) throw e;
    if (e instanceof CantClean) storedOddly = true;
    else damaged = true;
  }
  let label: Label | null = null;
  try {
    label = await readLabel(bytes, type);
  } catch {
    // readLabel doesn't throw; a label that can't be found isn't there.
  }

  const meta = metaFindings(
    read,
    type === "png" ? pngTime(bytes) : null,
    type === "png"
      ? "PNG text chunk"
      : type === "jpeg"
        ? "JPEG comment"
        : "Text",
  );
  const labelled = label ? labelFindings(label, type === "webp") : [];
  const findings: Finding[] = [];
  const note = (sentence: string): Finding => ({
    group: "other-text",
    kind: "info",
    sentence,
    fields: [],
    cleanedBy: "nothing",
  });
  if (damaged) findings.push(note(en.damaged));
  if (storedOddly) findings.push(note(en.detailsStoredOddly));
  findings.push(...labelled, ...meta, ...labelMetaFindings(label));

  let parts: Piece[];
  try {
    parts = anatomy(bytes, type, label);
  } catch {
    parts = [
      {
        part: "other",
        offset: 0,
        length: bytes.length,
        note: en.anatomy.unreadable,
      },
    ];
  }

  // Whether there's anything to remove comes from the file's structure:
  // a clean copy would differ from it. What the picture is drawn with (the
  // colour profile, technical-only Exif) isn't something to remove: kept
  // as it is here (icc.ts still cleans a profile's words in a copy). A
  // finding says something goes when the copy would drop what no finding
  // names: a block tellall doesn't read (kept as they are, the blocks it
  // reads still leave a difference), or, with nothing named, a field.
  const kept = storedOddly ? null : keptAsIs(bytes, type, read, false);
  const untouched = !damaged && kept !== null && same(kept, bytes);
  const removable = findings.some(
    (f) => f.kind === "private" && f.cleanedBy === "clean",
  );
  const unread =
    !damaged && !untouched && kept !== null
      ? keptAsIs(bytes, type, read, true)
      : null;
  let unnamed: Finding | undefined;
  if (unread && (!same(unread, bytes) || (!removable && !untouched))) {
    unnamed = {
      group: "other-text",
      kind: "private",
      sentence: en.otherText.notNamed,
      fields: notNamed(read, findings, parts),
      cleanedBy: "clean",
    };
    findings.push(unnamed);
  }

  const labels = findings.filter((f) => f.kind === "label");
  const privates = findings.filter((f) => f.kind === "private");
  // Said only of a label that was read: one that can't be read may hold
  // anything.
  const labelRead = !label || !label.detailsUnavailable;
  if (
    labels.length &&
    labelRead &&
    !privates.length &&
    !damaged &&
    !storedOddly
  ) {
    findings.push({
      group: "location",
      kind: "info",
      sentence: en.label.nothingElse,
      fields: [],
      cleanedBy: "nothing",
    });
  }

  const source = xmpSource(read);
  const ai =
    saysAi(label?.digitalSourceType) ||
    !!label?.actions.some((a) => saysAi(a.sourceType)) ||
    saysAi(source);
  // Details tellall doesn't name aren't counted as personal data.
  const kinds = groupsOf(privates.filter((f) => f !== unnamed)).length;
  const headline = labels.length
    ? ai
      ? en.headline.aiMade
      : en.headline.aiLabel
    : kinds
      ? en.headline.personal(kinds)
      : unnamed
        ? en.headline.notNamed
        : damaged
          ? en.headline.damaged
          : en.headline.empty;
  // The headline already says the file is damaged; don't repeat it below.
  if (headline === en.headline.damaged) {
    const i = findings.findIndex((f) => f.sentence === en.damaged);
    if (i >= 0) findings.splice(i, 1);
  }

  return {
    report: {
      name,
      format: type,
      headline,
      findings,
      empty: headline === en.headline.empty,
      anatomy: parts,
    },
    type,
    read,
    label,
    damaged,
    untouched,
  };
}

/** The text a paste stands for: its plain text, else the HTML's words. */
function plainOf(input: { plain: string; html?: string }) {
  const extras = input.html !== undefined ? scanHtml(input.html) : null;
  const plain = input.plain || extras?.text || "";
  return { plain, extras };
}

function inspectText(input: { plain: string; html?: string }): Report {
  const { plain, extras } = plainOf(input);
  const findings = textFindings(plain, extras);
  const hidden = scanText(plain).filter((h) => h.kind === "hidden").length;
  // Hidden characters win; then the page's address; then other page extras.
  const headline = hidden
    ? en.headline.hidden(hidden)
    : extras?.sourceUrl
      ? en.headline.copyAddress
      : findings.some((f) => f.group === "copy-extras")
        ? en.headline.copyExtras
        : en.headline.noHidden;
  return {
    name: en.text.name,
    format: "text",
    headline,
    findings,
    empty: findings.length === 0,
    anatomy: [],
  };
}

/** What a file or a pasted text gives away. Never throws for a file's
 * content: a damaged file says so in its findings. */
export async function inspect(input: Input): Promise<Report> {
  if (input.kind === "text") return inspectText(input);
  return (await examineFile(input.name, input.bytes)).report;
}

/** The groups a report says the file gives away or labels. */
const carried = (findings: Finding[]) =>
  groupsOf(findings.filter((f) => f.kind === "private" || f.kind === "label"));

/** A copy without what inspect() calls private: for a file, its private
 * metadata goes and its AI label stays (unless `removeLabels`); for a
 * text, its hidden characters go and it comes back as plain text. A file
 * whose clean copy would be the same, apart from what it keeps, comes back
 * as it was, byte for byte. A file that can't be cleaned comes back with
 * `cleaned: false`, empty bytes and a note saying why. */
export async function clean(
  input: Input,
  opts: { removeLabels?: boolean } = {},
): Promise<Cleaned> {
  if (input.kind === "text") {
    const { plain } = plainOf(input);
    const report = inspectText(input);
    const removed = groupsOf(
      report.findings.filter((f) => f.cleanedBy === "clean"),
    );
    return {
      cleaned: true,
      output: cleanText(plain),
      removed,
      notes: removed.length ? [] : [en.clean.nothing],
    };
  }

  const { bytes } = input;
  const { report, type, read, label, damaged, untouched } = await examineFile(
    input.name,
    bytes,
  );
  if (!type)
    return {
      cleaned: false,
      output: new Uint8Array(0),
      removed: [],
      notes: [en.clean.unknown],
    };
  const removeLabels = opts.removeLabels === true;
  const failed = (note: string): Cleaned => ({
    cleaned: false,
    output: new Uint8Array(0),
    removed: [],
    notes: [note],
  });
  const keptData = report.findings.some(
    (f) => f.kind === "private" && f.cleanedBy === "remove-labels",
  );
  const nothing = (): Cleaned => ({
    cleaned: true,
    output: bytes,
    removed: [],
    notes: [keptData && !removeLabels ? en.clean.labelKeeps : en.clean.nothing],
  });
  // Nothing to remove: the original, byte for byte, so a label still
  // matches. A damaged file is cleaned anyway: what couldn't be read may
  // still be there.
  if (untouched && !removeLabels) return nothing();
  let output: Uint8Array;
  try {
    const source = xmpSource(read);
    output = cleanImage(bytes, type, turnOf(bytes, type), {
      keepLabels: !removeLabels,
      ...(source ? { digitalSourceType: source } : {}),
    });
  } catch (e) {
    return failed(e instanceof CantClean ? e.message : en.clean.damaged);
  }
  if (!damaged && same(output, bytes)) return nothing();
  // The copy must read as the kind of file it is; a cleaner that left one
  // that doesn't gives none.
  if (brokenStructure(output, type)) return failed(en.clean.damaged);
  // What's gone is what the copy no longer carries, read from the copy.
  const after = await examineFile(input.name, output);
  const left = new Set(carried(after.report.findings));
  const removed = carried(report.findings).filter((g) => !left.has(g));

  const notes: string[] = [];
  if (damaged) notes.push(en.clean.partial);
  if (removeLabels && report.findings.some((f) => f.kind === "label")) {
    notes.push(en.clean.labelsRemoved);
  }
  if (!removeLabels && label?.range) {
    notes.push(en.clean.labelChanged);
    if (keptData) notes.push(en.clean.labelKeeps);
  }
  if (type === "jpeg" && gainMapCount(output) < gainMapCount(bytes)) {
    notes.push(en.clean.gainMapDropped);
  }
  // A HEIC keeps the XMP item that holds the source type whole (spec §6).
  const source = xmpSource(read);
  if (!removeLabels && type === "heic" && source) {
    const xmp = read?.groups.find(([b]) => b === "xmp")?.[1] ?? {};
    const others = Object.keys(xmp).filter((k) => k !== "DigitalSourceType");
    if (others.length) notes.push(en.clean.heicXmpKept(others));
  }
  return { cleaned: true, output, removed, notes };
}
