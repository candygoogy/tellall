// The example readings in the page: the virtual module "virtual:examples"
// (example-data.ts's reports, clean results and bytes, made by the engine
// on the repo's fixtures when the page is built), and the markup in
// index.html written from the same bytes and reports: the hero's and the
// footer's hex dumps, the sidebar's example list, the formatted-copy bars,
// and the reader's first result (with the page's own reader-html.ts, so
// the window has its height at first paint).
import { fileURLToPath } from "node:url";
import type { Report } from "@tellall/engine";
import { runnerImport, type Plugin } from "vite";
import type { ExampleData } from "../src/example-types.ts";
import {
  exampleItem,
  fileViewHTML,
  statusHTML,
} from "../src/view/reader-html.ts";
import type { Examples } from "./example-data.ts";

const DATA = fileURLToPath(new URL("./example-data.ts", import.meta.url));

const fmt = (n: number) => n.toLocaleString("en-US");
const hex2 = (n: number) => n.toString(16).padStart(2, "0");
const ascii = (n: number) =>
  n >= 0x20 && n < 0x7f ? String.fromCharCode(n) : "·";
const esc = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
const label = (r: Report) => r.anatomy.find((p) => p.part === "label");

async function makeExamples(): Promise<Examples> {
  const { module } = await runnerImport<{ examples: Examples }>(DATA, {
    configFile: false,
  });
  return module.examples;
}

/** The sidebar's example list, as index.html first paints it. */
function exampleList(data: ExampleData): string {
  const dot = (r: Report) =>
    r.findings.some((f) => f.kind === "label")
      ? ["dot-label", "AI label"]
      : r.findings.some((f) => f.kind === "private")
        ? [
            "dot-private",
            r.format === "text" ? "Hidden characters" : "Personal data",
          ]
        : ["dot-none", "No marks"];
  const item = (
    key: string,
    thumb: string,
    name: string,
    r: Report,
    first: boolean,
  ) => {
    const [cls, said] = dot(r);
    return `<li><button class="file-item" type="button" data-ex="${key}"${first ? ' aria-current="true"' : ""}>${thumb}<span class="fi-name">${esc(name)}</span><span class="fi-dot ${cls}" aria-label="${said}"></span></button></li>`;
  };
  const files = Object.values(data.files).map((f, i) =>
    item(
      f.id,
      `<img class="fi-thumb" src="${f.thumb}" alt="" width="28" height="28">`,
      f.name,
      f.report,
      i === 0,
    ),
  );
  const text = item(
    "text",
    `<span class="fi-thumb fi-thumb-text" aria-hidden="true"><svg class="ic"><use href="#i-text"/></svg></span>`,
    "Example text",
    data.text.report,
    false,
  );
  return [...files, text].join("\n");
}

/** The hero's dump: the first 88 bytes of chatgpt-image.png, the header in
 * grey and the label in blue, with the rows around the label's start
 * marked for narrow screens. */
function heroDump(data: ExampleData, bytes: Uint8Array): string {
  const r = data.files.chatgpt.report;
  const at = label(r);
  if (!at) throw new Error("examples: chatgpt-image.png has no label");
  const ROWS = 11;
  const labelRow = Math.floor(at.offset / 8);
  const near = (row: number) => row >= labelRow - 1 && row <= labelRow + 2;
  const cls = (i: number) =>
    i >= at.offset && i < at.offset + at.length ? "is-label" : "is-head";
  const rows: string[] = [];
  for (let row = 0; row < ROWS; row++) {
    const idx = Array.from({ length: 8 }, (_, k) => row * 8 + k);
    const b = (i: number) => bytes[i] ?? 0;
    rows.push(
      `<p class="hd-row${near(row) ? " hd-near" : ""}"><span class="hd-off">${(row * 8).toString(16).padStart(8, "0")}</span><span class="hd-hex">${idx.map((i) => `<i class="${cls(i)}">${hex2(b(i))}</i>`).join("")}</span><span class="hd-asc">${idx.map((i) => `<i class="${cls(i)}">${esc(ascii(b(i)))}</i>`).join("")}</span></p>`,
    );
  }
  const first = (labelRow - 1) * 8;
  return [
    `<div class="hexdump" id="hexdump" aria-hidden="true" data-label-at="${at.offset}">`,
    `<p class="hd-cap">${esc(r.name)} · <span class="hd-cap-wide">bytes 0–${ROWS * 8 - 1}</span><span class="hd-cap-narrow">bytes ${first}–${first + 31}</span></p>`,
    `<p class="hd-note"><b>0x${at.offset.toString(16)}</b> C2PA label · ${fmt(at.length)} bytes</p>`,
    ...rows,
    `</div>`,
  ].join("\n");
}

