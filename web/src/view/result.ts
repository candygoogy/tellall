// The reader window in the hero: a sidebar of files (the examples, then
// the visitor's own) and one result at a time. A result is the engine's
// headline, its sentences, "Show everything" with the raw fields and where
// each came from, the file drawn to scale, and the clean-copy actions.
// The markup is reader-html.ts's; the first example's is already in
// index.html when the page arrives.
import type { Report } from "@tellall/engine";
import examples from "virtual:examples";
import { $, $$, cleanName, esc, fmt, b64, download, maybe } from "../dom.ts";
import { read } from "../engine.ts";
import {
  announce as say,
  copiedChars,
  copyWith,
  saved,
  savedLine,
} from "../feedback.ts";
import {
  EASE,
  FADE,
  FILL,
  G,
  POP,
  TRAVEL,
  fadeIn,
  lightChips,
  motion,
  reduceMQ,
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
  CANT_READ,
  POINT_TEXT,
  dotFor,
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

export { hintBlockHTML, hintHTML, type Item } from "./reader-html.ts";

/** Under a text: what Copy clean text leaves behind, unless a finding
 * beside it already says the copy carries the page's address. */
export function textNoteHTML(r: Report | undefined): string {
  const address = r?.findings.some((f) =>
    f.fields.some((x) => x.name === "SourceURL"),
  );
  return address
    ? ""
    : `<span><em>Copy clean text</em> copies plain text only, without the page's address or styling.</span>`;
}

/** A text's actions: Copy clean text, New text, what the copy did. */
export function textActionsHTML(r: Report | undefined): string {
  return `<div class="rv-actions">
        <button class="btn btn-primary btn-sm js-copy-clean" type="button"><svg class="ic" aria-hidden="true"><use href="#i-copy"/></svg><span>Copy clean text</span></button>
        <button class="btn btn-secondary btn-sm js-new-text" type="button"><svg class="ic" aria-hidden="true"><use href="#i-text"/></svg><span>New text</span></button>
        <p class="rv-note js-copy-status" aria-live="polite"></p>
        <p class="hint js-text-note">${textNoteHTML(r)}</p>
      </div>`;
}

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

/** The visitor's own texts are drawn by paste.ts (an editable box that's
 * read as it changes) through this. */
let textView: ((view: HTMLElement, item: Item) => void) | null = null;
export const onTextView = (draw: (view: HTMLElement, item: Item) => void) => {
  textView = draw;
};
/** What the view on screen does before `next` takes its place (the text
 * box reads what's still waiting). */
let leaving: ((next: Item) => void) | null = null;
export const onLeave = (fn: (next: Item) => void) => {
  leaving = fn;
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
      ${textActionsHTML(r)}`;
}
function readingViewHTML(item: Item): string {
  return `<div class="rv-top"><div>${plateHTML(item)}<p class="rv-cap">${esc(fmt(item.size ?? 0))} bytes</p></div>
      <div class="rv-report"><p class="rv-status">Reading ${esc(item.name)} on this device…</p></div></div>`;
}
function errorViewHTML(item: Item): string {
  return `<div class="rv-top"><div>${plateHTML(item)}</div><div class="rv-report">
      <h2 class="rv-headline is-empty" tabindex="-1">tellall couldn't read this file.</h2>
      <p class="rv-note rv-err"></p>
      <div class="hero-actions"><button class="btn btn-secondary btn-sm js-choose" type="button">Choose another image</button></div></div></div>`;
}
/** A file of a kind tellall doesn't read (a GIF, a text file): no picture
 * and no file to scale, only what it does read. */
function unreadableViewHTML(item: Item): string {
  return `<div class="rv-top is-solo"><div class="rv-report">
      <h2 class="rv-headline is-empty" tabindex="-1">${esc(item.report?.headline ?? "")}</h2>
      <p class="rv-note rv-err">tellall reads JPEG, PNG, WebP and HEIC images, and text you paste.</p>
      <div class="hero-actions"><button class="btn btn-secondary btn-sm js-choose" type="button">Choose another image</button></div></div></div>`;
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
  wireHint(v, item.command);
  const line = maybe(".js-dl-status", v);
  // The visitor's own clean copy: the link downloads it; this says so.
  const dl = maybe(".js-dl", v);
  dl?.addEventListener("click", () => {
    if (!item.cleanBlob) return;
    saved(
      dl,
      savedLine(
        cleanName(item.name),
        item.size ?? 0,
        item.cleanBlob.size,
        !!item.cleaned?.removed.length,
      ),
      line,
    );
  });
  const exBtn = maybe<HTMLButtonElement>(".js-dl-example", v);
  if (exBtn && item.bytes) {
    const bytes = item.bytes;
    exBtn.addEventListener("click", async () => {
      exBtn.disabled = true;
      let said: string;
      let ok = false;
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
          said = savedLine(
            cleanName(item.name),
            item.size ?? 0,
            c.output.byteLength,
            c.removed.length > 0,
          );
          ok = true;
        } else said = c.notes.join(" ");
      } catch (err) {
        said = "tellall couldn't make the copy: " + (err as Error).message;
      } finally {
        exBtn.disabled = false;
      }
      saved(exBtn, said, line, ok);
    });
  }
}

/** The hint's copy button, in the reader and the clean-copy section. */
export function wireHint(root: ParentNode, command: string | null | undefined) {
  const btn = maybe(".js-copy-hint", root);
  if (btn && command)
    btn.addEventListener(
      "click",
      () => void copyWith(btn, command, "Copied the command."),
    );
}

/** A text's marked characters and its sentences, each sentence lighting
 * the characters it's about. Drawn again on each reading of a live text. */
export function drawTextReport(root: HTMLElement, item: Item): void {
  const box = $(".tx", root);
  const report = item.report as Report;
  renderChips(box, $(".pmap", root), item.plain ?? "", report);
  const list = $(".rv-findings", root);
  list.innerHTML = findingsHTML(report);
  const mark = (cls: string | null) => {
    $$(".chip", box).forEach((c) =>
      c.classList.toggle("is-on", !!cls && c.classList.contains(cls)),
    );
  };
  $$(".finding", list).forEach((fb) => {
    const f = report.findings[Number(fb.dataset["i"])];
    if (!f) return;
    const cls = chipClass(f.kind);
    fb.addEventListener("pointerenter", () => mark(cls));
    fb.addEventListener("focus", () => mark(cls));
    fb.addEventListener("pointerleave", () => mark(null));
    fb.addEventListener("blur", () => mark(null));
  });
}

/** Copy clean text: copies the text's clean copy at the time of the click. */
export function wireCopyClean(root: HTMLElement, item: Item): void {
  const btn = $(".js-copy-clean", root);
  const status = $(".js-copy-status", root);
  btn.addEventListener("click", () => {
    const out = item.cleaned?.output;
    const text = item.cleanText ?? (typeof out === "string" ? out : "");
    void copyWith(btn, text, copiedChars(text), status);
  });
}

function wireTextView(item: Item): void {
  const v = view();
  drawTextReport(v, item);
  wireCopyClean(v, item);
}

/** A file of a kind tellall doesn't read: no parts to draw. */
const unreadable = (item: Item) =>
  item.kind === "file" && !!item.report && !item.report.anatomy.length;

export const statusFor = (item: Item) =>
  !item.live
    ? "Example result"
    : item.state === "paste"
      ? "Ready"
      : item.state === "reading"
        ? "Reading…"
        : item.state === "error"
          ? "Couldn't read"
          : unreadable(item)
            ? CANT_READ
            : `Read on this device in ${fmt(Math.max(1, item.ms ?? 0))} ms`;

export function setStatus(text: string, reading: boolean): void {
  $("#r-status-text").innerHTML = statusHTML(text);
  $("#r-status").classList.toggle("is-reading", reading);
}
/** The window's title: the group and the name ("New text" alone, as it's
 * in no list yet). */
export function setCrumbs(item: Item): void {
  $(".crumbs").classList.toggle(
    "is-solo",
    item.state === "paste" && !live.includes(item),
  );
  $("#r-group").textContent = item.live ? "Your files" : "Examples";
  const name = $("#r-name");
  name.textContent = item.name;
  name.title = item.title ?? item.name;
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
/** The result is on screen: the headline takes the focus if the visitor
 * started this reading (and isn't typing somewhere), else the result is
 * said to a screen reader. */
export function landed(item: Item): void {
  if (item.focusOnRead && item.state !== "reading" && item === current) {
    delete item.focusOnRead;
    const a = document.activeElement;
    const typing = !!a?.matches?.(
      'textarea, select, [contenteditable="true"], input:not([type="file"])',
    );
    const head = maybe(".rv-headline", view());
    if (head && !typing && head.offsetParent) {
      head.focus({ preventScroll: true });
      return;
    }
  }
  if (item.report) say(`${item.name}: ${item.report.headline}`);
}

/** Replay plays a reading again; under reduced motion there's nothing to
 * replay, and a text box being edited isn't redrawn. */
function syncReplay(): void {
  $("#r-replay").hidden =
    !motion() || (current.live && current.kind === "text");
}

/** The current row in view inside the sidebar (a column on wide screens,
 * a swipe row on phones), never scrolling the page. */
export function revealCurrent(): void {
  const side = $(".side");
  const b = maybe(`.file-item[aria-current="true"]`, side);
  if (!b || !b.offsetParent) return;
  const pad = 12;
  let left = side.scrollLeft;
  let top = side.scrollTop;
  if (side.scrollWidth > side.clientWidth + 1) {
    // The strip's right edge fades out: count only what's clear of it.
    const seen = side.clientWidth * 0.85;
    if (b.offsetLeft < left + pad) left = b.offsetLeft - pad;
    else if (b.offsetLeft + b.offsetWidth > left + seen)
      left = b.offsetLeft + b.offsetWidth - seen + pad;
  }
  if (side.scrollHeight > side.clientHeight + 1) {
    const foot = maybe(".side-foot", side);
    const seen =
      side.clientHeight -
      (foot && getComputedStyle(foot).position === "sticky"
        ? foot.offsetHeight
        : 0);
    if (b.offsetTop < top + pad) top = b.offsetTop - pad;
    else if (b.offsetTop + b.offsetHeight > top + seen)
      top = b.offsetTop + b.offsetHeight - seen + pad;
  }
  if (left !== side.scrollLeft || top !== side.scrollTop)
    side.scrollTo({ left, top, behavior: motion() ? "smooth" : "auto" });
}

export type Mode = "swap" | "intro" | "none";

export function show(item: Item, mode: Mode = "swap"): void {
  const leave = leaving;
  leaving = null;
  leave?.(item);
  current = item;
  pinned = null;
  markCurrent();
  setCrumbs(item);
  syncReplay();
  if (mode !== "none") revealCurrent();
  if (readingTL) {
    readingTL.kill();
    readingTL = null;
  }
  const v = view();
  const build = () => {
    if (item.live && item.kind === "text") {
      textView?.(v, item);
      setStatus(statusFor(item), item.state === "reading");
      if (item.state === "done") {
        landed(item);
        play(mode);
      }
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
      landed(item);
      return;
    }
    if (unreadable(item)) {
      v.innerHTML = unreadableViewHTML(item);
      setStatus(CANT_READ, false);
      landed(item);
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
    landed(item);
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
  // On the plate, so the plate's width can follow the height it has.
  if (item.ar)
    img.closest<HTMLElement>(".rv-plate")?.style.setProperty("--ar", item.ar);
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
    const { width, height } = drawn.canvas;
    if (width && height)
      slot
        .closest<HTMLElement>(".rv-plate")
        ?.style.setProperty("--ar", `${width} / ${height}`);
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
  // The scan block is a row of the picture tall (one of 11) and sweeps
  // down it.
  const n = 11;
  G.set(scan, { height: plate.clientHeight / n });
  readingTL
    .fromTo(
      scan,
      { y: 0 },
      {
        y: () => plate.clientHeight - plate.clientHeight / n,
        duration: 0.9,
        ease: TRAVEL,
      },
      0,
    )
    .fromTo(scan, { opacity: 0 }, { opacity: 1, ...FADE }, 0)
    .to(scan, { opacity: 0, ...FADE }, 0.8);
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
  // The picture arrives, then the cursor block sweeps down it.
  if (plate) tl.fromTo(plate, { opacity: 0 }, { opacity: 1, ...FADE }, 0);
  if (scan && plate) {
    // The scan block is one row of the picture tall (a row for every
    // 85 ms of the sweep, as many as the cursor would read).
    const rows = Math.max(3, Math.round(15 * k));
    tl.set(scan, { height: () => plate.clientHeight / rows }, 0)
      .fromTo(scan, { y: 0, opacity: 0 }, { opacity: 1, ...FADE }, 0.15 * k)
      .to(
        scan,
        {
          y: () => plate.clientHeight - plate.clientHeight / rows,
          duration: 1.25 * k,
          ease: TRAVEL,
        },
        0.15 * k,
      )
      .to(scan, { opacity: 0, ...FADE }, ">-0.06");
  }
  // The file fills to scale while the byte count runs up with it.
  if (main) {
    tl.fromTo(
      main,
      { clipPath: "inset(0 100% 0 0)" },
      {
        clipPath: "inset(0 0% 0 0)",
        duration: 1.25 * k,
        ease: FILL,
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
          ease: FILL,
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
        { scaleY: 1, duration: 0.3 * k, ease: FILL },
        0.95 * k,
      )
      .fromTo(
        zf,
        { scaleX: 0 },
        {
          scaleX: 1,
          duration: 0.5 * k,
          ease: FILL,
          stagger: 0.08 * k,
        },
        1.0 * k,
      );
  }
  if (tx) tl.fromTo(tx, { opacity: 0 }, { opacity: 1, ...FADE }, 0.1);
  // Hidden characters light up one after another, each a short fade.
  if (chips.length) tl.add(lightChips(chips, 0.09 * Math.max(k, 0.5)), 0.5 * k);
  if (ticks.length) {
    tl.fromTo(
      ticks,
      { opacity: 0 },
      { opacity: 1, ...POP, stagger: 0.09 * Math.max(k, 0.5) },
      0.5 * k,
    );
  }
  const at = mode === "intro" ? 1.35 : 0.5;
  // The engine's headline is uncovered by the cursor, readable within
  // about half a second.
  if (head) {
    const t = typeTitle(head, mode === "intro" ? 0.5 : 0.35);
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

/** The reading on screen, played to its end at once (its headline set). */
export function finishReading(): void {
  const tl = readingTL;
  readingTL = null;
  tl?.progress(1);
  tl?.kill();
}

/** The intro's reading, handed back by main.ts when it starts playing. */
export const setReading = (tl: gsap.core.Timeline | null) => {
  readingTL = tl;
};

/* ------------------------------------------------------- the visitor's files */

interface Row {
  li: HTMLLIElement;
  name: HTMLSpanElement;
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
  b.appendChild(name);
  const d = document.createElement("span");
  b.appendChild(d);
  b.addEventListener("click", () => {
    if (item !== current) show(item, "swap");
  });
  li.appendChild(b);
  const row: Row = { li, name, dot: d, thumb };
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
    forget(item);
  }
}

/** Takes one of the visitor's files or texts out of "Your files": its row,
 * its picture and clean copy freed. */
export function forget(item: Item): void {
  const i = live.indexOf(item);
  if (i < 0) return;
  if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
  if (item.cleanUrl) URL.revokeObjectURL(item.cleanUrl);
  rows.get(item)?.li.remove();
  rows.delete(item);
  live.splice(i, 1);
  $("#side-live").hidden = live.length === 0;
}

/** The sidebar's "Your files": each row made once, its dot kept current. */
export function renderLiveList(): void {
  const list = $("#side-live-list");
  $("#side-live").hidden = live.length === 0;
  let before: Element | null = list.firstElementChild;
  for (const item of live) {
    const row = rows.get(item) ?? liveRow(item);
    setThumb(row, item.thumbUrl);
    // A text's name follows its words.
    if (row.name.textContent !== item.name) row.name.textContent = item.name;
    const title = item.title ?? item.name;
    if (row.name.title !== title) row.name.title = title;
    const [cls, said] = dotFor(item);
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
  reduceMQ.addEventListener("change", syncReplay);
  syncReplay();
  addEventListener("resize", () => {
    fitNames(view());
    layoutHits(maybe(".an-main", view()));
  });
}
