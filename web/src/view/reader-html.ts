// The reader's markup as plain strings: no DOM, no motion, nothing that
// needs a browser. The page draws each result with it (result.ts), and the
// build draws the first example with it into index.html (build/examples.ts),
// so the window has its full height at first paint and nothing below it
// moves when the script arrives.
import type { Report } from "@tellall/engine";
import { cleanName, esc, fmt } from "../dom.ts";
import type { ExampleFile } from "../example-types.ts";
import type { CleanedCopy } from "../protocol.ts";
import { sentenceHTML } from "./text.ts";

export type Part = Report["anatomy"][number];

export interface Item {
  id: string;
  kind: "file" | "text";
  name: string;
  live: boolean;
  state?: "reading" | "done" | "error" | "paste";
  report?: Report;
  /** The file's size in bytes. */
  size?: number;
  plate?: string;
  plateDims?: [number, number];
  ar?: string;
  desc?: string;
  thumbUrl?: string;
  file?: File;
  cleaned?: CleanedCopy;
  cleanUrl?: string;
  /** The clean copy, once: the download link and the zip share it. */
  cleanBlob?: Blob;
  hint?: string | null;
  /** The command in the hint: the file name quoted for a shell. */
  command?: string | null;
  ms?: number;
  error?: string;
  /** Examples: what the clean copy would be, said instead of a button. */
  note?: string;
  /** Examples: the file itself, so its download runs the real engine. */
  bytes?: string;
  /** Text: the text, and its clean copy. */
  plain?: string;
  cleanText?: string;
}

/** What the line under the bar says at rest; the stylesheet shows the one
 * for the visitor's pointer (responsive.css, .if-fine and .if-touch). */
export const POINT_TEXT =
  `<span class="if-fine">Point at a part or a sentence to see where it sits.</span>` +
  `<span class="if-touch">Tap a part or a sentence to see where it sits.</span>`;

export function exampleItem(f: ExampleFile): Item {
  const item: Item = {
    id: f.id,
    kind: "file",
    name: f.name,
    live: false,
    report: f.report,
    size: f.size,
    plate: f.plate,
    plateDims: f.plateDims,
    ar: f.ar,
    desc: f.desc,
    hint: f.hint,
    command: f.command,
  };
  if (f.bytes && f.cleaned.cleaned && f.cleaned.removed.length) {
    item.bytes = f.bytes;
  } else {
    item.note = f.cleaned.notes.join(" ");
  }
  return item;
}

/** A part's share of the file, as a percentage said in words. */
export function pct(len: number, total: number): string {
  const p = (len / total) * 100;
  if (p < 0.01) return "under 0.01";
  if (p < 1) return p.toFixed(2);
  return p.toFixed(1);
}

/** For a file that is mostly one part: the bytes before (or after) it,
 * with a little of it, to show enlarged. */
export function zoomRange(
  parts: Part[],
  total: number,
): [number, number] | null {
  const dom = parts.reduce<Part | undefined>(
    (m, p) => (!m || p.length > m.length ? p : m),
    undefined,
  );
  if (!dom || dom.length / total < 0.8) return null;
  if (dom.offset > 0) {
    return [0, Math.min(total, Math.ceil(dom.offset * 1.08) + 1)];
  }
  const tailStart = dom.offset + dom.length;
  const tail = total - tailStart;
  return [Math.max(0, Math.floor(tailStart - tail * 0.08) - 1), total];
}

/** The key under the bar: one entry per kind of part it has. */
export function keysHTML(parts: Part[]): string {
  const has = (k: Part["part"]) => parts.some((p) => p.part === k);
  const keys: string[] = [];
  if (has("label")) keys.push(`<span class="an-key k-label">AI label</span>`);
  if (has("metadata")) {
    keys.push(`<span class="an-key k-metadata">About you</span>`);
  }
  if (has("pixels")) {
    keys.push(`<span class="an-key k-pixels">Picture data</span>`);
  }
  if (has("header") || has("other")) {
    keys.push(`<span class="an-key k-structure">File structure</span>`);
  }
  return keys.join("");
}

/** The window's status, long and short ("Read on this device in 12 ms",
 * "12 ms"). */
export function statusHTML(text: string): string {
  const short = /in (\d[\d,]*) ms$/.exec(text);
  return `<span class="st-long">${esc(text)}</span><span class="st-short">${esc(short ? short[1] + " ms" : text === "Example result" ? "Example" : text)}</span>`;
}

/** The picture. `hold`: only its place, the same size; the build's first
 * paint uses it so the picture's download doesn't hold up the fonts', and
 * result.ts puts the picture in when the script runs. */
