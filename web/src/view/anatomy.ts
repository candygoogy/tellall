// The file anatomy map: a file's parts drawn to scale as flat cells, from
// the engine's report.anatomy. Tiny parts get a minimum width so every
// part stays visible and pointable; a file that is almost all picture gets
// an enlarged row of its first (or last) bytes above the bar. Point at a
// bar and a yellow cursor reads the byte under the pointer.
import type { Group } from "@tellall/engine";
import { $$, fmt } from "../dom.ts";
import { fineMQ } from "../motion.ts";
import { pct, type Part } from "./reader-html.ts";

export { keysHTML, pct, zoomRange, type Part } from "./reader-html.ts";

export const KIND_NAME: Record<Part["part"], string> = {
  header: "Structure",
  label: "AI label",
  metadata: "Metadata",
  pixels: "Picture data",
  other: "Other",
};

/** The parts of a file each group of findings comes from. */
export const GROUP_PARTS: Partial<Record<Group, Part["part"][]>> = {
  "ai-label": ["label"],
  "ai-source": ["label", "metadata"],
  location: ["metadata"],
  device: ["metadata"],
  dates: ["metadata"],
  software: ["metadata"],
  ids: ["metadata"],
  "other-text": ["metadata"],
};

export interface Seg {
  p: Part;
  /** The part's index in the anatomy. */
  i: number;
  /** Its bytes inside the drawn range. */
  a: number;
  b: number;
  /** Its left and width, in percent of the bar. */
  x: number;
  w: number;
  /** The name shown on it. */
  shown?: string;
}

interface BarState {
  segs: Seg[];
  hit?: { total: number; wire: ((btn: HTMLButtonElement) => void) | null };
  cursor?: boolean;
}

const bars = new WeakMap<HTMLElement, BarState>();
export const segsOf = (bar: HTMLElement | null) =>
  (bar && bars.get(bar)?.segs) || null;

/** Lays parts out to scale inside [start, end], giving tiny parts a
 * minimum width taken from the largest part. */
export function layout(
  parts: Part[],
  start: number,
  end: number,
  minPct: number,
): Seg[] {
  const span = end - start;
  const segs: Seg[] = [];
  parts.forEach((p, i) => {
    const a = Math.max(p.offset, start);
    const b = Math.min(p.offset + p.length, end);
    if (b > a) segs.push({ p, i, a, b, x: 0, w: ((b - a) / span) * 100 });
  });
  let extra = 0;
  segs.forEach((s) => {
    if (s.w < minPct) {
      extra += minPct - s.w;
      s.w = minPct;
    }
  });
  const big = segs.reduce<Seg | undefined>(
    (m, s) => (!m || s.w > m.w ? s : m),
    undefined,
  );
  if (extra && big) big.w = Math.max(minPct, big.w - extra);
  let x = 0;
  segs.forEach((s) => {
    s.x = x;
    x += s.w;
  });
  return segs;
}

export interface BarOptions {
  minPct?: number;
  names?: (s: Seg) => string;
  short?: (s: Seg) => string;
  /** False: the bar gets no hit targets of its own. */
  focusable?: boolean;
}

export function buildBar(
  bar: HTMLElement,
  parts: Part[],
  total: number,
  range: [number, number] | null,
  opts: BarOptions = {},
): Seg[] {
  const [start, end] = range ?? [0, total];
  const segs = layout(parts, start, end, opts.minPct ?? 0.45);
  bar.textContent = "";
  segs.forEach((s) => {
    const b = document.createElement("span");
    b.className = "part";
    b.dataset["kind"] = s.p.part;
    b.dataset["pi"] = String(s.i);
    b.style.left = s.x + "%";
    b.style.width = s.w + "%";
    const fill = document.createElement("span");
    fill.className = "fill";
    b.appendChild(fill);
    const shown = opts.names ? opts.names(s) : s.p.note;
    s.shown = shown;
    b.setAttribute("aria-hidden", "true");
    if (opts.names) {
      const name = document.createElement("span");
      name.className = "part-name";
      name.textContent = shown;
      if (opts.short) {
        const sh = opts.short(s);
        if (sh) name.dataset["short"] = sh;
      }
      name.dataset["w"] = String(s.w);
      b.appendChild(name);
    }
    bar.appendChild(b);
  });
  const state: BarState = { segs, cursor: bars.get(bar)?.cursor ?? false };
  if (opts.focusable !== false) state.hit = { total, wire: null };
  bars.set(bar, state);
  return segs;
}

/** Wires each hit target a bar gets (layoutHits builds them). */
export function wireHits(
  bar: HTMLElement,
  wire: (btn: HTMLButtonElement) => void,
): void {
  const hit = bars.get(bar)?.hit;
  if (hit) hit.wire = wire;
}

/** Hit targets for an interactive bar (WCAG 2.5.8): every part at least
 * MIN px wide gets its own button over its exact span; a run of narrower
 * neighbours shares one MIN px button ("2 parts: ..."). Buttons never
 * overlap, and the drawn bar stays to scale underneath. Rebuilt on resize.
 * MIN is 28, not 24: the hero window starts tilted and scaled down
 * (hero.ts, rotateX 20 and scale 0.92), and a target must still be 24 px
 * on screen then. The stylesheet's .hit height matches it. */
