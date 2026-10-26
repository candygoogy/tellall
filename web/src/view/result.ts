// The reader window in the hero: a sidebar of files (the examples, then
// the visitor's own) and one result at a time. A result is the engine's
// headline, its sentences, "Show everything" with the raw fields and where
// each came from, the file drawn to scale, and the clean-copy actions.
// The markup is reader-html.ts's; the first example's is already in
// index.html when the page arrives.
import type { Report } from "@tellall/engine";
import examples from "virtual:examples";
import {
  $,
  $$,
  cleanName,
  copyText,
  esc,
  flashIcon,
  fmt,
  b64,
  download,
  maybe,
} from "../dom.ts";
import { read } from "../engine.ts";
import {
  EASE,
  FADE,
  G,
  STEP,
  TICK,
  fadeIn,
  motion,
  swap,
  typeTitle,
} from "../motion.ts";
import {
  GROUP_PARTS,
  KIND_NAME,
  attachCursor,
  buildBar,
  fitNames,
  layoutHits,
  wireHits,
} from "./anatomy.ts";
import {
  POINT_TEXT,
  exampleItem,
  fileViewHTML,
  findingsHTML,
  pct,
  plateHTML,
  statusHTML,
  zoomRange,
  type Item,
} from "./reader-html.ts";
import { chipClass, renderChips } from "./text.ts";

export { hintHTML, type Item } from "./reader-html.ts";

const NOTE =
  "Formatted copies can carry the page's address into apps like Word and OneNote; Copy clean text copies plain text only.";

export const EX: Record<string, Item> = {
  ...Object.fromEntries(
    Object.values(examples.files).map((f) => [f.id, exampleItem(f)]),
  ),
  text: {
    id: "text",
    kind: "text",
    name: "Example text",
    live: false,
    report: examples.text.report,
    plain: examples.text.plain,
    cleanText: examples.text.clean,
  },
};
export const FIRST = EX["chatgpt"] as Item;

const view = () => $("#r-view");
/** The visitor's own files and texts, newest first. */
export const live: Item[] = [];
export let current: Item = FIRST;
let readingTL: gsap.core.Timeline | null = null;
let pinned: number | null = null;

/** The paste view (paste.ts) draws into the window through this. */
let pasteView: ((view: HTMLElement) => void) | null = null;
export const onPasteView = (draw: (view: HTMLElement) => void) => {
  pasteView = draw;
};

function textViewHTML(item: Item): string {
  const r = item.report as Report;
  return `
      <div class="rv-text-body">
        <h2 class="rv-headline" tabindex="-1">${esc(r.headline)}</h2>
        <div class="tx-wrap">
          <div class="tx" tabindex="0" role="region" aria-label="${esc(item.name)}, with hidden characters marked"></div>
          <div class="pmap" aria-hidden="true"></div>
        </div>
        <div class="rv-report rv-report-text"><ul class="rv-findings">${findingsHTML(r)}</ul></div>
      </div>
      <div class="rv-actions">
        <button class="btn btn-primary btn-sm js-copy-clean" type="button"><svg class="ic" aria-hidden="true"><use href="#i-copy"/></svg><span>Copy clean text</span></button>
        <p class="rv-note js-copy-status" aria-live="polite"></p>
        <p class="hint">${NOTE}</p>
      </div>`;
}
function readingViewHTML(item: Item): string {
  if (item.kind === "text") {
    return `<div class="rv-text-body"><div class="rv-report"><p class="rv-status">Reading the pasted text on this device…</p></div></div>`;
  }
  return `<div class="rv-top"><div>${plateHTML(item)}<p class="rv-cap">${esc(fmt(item.size ?? 0))} bytes</p></div>
      <div class="rv-report"><p class="rv-status">Reading ${esc(item.name)} on this device…</p></div></div>`;
}
function errorViewHTML(item: Item): string {
  const file = item.kind === "file";
  return `<div class="rv-top">${file ? `<div>${plateHTML(item)}</div>` : ""}<div class="rv-report">
      <h2 class="rv-headline is-empty" tabindex="-1">tellall couldn't read this ${file ? "file" : "text"}.</h2>
      <p class="rv-note rv-err"></p>
      ${file ? `<div class="hero-actions"><button class="btn btn-secondary btn-sm js-choose" type="button">Choose another image</button></div>` : ""}</div></div>`;
}