/** The footer's dump: the file's last 16 bytes, the cursor resting on
 * IEND (its last 8 alone on narrow screens). */
function footDump(data: ExampleData, bytes: Uint8Array): string {
  const r = data.files.chatgpt.report;
  const n = bytes.length;
  const last = [...bytes.subarray(n - 16)];
  // A PNG ends with IEND's chunk: its length, "IEND", its checksum.
  const end = n - 8;
  const cells = last.map((v, k) => {
    const i = n - 16 + k;
    const c = [
      k < 8 ? "fd-wide" : "",
      i >= end && i < end + 4 ? "is-end" : "",
      i === end ? "cur" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return `<i${c ? ` class="${c}"` : ""}>${hex2(v)}</i>`;
  });
  const text = (a: number[]) => esc(a.map(ascii).join(""));
  return [
    `<div class="foot-dump" aria-hidden="true">`,
    `<p class="fd-cap">${esc(r.name)} · its last 16 bytes · the file ends at IEND</p>`,
    `<p class="fd-row"><span class="fd-off fd-wide">${(n - 16).toString(16).padStart(8, "0")}</span><span class="fd-off fd-narrow">${(n - 8).toString(16).padStart(8, "0")}</span><span class="fd-hex">${cells.join("")}</span><span class="fd-asc"><span class="fd-wide">${text(last.slice(0, 8))}</span>${text(last.slice(8))}</span></p>`,
    `</div>`,
  ].join("\n");
}

/** A formatted copy and the plain text, drawn to scale (widths set by
 * main.ts: the CSP allows no style attributes). */
function copyLayers(data: ExampleData): string {
  const { html, header, plain } = data.copy;
  const w = (n: number) => ((n / html) * 100).toFixed(2);
  return `<div class="fc-layers" role="list" aria-label="What a copy holds, drawn to scale">
          <div class="fc-layer fc-html" role="listitem">
            <p class="fc-kind">Formatted copy <span class="fc-size">${fmt(html)} bytes</span></p>
            <p class="fc-what">The words, plus the page's address and its markup</p>
            <div class="fc-bar" aria-hidden="true"><span class="fc-seg is-you" data-w="${w(header)}"></span><span class="fc-seg" data-w="${w(html - header)}"></span></div>
            <p class="fc-to">The first ${fmt(header)} bytes are a header that names the page. Word, OneNote and email keep it.</p>
          </div>
          <div class="fc-layer fc-plain" role="listitem">
            <p class="fc-kind">Plain text <span class="fc-size">${fmt(plain)} bytes</span></p>
            <p class="fc-what">Only the words</p>
            <div class="fc-bar" aria-hidden="true"><span class="fc-seg is-plain" data-w="${w(plain)}"></span></div>
            <p class="fc-to">What Copy clean text writes</p>
          </div>
        </div>`;
}

const ID = "virtual:examples";
const RESOLVED = "\0" + ID;

/** virtual:examples, and the example markup in index.html. */
export function examples(): Plugin {
  let made: Promise<Examples> | undefined;
  const get = () => (made ??= makeExamples());
  return {
    name: "tellall-examples",
    resolveId: (id) => (id === ID ? RESOLVED : undefined),
    async load(id) {
      if (id !== RESOLVED) return;
      return `export default ${JSON.stringify((await get()).data)};`;
    },
    transformIndexHtml: {
      order: "pre",
      async handler(html) {
        const { data, chatgpt } = await get();
        const parts: Record<string, string> = {
          hexdump: heroDump(data, chatgpt),
          footdump: footDump(data, chatgpt),
          list: exampleList(data),
          copy: copyLayers(data),
          // What result.ts shows first (FIRST), as it draws it.
          reader: fileViewHTML(exampleItem(data.files.chatgpt), true),
          status: statusHTML("Example result"),
        };
        return html.replace(/<!-- examples:(\w+) -->/g, (tag, key: string) => {
          const part = parts[key];
          if (part === undefined) throw new Error(`index.html: no ${tag}`);
          return part;
        });
      },
    },
  };
}