export function layoutHits(bar: HTMLElement | null): void {
  const state = bar && bars.get(bar);
  const info = state?.hit;
  if (!bar || !state || !info) return;
  $$(".hit", bar).forEach((h) => h.remove());
  const W = bar.clientWidth;
  if (!W) return;
  const MIN = 28;
  interface Run {
    tiny: boolean;
    items: Seg[];
    a: number;
    b: number;
  }
  const groups: Run[] = [];
  state.segs.forEach((sg) => {
    const a = (sg.x / 100) * W;
    const b = ((sg.x + sg.w) / 100) * W;
    const tiny = b - a < MIN;
    const last = groups[groups.length - 1];
    if (tiny && last && last.tiny) {
      last.items.push(sg);
      last.b = b;
    } else groups.push({ tiny, items: [sg], a, b });
  });
  groups.forEach((g) => {
    if (g.b - g.a < MIN) {
      const c = (g.a + g.b) / 2;
      g.a = Math.max(0, Math.min(W - MIN, c - MIN / 2));
      g.b = g.a + MIN;
    }
  });
  for (let pass = 0; pass < 4; pass++) {
    for (let k = 1; k < groups.length; k++) {
      const p = groups[k - 1];
      const g = groups[k];
      if (!p || !g || p.b <= g.a) continue;
      if (!g.tiny && g.b - p.b >= MIN) g.a = p.b;
      else if (!p.tiny && g.a - p.a >= MIN) p.b = g.a;
      else {
        p.items.push(...g.items);
        p.b = Math.max(p.b, g.b);
        p.tiny = true;
        groups.splice(k, 1);
        k--;
      }
    }
  }
  groups.forEach((g) => {
    const first = g.items[0];
    if (!first) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hit";
    btn.style.left = (g.a / W) * 100 + "%";
    btn.style.width = ((g.b - g.a) / W) * 100 + "%";
    btn.dataset["pis"] = g.items.map((x) => x.i).join(",");
    const bytes = g.items.reduce((n, x) => n + x.p.length, 0);
    btn.setAttribute(
      "aria-label",
      g.items.length === 1
        ? `${first.shown}: ${fmt(first.p.length)} bytes at byte ${fmt(first.p.offset)}, ${pct(first.p.length, info.total)}% of the file`
        : `${g.items.length} parts: ${g.items.map((x) => x.shown).join("; ")}. ${fmt(bytes)} bytes from byte ${fmt(first.p.offset)}, ${pct(bytes, info.total)}% of the file`,
    );
    bar.appendChild(btn);
    info.wire?.(btn);
  });
}

/** Hides part names that don't fit their part. */
export function fitNames(root: ParentNode | null): void {
  if (!root) return;
  $$(".part-name", root).forEach((n) => {
    const part = n.parentElement;
    if (!part) return;
    if (!n.dataset["full"]) n.dataset["full"] = n.textContent ?? "";
    n.textContent = n.dataset["full"] ?? "";
    if (n.scrollWidth + 16 > part.clientWidth && n.dataset["short"]) {
      n.textContent = n.dataset["short"];
    }
    n.style.visibility =
      n.scrollWidth + 16 > part.clientWidth ? "hidden" : "visible";
  });
}

/** The byte cursor: point anywhere on a bar drawn to scale and a yellow
 * cursor reads the byte under the pointer, in decimal and hex. The address
 * comes from the bar's own layout: each part maps its drawn span back to
 * its byte range. */
export function attachCursor(bar: HTMLElement | null): void {
  if (!fineMQ.matches || !bar) return;
  const state = bars.get(bar);
  if (!state || state.cursor) return;
  state.cursor = true;
  let cur: HTMLSpanElement | null = null;
  let tag: HTMLSpanElement | null = null;
  let raf = 0;
  let px = 0;
  const draw = () => {
    raf = 0;
    const segs = bars.get(bar)?.segs;
    const r = bar.getBoundingClientRect();
    if (!segs?.length || !r.width) return;
    const p = Math.max(0, Math.min(99.999, ((px - r.left) / r.width) * 100));
    const sg =
      segs.find((g) => p >= g.x && p < g.x + g.w) ?? segs[segs.length - 1];
    if (!sg) return;
    const byte = Math.min(
      sg.b - 1,
      Math.floor(sg.a + ((p - sg.x) / sg.w) * (sg.b - sg.a)),
    );
    if (!cur || !tag) {
      cur = document.createElement("span");
      cur.className = "bcur";
      cur.setAttribute("aria-hidden", "true");
      tag = document.createElement("span");
      tag.className = "bcur-tag";
      cur.appendChild(tag);
    }
    if (cur.parentNode !== bar) bar.appendChild(cur);
    cur.style.left = p + "%";
    tag.textContent = `byte ${fmt(byte)} · 0x${byte.toString(16).toUpperCase().padStart(6, "0")}`;
    const right = p > 60;
    tag.style.left = right ? "auto" : "3px";
    tag.style.right = right ? "3px" : "auto";
  };
  bar.addEventListener("pointermove", (e) => {
    px = e.clientX;
    if (!raf) raf = requestAnimationFrame(draw);
  });
  bar.addEventListener("pointerleave", () => cur?.remove());
}