function wireFileView(item: Item): void {
  const v = view();
  const r = item.report as Report;
  const total = item.size ?? 0;
  const main = $(".an-main", v);
  const zoomBar = maybe(".an-zoom-bar", v);
  const detail = $(".an-detail", v);
  const zoom = zoomRange(r.anatomy, total);
  const segs = buildBar(main, r.anatomy, total, null, {
    minPct: 0.8,
    names: (s) =>
      s.p.part === "pixels"
        ? `${KIND_NAME.pixels} · ${pct(s.p.length, total)}%`
        : s.p.note,
  });
  if (zoomBar && zoom) {
    buildBar(zoomBar, r.anatomy, total, zoom, {
      minPct: 0.6,
      focusable: false,
      short: (s) =>
        s.p.part === "label" ? `AI label · ${fmt(s.p.length)} B` : "",
      names: (s) =>
        s.p.part === "label"
          ? `${s.p.note} · ${fmt(s.p.length)} B`
          : s.p.part === "pixels"
            ? "Picture data begins"
            : s.p.note,
    });
    // Connectors from the enlarged range on the main bar up to the
    // full-width zoom row.
    const small = segs.filter((s) => s.a < zoom[1]);
    const last = small[small.length - 1];
    const x1 = last ? Math.min(100, last.x + last.w) : 2;
    const svg = $(".an-connect", v);
    const X0 = 0;
    const X1 = Math.max(x1 * 10, 6);
    $("path", svg).setAttribute("d", `M0 0 L1000 0 L${X1} 22 L${X0} 22 Z`);
    const a = $(".ln-a", svg);
    const b = $(".ln-b", svg);
    a.setAttribute("x1", "0");
    a.setAttribute("y1", "0");
    a.setAttribute("x2", String(X0));
    a.setAttribute("y2", "22");
    b.setAttribute("x1", "1000");
    b.setAttribute("y1", "0");
    b.setAttribute("x2", String(X1));
    b.setAttribute("y2", "22");
  }
  requestAnimationFrame(() => fitNames(v));
  attachCursor(main);
  attachCursor(zoomBar);

  const findings = $$(".finding", v);
  const partsOf = (i: number) => {
    const f = r.findings[i];
    if (!f) return [];
    const kinds = GROUP_PARTS[f.group] ?? [];
    if (f.kind === "info" && f.group === "location") return [];
    return r.anatomy
      .map((p, k) => (kinds.includes(p.part) ? k : -1))
      .filter((k) => k >= 0);
  };
  const light = (idxs: number[] | null, text?: string) => {
    for (const bar of [main, zoomBar]) {
      if (!bar) continue;
      bar.classList.toggle("is-focus", idxs !== null);
      $$(".part", bar).forEach((p) =>
        p.classList.toggle(
          "is-on",
          idxs !== null && idxs.includes(Number(p.dataset["pi"])),
        ),
      );
    }
    detail.innerHTML = text || POINT_TEXT;
  };
  const partText = (i: number) => {
    const p = r.anatomy[i];
    if (!p) return "";
    return `<b>${esc(p.note)}</b> · ${fmt(p.length)} bytes at byte ${fmt(p.offset)} · ${pct(p.length, total)}% of the file`;
  };
  const findText = (i: number, idxs: number[]) => {
    const f = r.findings[i];
    if (!idxs.length) {
      return f?.kind === "info"
        ? "No part of this file is metadata about you."
        : "This finding has no bytes of its own.";
    }
    const bytes = idxs.reduce((n, k) => n + (r.anatomy[k]?.length ?? 0), 0);
    const one = idxs.length === 1 ? r.anatomy[idxs[0] ?? 0] : undefined;
    return `<b>${one ? esc(one.note) : idxs.length + " parts"}</b> · ${fmt(bytes)} bytes · ${pct(bytes, total)}% of the file`;
  };
  const restore = () => {
    if (pinned !== null) {
      const ix = partsOf(pinned);
      light(ix, findText(pinned, ix));
    } else light(null);
  };
  // One handler for a target that covers one or several parts.
  const hover = (el: HTMLElement, idxs: number[]) => {
    const on = () => {
      light(
        idxs,
        idxs.length === 1
          ? partText(idxs[0] ?? 0)
          : `<b>${idxs.length} parts</b> · ${idxs.map((k) => esc(r.anatomy[k]?.note)).join("; ")} · ${fmt(idxs.reduce((n, k) => n + (r.anatomy[k]?.length ?? 0), 0))} bytes`,
      );
      findings.forEach((fb) =>
        fb.classList.toggle(
          "is-on",
          partsOf(Number(fb.dataset["i"])).some((k) => idxs.includes(k)),
        ),
      );
    };
    const off = () => {
      findings.forEach((fb) =>
        fb.classList.toggle("is-on", pinned === Number(fb.dataset["i"])),
      );
      restore();
    };
    el.addEventListener("pointerenter", on);
    el.addEventListener("pointerleave", off);
    el.addEventListener("focus", on);
    el.addEventListener("blur", off);
  };
  if (zoomBar) {
    $$(".part", zoomBar).forEach((p) => hover(p, [Number(p.dataset["pi"])]));
  }
  wireHits(main, (btn) =>
    hover(btn, (btn.dataset["pis"] ?? "").split(",").map(Number)),
  );
  layoutHits(main);
  findings.forEach((fb) => {
    const i = Number(fb.dataset["i"]);
    const on = () => {
      const ix = partsOf(i);
      light(ix, findText(i, ix));
    };
    fb.addEventListener("pointerenter", on);
    fb.addEventListener("focus", on);
    fb.addEventListener("pointerleave", restore);
    fb.addEventListener("blur", restore);
    fb.addEventListener("click", () => {
      pinned = pinned === i ? null : i;
      findings.forEach((x) => {
        const mine = pinned === Number(x.dataset["i"]);
        x.classList.toggle("is-on", mine);
        x.setAttribute("aria-pressed", mine ? "true" : "false");
      });
      restore();
    });
    fb.setAttribute("aria-pressed", "false");
  });
  wireActions(item);
}