export function plateHTML(item: Item, hold = false): string {
  const src = item.thumbUrl || item.plate;
  const alt = item.plate
    ? `Abstract plate standing in for the picture in ${item.name}`
    : `Preview of ${item.name}`;
  const dims = item.plateDims
    ? ` width="${item.plateDims[0]}" height="${item.plateDims[1]}"`
    : "";
  const pic = hold
    ? `<span class="hold" aria-hidden="true"></span>`
    : src
      ? `<img src="${esc(src)}" alt="${esc(alt)}"${dims} decoding="async">`
      : `<div class="noprev">No preview</div>`;
  return `<figure class="rv-plate">${pic}<span class="scan" aria-hidden="true"></span></figure>`;
}
export function findingsHTML(r: Report): string {
  return r.findings
    .map(
      (f, i) =>
        `<li><button class="finding" type="button" data-i="${i}" aria-describedby="find-desc"><span class="f-mark k-${f.kind}" aria-hidden="true"></span><span class="f-text">${sentenceHTML(f.sentence)}</span></button></li>`,
    )
    .join("");
}
function allHTML(r: Report): string {
  const rows = r.findings.flatMap((f) => f.fields);
  if (!rows.length) return "";
  return `<details class="all"><summary>Show everything</summary><table class="raw"><thead><tr><th scope="col">Field</th><th scope="col">Value</th><th scope="col">From</th></tr></thead><tbody>${rows.map((x) => `<tr><th scope="row">${esc(x.name)}</th><td>${esc(x.value)}</td><td class="from">${esc(x.from)}</td></tr>`).join("")}</tbody></table></details>`;
}
/** The hint under a label, its command set as code. */
export function hintHTML(sentence: string, cmd: string): string {
  const i = sentence.indexOf(cmd);
  if (i < 0) return esc(sentence);
  return (
    esc(sentence.slice(0, i)) +
    `<code translate="no">${esc(cmd)}</code>` +
    esc(sentence.slice(i + cmd.length))
  );
}
function actionsHTML(item: Item): string {
  const r = item.report as Report;
  let left = "";
  if (item.live) {
    const c = item.cleaned;
    if (c?.cleaned && item.cleanUrl) {
      const removed = c.removed.length > 0;
      left = `<a class="btn ${removed ? "btn-primary" : "btn-secondary"} btn-sm js-dl" href="${esc(item.cleanUrl)}" download="${esc(cleanName(item.name))}"><svg class="ic" aria-hidden="true"><use href="#i-down"/></svg>Download clean copy</a>`;
      if (c.notes.length)
        left += `<p class="rv-note">${esc(c.notes.join(" "))}</p>`;
    } else if (c) {
      left = `<p class="rv-note">${esc(c.notes.join(" "))}</p>`;
    }
  } else if (item.bytes) {
    left = `<button class="btn btn-primary btn-sm js-dl-example" type="button"><svg class="ic" aria-hidden="true"><use href="#i-down"/></svg>Download clean copy</button>`;
  } else if (item.note) {
    left = `<p class="rv-note">${esc(item.note)}</p>`;
  }
  const hint =
    item.hint && item.command && r.findings.some((f) => f.group === "ai-label")
      ? `<p class="hint"><span class="hint-text">${hintHTML(item.hint, item.command)}</span><button class="icon-btn js-copy-hint" type="button" aria-label="Copy the command"><svg class="ic" aria-hidden="true"><use href="#i-copy"/></svg></button></p>`
      : "";
  return `<div class="rv-actions">${left}${hint}</div>`;
}
/** A file's result: the file to scale (its bars drawn by result.ts), the
 * picture (`hold`: its place only, see plateHTML), the engine's headline
 * and sentences, and the actions. */
export function fileViewHTML(item: Item, hold = false): string {
  const r = item.report as Report;
  const total = item.size ?? 0;
  const meta = [
    item.desc ||
      (r.format === "unknown" ? "Unknown format" : r.format.toUpperCase()),
    `${fmt(total)} bytes`,
  ].join(" · ");
  const zoom = zoomRange(r.anatomy, total);
  return `
      <div class="rv-anatomy">
        <p class="an-head"><span class="an-head-l"><span>The file, to scale</span><span class="an-keys">${keysHTML(r.anatomy)}</span></span><span><b class="an-count">${fmt(total)}</b> bytes</span></p>
        ${zoom ? `<div class="an-zoom-wrap"><div class="bar an-zoom-bar an-zoom" aria-hidden="true"></div><svg class="an-connect" viewBox="0 0 1000 22" preserveAspectRatio="none" aria-hidden="true"><path/><line class="ln-a"/><line class="ln-b"/></svg></div>` : ""}
        <div class="bar an-main" role="group" aria-label="The file's parts, to scale. Bytes 0 to ${fmt(total)}."></div>
        <p class="an-scale" aria-hidden="true"><span>Byte 0</span>${zoom ? `<span class="an-zoom-note">Top row: the ${zoom[0] === 0 ? "first" : "last"} ${fmt(zoom[1] - zoom[0])} bytes, enlarged</span>` : ""}<span>${fmt(total)}</span></p>
        <p class="an-detail" aria-live="polite">${POINT_TEXT}</p>
      </div>
      <div class="rv-top">
        <div>${plateHTML(item, hold)}<p class="rv-cap">${esc(meta)}</p></div>
        <div class="rv-report" tabindex="-1">
          <h2 class="rv-headline${r.empty ? " is-empty" : ""}" tabindex="-1">${esc(r.headline)}</h2>
          <ul class="rv-findings">${findingsHTML(r)}</ul>
          ${allHTML(r)}
        </div>
      </div>
      ${actionsHTML(item)}`;
}
