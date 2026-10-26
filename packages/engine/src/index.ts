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
import { segments } from "./image/strip/jpeg.ts";
import { chunks as pngChunks } from "./image/strip/png.ts";
import { chunks as webpChunks } from "./image/strip/webp.ts";
import { turnOf } from "./image/turn.ts";
import { cleanText, scanText } from "./text/hidden.ts";
import { scanHtml } from "./text/html.ts";
import { en } from "./words/en.ts";

export { en as words };
export { ReaderMissing };

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

async function examineFile(name: string, bytes: Uint8Array): Promise<Examined> {
  const type = detect(bytes);
  if (!type) {
    return {
      report: unknown(name),
      type,
      read: undefined,
      label: null,
      damaged: false,
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
  findings.push(...labelled, ...meta);
  const labels = findings.filter((f) => f.kind === "label");
  const privates = findings.filter((f) => f.kind === "private");
  if (labels.length && !privates.length && !damaged && !storedOddly) {
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
  const kinds = groupsOf(privates).length;
  const headline = labels.length
    ? ai
      ? en.headline.aiMade
      : en.headline.aiLabel
    : kinds
      ? en.headline.personal(kinds)
      : en.headline.empty;

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

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** A copy without what inspect() calls private: for a file, its private
 * metadata goes and its AI label stays (unless `removeLabels`); for a
 * text, its hidden characters go and it comes back as plain text. A file
 * with nothing private comes back as it was, byte for byte. A file that
 * can't be cleaned comes back with `cleaned: false`, empty bytes and a
 * note saying why. */
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
  const { report, type, read, label, damaged } = await examineFile(
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
  const go = report.findings.filter(
    (f) =>
      f.cleanedBy === "clean" ||
      (removeLabels && f.cleanedBy === "remove-labels"),
  );
  // Nothing to remove: the original, byte for byte, so a label still
  // matches. A damaged file is cleaned anyway: what couldn't be read may
  // still be there.
  if (!go.length && !damaged) {
    return {
      cleaned: true,
      output: bytes,
      removed: [],
      notes: [en.clean.nothing],
    };
  }
  const source = xmpSource(read);
  let output: Uint8Array;
  try {
    output = cleanImage(bytes, type, turnOf(bytes, type), {
      keepLabels: !removeLabels,
      ...(source ? { digitalSourceType: source } : {}),
    });
  } catch (e) {
    return {
      cleaned: false,
      output: new Uint8Array(0),
      removed: [],
      notes: [e instanceof CantClean ? e.message : en.clean.damaged],
    };
  }
  const notes: string[] = [];
  if (removeLabels && report.findings.some((f) => f.kind === "label")) {
    notes.push(en.clean.labelsRemoved);
  }
  if (!removeLabels && label?.range && !same(output, bytes)) {
    notes.push(en.clean.labelChanged);
  }
  // A HEIC keeps the XMP item that holds the source type whole (spec §6).
  if (!removeLabels && type === "heic" && source) {
    const xmp = read?.groups.find(([b]) => b === "xmp")?.[1] ?? {};
    const others = Object.keys(xmp).filter((k) => k !== "DigitalSourceType");
    if (others.length) notes.push(en.clean.heicXmpKept(others));
  }
  return { cleaned: true, output, removed: groupsOf(go), notes };
}