function wireActions(item: Item): void {
  const v = view();
  const hintBtn = maybe(".js-copy-hint", v);
  hintBtn?.addEventListener("click", async () => {
    const ok = item.command ? await copyText(item.command) : false;
    flashIcon(hintBtn, ok);
  });
  const exBtn = maybe<HTMLButtonElement>(".js-dl-example", v);
  if (exBtn && item.bytes) {
    const bytes = item.bytes;
    exBtn.addEventListener("click", async () => {
      exBtn.disabled = true;
      const note = document.createElement("p");
      note.className = "rv-note";
      try {
        const res = await read({
          kind: "file",
          name: item.name,
          bytes: b64(bytes),
        });
        const c = res.cleaned;
        if (c.cleaned && c.output instanceof Uint8Array) {
          download(
            new Blob([c.output as Uint8Array<ArrayBuffer>], {
              type: "image/jpeg",
            }),
            cleanName(item.name),
          );
          note.textContent = `Saved ${cleanName(item.name)}: ${fmt(c.output.byteLength)} bytes, ${fmt((item.size ?? 0) - c.output.byteLength)} bytes of personal data removed.`;
        } else note.textContent = c.notes.join(" ");
      } catch (err) {
        note.textContent =
          "tellall couldn't make the copy: " + (err as Error).message;
      } finally {
        exBtn.disabled = false;
      }
      exBtn.parentElement?.querySelector(".rv-note")?.remove();
      exBtn.after(note);
    });
  }
}

