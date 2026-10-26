// The example readings, made when the page is built: the real engine runs
// in Node on the repo's fixtures. examples.ts loads this module through
// Vite's module runner (the engine is TypeScript Node can't run as it is),
// and the work is done while it loads, here at the top level, so the
// engine's own dynamic imports (exifr) happen while the runner is open.
// Nothing here is typed by hand, so it can't drift from what the engine
// says; the fixtures are too big (2.5 and 3 MB) to ship and read in the
// page, and the page can't fetch them (connect-src 'none').
import { readFileSync } from "node:fs";
import { clean, inspect, words, type Report } from "@tellall/engine";
import sharp from "sharp";
import type {
  ExampleData,
  ExampleFile,
  ExampleId,
} from "../src/example-types.ts";

const FIXTURES = new URL("../../fixtures/", import.meta.url);
const PUBLIC = new URL("../public/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES));

const FILES: { id: ExampleId; path: string; embed?: boolean }[] = [
  { id: "chatgpt", path: "ai/chatgpt-image.png" },
  { id: "gemini", path: "ai/gemini-image.jpg" },
  // Small: shipped whole, so its example download runs the real engine.
  { id: "gps", path: "photo/gps.jpg", embed: true },
  { id: "damaged", path: "photo/damaged.jpg" },
];

// The example text: an input, written for the page, with three hidden
// characters (a zero-width space and two tag characters) and a no-break
// space planted in it. What it gives away comes from the engine.
const SAMPLE =
  "Thanks for the draft.\u200b The figures look right to me, and I\u2019ll send the signed copy on Thursday\u{e0061}\u{e0037}. See you at 10\u00a0am.";

// A formatted copy as the clipboard holds it (ChatGPT's copy button).
const COPY = "text/chatgpt-web-button";

const fmt = (n: number) => n.toLocaleString("en-US");
const hex2 = (n: number) => n.toString(16).padStart(2, "0");

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const label = (r: Report) => r.anatomy.find((p) => p.part === "label");

async function dims(bytes: Uint8Array): Promise<[number, number] | null> {
  try {
    const m = await sharp(bytes).metadata();
    return m.width && m.height ? [m.width, m.height] : null;
  } catch {
    return null;
  }
}

async function file(id: ExampleId, path: string, embed = false) {
  const bytes = new Uint8Array(fixture(path));
  const name = path.split("/").pop() ?? path;
  const input = { kind: "file" as const, name, bytes };
  const report = await inspect(input);
  const c = await clean(input);
  const output = c.output instanceof Uint8Array ? c.output : new Uint8Array();
  const plate = `/img/plate-${id}.webp`;
  const plateDims = (await dims(
    readFileSync(new URL(`.${plate}`, PUBLIC)),
  )) ?? [960, 720];
  const real = await dims(bytes);
  const format = report.format.toUpperCase();
  const cut = report.anatomy.some((p) => p.note === words.anatomy.cutShort);
  const at = label(report);
  const first = report.findings[0];
  const signer = first?.fields.find((f) => f.name === "Signer")?.value;
  const labelled = report.findings.some((f) => f.group === "ai-label");
  const ex: ExampleFile = {
    id,
    name,
    report,
    size: bytes.length,
    plate,
    thumb: `/img/thumb-${id}.webp`,
    plateDims,
    ar: real ? `${real[0]} / ${real[1]}` : `${plateDims[0]} / ${plateDims[1]}`,
    desc: real
      ? `${fmt(real[0])} × ${fmt(real[1])} ${format}`
      : `${format}${cut ? `, ${words.anatomy.cutShort.toLowerCase()}` : ""}`,
    cleaned: {
      cleaned: c.cleaned,
      removed: c.removed,
      notes: c.notes,
      size: output.length,
      same: c.cleaned && same(output, bytes),
    },
    hint: labelled ? words.webHint(name) : null,
    command: labelled ? words.removeLabels(name) : null,
  };
  if (embed) ex.bytes = Buffer.from(bytes).toString("base64");
  if (at) {
    ex.labelHead = [...bytes.subarray(at.offset, at.offset + 16)]
      .map(hex2)
      .join("");
    ex.signatureMatches =
      signer && first
        ? first.sentence === words.label.signed(signer, true)
          ? true
          : first.sentence === words.label.signed(signer, false)
            ? false
            : null
        : null;
  }
  return { ex, bytes, output };
}

export interface Examples {
  data: ExampleData;
  /** chatgpt-image.png's bytes, for the hex dumps. */
  chatgpt: Uint8Array;
}

async function makeExamples(): Promise<Examples> {
  const made = await Promise.all(
    FILES.map(({ id, path, embed }) => file(id, path, embed)),
  );
  const by = (id: ExampleId) => {
    const m = made.find((x) => x.ex.id === id);
    if (!m) throw new Error(`examples: ${id} is missing`);
    return m;
  };
  const gps = by("gps");
  const gpsClean = await inspect({
    kind: "file",
    name: "gps.clean.jpg",
    bytes: gps.output,
  });
  const text = { kind: "text" as const, plain: SAMPLE };
  const textClean = await clean(text);
  const html = fixture(`${COPY}.html`);
  const header = /StartHTML:(\d+)/.exec(html.toString("latin1"));
  return {
    data: {
      files: Object.fromEntries(made.map((m) => [m.ex.id, m.ex])) as Record<
        ExampleId,
        ExampleFile
      >,
      gpsClean,
      text: {
        plain: SAMPLE,
        clean: String(textClean.output),
        report: await inspect(text),
      },
      copy: {
        html: html.length,
        header: header ? Number(header[1]) : 0,
        plain: fixture(`${COPY}.txt`).length,
      },
    },
    chatgpt: by("chatgpt").bytes,
  };
}

export const examples: Examples = await makeExamples();