function wireTextView(item: Item): void {
  const v = view();
  const box = $(".tx", v);
  const mapEl = $(".pmap", v);
  const report = item.report as Report;
  renderChips(box, mapEl, item.plain ?? "", report);
  const lightChips = (cls: string | null) => {
    $$(".chip", box).forEach((c) =>
      c.classList.toggle("is-on", !!cls && c.classList.contains(cls)),
    );
  };
  $$(".finding", v).forEach((fb) => {
    const f = report.findings[Number(fb.dataset["i"])];
    if (!f) return;
    const cls = chipClass(f.kind);
    fb.addEventListener("pointerenter", () => lightChips(cls));
    fb.addEventListener("focus", () => lightChips(cls));
    fb.addEventListener("pointerleave", () => lightChips(null));
    fb.addEventListener("blur", () => lightChips(null));
  });
  const btn = $(".js-copy-clean", v);
  const status = $(".js-copy-status", v);
  btn.addEventListener("click", async () => {
    const out = item.cleaned?.output;
    const text = item.cleanText ?? (typeof out === "string" ? out : "");
    const ok = await copyText(text);
    status.textContent = ok
      ? `Copied ${fmt([...text].length)} characters as plain text.`
      : "The browser didn't allow copying. Select the text and copy it instead.";
  });
}

const statusFor = (item: Item) =>
  !item.live
    ? "Example result"
    : item.kind === "file" && item.report && !item.report.anatomy.length
      ? "Couldn't read on this device"
      : `Read on this device in ${fmt(Math.max(1, item.ms ?? 0))} ms`;

export function setStatus(text: string, reading: boolean): void {
  $("#r-status-text").innerHTML = statusHTML(text);
  $("#r-status").classList.toggle("is-reading", reading);
}
function setCrumbs(item: Item): void {
  $("#r-group").textContent = item.live ? "Your files" : "Examples";
  $("#r-name").textContent = item.name;
}
function markCurrent(): void {
  $$(".file-item").forEach((b) =>
    b.setAttribute(
      "aria-current",
      b.dataset["ex"] === current.id || b.dataset["live"] === current.id
        ? "true"
        : "false",
    ),
  );
}
function announce(item: Item): void {
  if (item.report)
    $("#r-live").textContent = `${item.name}: ${item.report.headline}`;
}

export type Mode = "swap" | "intro" | "none";

export function show(item: Item, mode: Mode = "swap"): void {
  current = item;
  pinned = null;
  markCurrent();
  setCrumbs(item);
  if (readingTL) {
    readingTL.kill();
    readingTL = null;
  }
  const v = view();
  const build = () => {
    if (item.state === "paste") {
      pasteView?.(v);
      setStatus("Ready", false);
      return;
    }
    if (item.state === "reading") {
      v.innerHTML = readingViewHTML(item);
      setPlateRatio(item);
      setStatus("Reading…", true);
      loopScan();
      return;
    }
    if (item.state === "error") {
      v.innerHTML = errorViewHTML(item);
      setPlateRatio(item);
      $(".rv-note", v).textContent = item.error ?? "";
      setStatus("Couldn't read", false);
      return;
    }
    if (item.kind === "text") {
      v.innerHTML = textViewHTML(item);
      wireTextView(item);
    } else {
      v.innerHTML = fileViewHTML(item);
      setPlateRatio(item);
      wireFileView(item);
    }
    setStatus(statusFor(item), false);
    announce(item);
    play(mode);
  };
  if (motion() && mode === "swap" && v.childElementCount) {
    swap(v, build);
  } else {
    build();
    G.set(v, { opacity: 1 });
    if (mode === "swap") fadeIn(v);
  }
}

/** The picture's own shape; a preview the browser can't draw becomes "No
 * preview", or, for a HEIC, the browser's video decoder draws it. */
function setPlateRatio(item: Item): void {
  const v = view();
  const img = maybe<HTMLImageElement>(".rv-plate img", v);
  const heic = !!item.file && /\.(heic|heif)$/i.test(item.name);
  if (!img) {
    const none = maybe(".rv-plate .noprev", v);
    if (none && heic) void heicPlate(item, none);
    return;
  }
  if (item.ar) img.style.setProperty("--ar", item.ar);
  if (!item.thumbUrl) return;
  img.addEventListener(
    "error",
    () => {
      const figure = img.parentElement;
      img.remove();
      const n = document.createElement("div");
      n.className = "noprev";
      n.textContent = "No preview";
      figure?.prepend(n);
      if (heic) void heicPlate(item, n);
    },
    { once: true },
  );
}

async function heicPlate(item: Item, slot: HTMLElement): Promise<void> {
  try {
    const { heicPreview } = await import("../heic-preview.ts");
    const bytes = new Uint8Array(await (item.file as File).arrayBuffer());
    const drawn = await heicPreview(bytes);
    if (!drawn || !slot.isConnected) return;
    drawn.canvas.className = "rv-canvas";
    drawn.canvas.setAttribute("role", "img");
    drawn.canvas.setAttribute("aria-label", `Preview of ${item.name}`);
    slot.replaceWith(drawn.canvas);
    void drawn.sharpen();
  } catch {
    // "No preview" stays.
  }
}

function loopScan(): void {
  if (!motion()) return;
  const v = view();
  const scan = maybe(".scan", v);
  const plate = maybe(".rv-plate", v);
  if (!scan || !plate) return;
  readingTL = G.timeline({ repeat: -1 });
  const n = Math.max(2, Math.round(0.9 / TICK));
  G.set(scan, { height: plate.clientHeight / n });
  readingTL
    .fromTo(
      scan,
      { y: 0, opacity: 1 },
      {
        y: () => plate.clientHeight - plate.clientHeight / n,
        duration: 0.9,
        ease: `steps(${n - 1})`,
      },
    )
    .to(scan, { opacity: 0, duration: 0.01 });
}

/** The reading: a scan over the picture, the bar fills to scale, the
 * enlarged label row opens, then the sentences arrive one by one. */
export function play(mode: Mode, paused = false): gsap.core.Timeline | null {
  if (!motion() || mode === "none") return null;
  const v = view();
  const k = mode === "intro" ? 1 : 0.34;
  const tl = G.timeline({ defaults: { ease: EASE }, paused });
  readingTL = tl;
  const scan = maybe(".scan", v);
  const plate = maybe(".rv-plate", v);
  const head = maybe(".rv-headline", v);
  const items = $$(".rv-findings li", v);
  const main = maybe(".an-main", v);
  const zoomWrap = maybe(".an-zoom-wrap", v);
  const count = maybe(".an-count", v);
  const actions = maybe(".rv-actions", v);
  const all = maybe(".all", v);
  const chips = $$(".tx .chip", v);
  const ticks = $$(".pmap-tick", v);
  const tx = maybe(".tx", v);
  const item = current;
  if (mode === "intro") setStatus("Reading…", true);
  // The picture arrives, then the cursor block steps down it row by row.
  if (plate) tl.fromTo(plate, { opacity: 0 }, { opacity: 1, ...FADE }, 0);
  if (scan && plate) {
    // The scan block is one row of the picture tall and steps down one
    // row per tick.
    const rows = Math.max(3, Math.round((1.25 * k) / TICK));
    tl.set(scan, { height: () => plate.clientHeight / rows }, 0)
      .fromTo(
        scan,
        { y: 0, opacity: 0 },
        { opacity: 1, duration: 0.01 },
        0.15 * k,
      )
      .to(
        scan,
        {
          y: () => plate.clientHeight - plate.clientHeight / rows,
          duration: 1.25 * k,
          ease: `steps(${rows - 1})`,
        },
        0.15 * k,
      )
      .to(scan, { opacity: 0, duration: 0.01 }, ">");
  }
  // The file fills to scale in cursor ticks while the byte count runs up.
  if (main) {
    tl.fromTo(
      main,
      { clipPath: "inset(0 100% 0 0)" },
      {
        clipPath: "inset(0 0% 0 0)",
        duration: 1.25 * k,
        ease: STEP(1.25 * k),
        clearProps: "clipPath",
      },
      0.2 * k,
    );
    if (count) {
      const total = item.size ?? 0;
      const o = { v: 0 };
      tl.to(
        o,
        {
          v: total,
          duration: 1.25 * k,
          ease: STEP(1.25 * k),
          onUpdate: () => {
            count.textContent = fmt(o.v);
          },
        },
        0.2 * k,
      );
    }
  }
  if (zoomWrap) {
    const zf = $$(".an-zoom .fill", zoomWrap);
    tl.fromTo(zoomWrap, { opacity: 0 }, { opacity: 1, ...FADE }, 0.95 * k)
      .fromTo(
        $(".an-connect", zoomWrap),
        { scaleY: 0, transformOrigin: "50% 100%" },
        { scaleY: 1, duration: 0.3 * k, ease: STEP(0.3 * k) },
        0.95 * k,
      )
      .fromTo(
        zf,
        { scaleX: 0 },
        {
          scaleX: 1,
          duration: 0.5 * k,
          ease: STEP(0.5 * k),
          stagger: 0.08 * k,
        },
        1.0 * k,
      );
  }
  if (tx) tl.fromTo(tx, { opacity: 0 }, { opacity: 1, ...FADE }, 0.1);
  // Hidden characters are marked one at a time, like the cursor setting
  // each one down.
  if (chips.length) {
    tl.fromTo(
      chips,
      { opacity: 0 },
      {
        opacity: 1,
        duration: 0.01,
        stagger: 0.09 * Math.max(k, 0.5),
        clearProps: "opacity",
      },
      0.5 * k,
    );
  }
  if (ticks.length) {
    tl.fromTo(
      ticks,
      { opacity: 0 },
      { opacity: 1, duration: 0.01, stagger: 0.09 * Math.max(k, 0.5) },
      0.5 * k,
    );
  }
  const at = mode === "intro" ? 1.35 : 0.5;
  // The engine's headline is set by the cursor, word by word, readable
  // within half a second.
  if (head) {
    const t = typeTitle(head, mode === "intro" ? 0.06 : 0.035);
    if (t) tl.add(t.play(), at);
  }
  if (items.length) {
    tl.fromTo(
      items,
      { opacity: 0 },
      { opacity: 1, ...FADE, stagger: mode === "intro" ? 0.16 : 0.05 },
      at + 0.35 * k,
    );
    // Each sentence arriving lights the bytes it comes from, briefly.
    if (mode === "intro" && main && item.report) {
      const report = item.report;
      items.forEach((_li, j) => {
        const f = report.findings[j];
        if (!f || f.kind === "info") return;
        const kinds = GROUP_PARTS[f.group] ?? [];
        tl.add(
          () => {
            $$(".part", v).forEach((p) => {
              if (!kinds.includes(p.dataset["kind"] as never)) return;
              G.fromTo(
                $(".fill", p),
                { filter: "brightness(1.9)" },
                {
                  filter: "brightness(1)",
                  duration: 0.4,
                  ease: "none",
                  clearProps: "filter",
                },
              );
            });
          },
          at + 0.35 * k + j * 0.16 * k,
        );
      });
    }
  }
  if (all) tl.fromTo(all, { opacity: 0 }, { opacity: 1, ...FADE }, ">-0.1");
  if (actions)
    tl.fromTo(actions, { opacity: 0 }, { opacity: 1, ...FADE }, ">-0.1");
  tl.add(() => {
    setStatus(statusFor(current), false);
    readingTL = null;
  });
  return tl;
}

/** The intro's reading, handed back by main.ts when it starts playing. */
export const setReading = (tl: gsap.core.Timeline | null) => {
  readingTL = tl;
};

/* ------------------------------------------------------- the visitor's files */

function dot(item: Item): [string, string] {
  if (item.state === "reading") return ["dot-reading", "Reading"];
  if (item.state === "error" || !item.report) return ["dot-none", "No marks"];
  const f = item.report.findings;
  if (f.some((x) => x.kind === "label")) return ["dot-label", "AI label"];
  if (f.some((x) => x.kind === "private")) {
    return [
      "dot-private",
      item.kind === "text" ? "Hidden characters" : "Personal data",
    ];
  }
  return ["dot-none", "No marks"];
}

interface Row {
  li: HTMLLIElement;
  dot: HTMLSpanElement;
  /** The thumbnail's slot, and the picture it shows. */
  thumb: HTMLElement;
  src?: string;
}
const rows = new Map<Item, Row>();

const icon = (name: "text" | "image") => {
  const s = document.createElement("span");
  s.className = "fi-thumb fi-thumb-text";
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = `<svg class="ic"><use href="#i-${name}"/></svg>`;
  return s;
};

/** The row's thumbnail, once the small copy of the picture is made. */
function setThumb(row: Row, src: string | undefined): void {
  if (!src || row.src === src) return;
  row.src = src;
  const img = document.createElement("img");
  img.className = "fi-thumb";
  img.alt = "";
  img.width = 28;
  img.height = 28;
  img.decoding = "async";
  img.src = src;
  img.addEventListener("error", () => img.replaceWith(icon("image")), {
    once: true,
  });
  row.thumb.replaceWith(img);
  row.thumb = img;
}

function liveRow(item: Item): Row {
  const li = document.createElement("li");
  const b = document.createElement("button");
  b.type = "button";
  b.className = "file-item";
  b.dataset["live"] = item.id;
  const thumb = icon(item.kind === "text" ? "text" : "image");
  b.appendChild(thumb);
  const name = document.createElement("span");
  name.className = "fi-name";
  name.textContent = item.name;
  b.appendChild(name);
  const d = document.createElement("span");
  b.appendChild(d);
  b.addEventListener("click", () => {
    if (item !== current) show(item, "swap");
  });
  li.appendChild(b);
  const row: Row = { li, dot: d, thumb };
  rows.set(item, row);
  return row;
}

/** Keeps at most `most` of the visitor's files and texts: the oldest
 * finished ones beyond it go, their pictures and clean copies freed. One
 * still being read, or on screen, stays. */
export function prune(most: number): void {
  for (let i = live.length - 1; i >= 0 && live.length > most; i--) {
    const item = live[i];
    if (!item || item === current || item.state === "reading") continue;
    if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
    if (item.cleanUrl) URL.revokeObjectURL(item.cleanUrl);
    rows.get(item)?.li.remove();
    rows.delete(item);
    live.splice(i, 1);
  }
}

/** The sidebar's "Your files": each row made once, its dot kept current. */
export function renderLiveList(): void {
  const list = $("#side-live-list");
  $("#side-live").hidden = live.length === 0;
  let before: Element | null = list.firstElementChild;
  for (const item of live) {
    const row = rows.get(item) ?? liveRow(item);
    setThumb(row, item.thumbUrl);
    const [cls, said] = dot(item);
    row.dot.className = "fi-dot " + cls;
    row.dot.setAttribute("aria-label", said);
    if (row.li !== before) list.insertBefore(row.li, before);
    before = row.li.nextElementSibling;
  }
  const files = live.filter((x) => x.kind === "file");
  const done = files.filter((x) => x.state === "done" && x.cleanBlob);
  $("#dl-all").hidden = files.length < 2 || done.length < 2;
  markCurrent();
}

export function bringReaderIntoView(): void {
  const nav = $("#nav");
  const y = Math.max(
    0,
    scrollY + $("#stage").getBoundingClientRect().top - (nav.offsetHeight + 12),
  );
  if (Math.abs(y - scrollY) > 4) {
    window.scrollTo({ top: y, behavior: motion() ? "smooth" : "auto" });
  }
}

/** Sidebar examples, the replay button and the resize upkeep. */
export function initReader(): void {
  $$("#side-examples .file-item").forEach((b) =>
    b.addEventListener("click", () => {
      const ex = EX[b.dataset["ex"] ?? ""];
      if (ex && ex !== current) show(ex, "swap");
    }),
  );
  $("#r-replay").addEventListener("click", () => show(current, "intro"));
  addEventListener("resize", () => {
    fitNames(view());
    layoutHits(maybe(".an-main", view()));
  });
}
