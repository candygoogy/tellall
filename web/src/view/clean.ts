// "A clean copy drops what's about you.": an example file and its clean
// copy, both drawn to scale, with what was removed and what was kept. The
// clean copies are the engine's own, made when the page was built.
import examples from "virtual:examples";
import type { Group } from "@tellall/engine";
import { $, $$, cleanName, esc, fmt, tabs } from "../dom.ts";
import {
  FADE,
  G,
  STEP,
  ScrollTrigger,
  TICK,
  decode,
  motion,
  swap,
} from "../motion.ts";
import {
  attachCursor,
  buildBar,
  fitNames,
  type Part,
  type Seg,
} from "./anatomy.ts";
import { hintHTML } from "./result.ts";

const GROUP_WORDS: Partial<Record<Group, string>> = {
  location: "Location",
  device: "Camera and lens",
  dates: "Date taken",
  software: "Software",
  "other-text": "Name and comment",
  ids: "IDs",
  "ai-label": "AI label",
  "ai-source": "AI-source tag",
};

interface Model {
  name: string;
  before: Part[];
  a: number;
  after: Part[];
  b: number;
  removed: Group[];
  note: string;
}

const gps = examples.files.gps;
const chatgpt = examples.files.chatgpt;
const CL: Record<string, Model> = {
  gps: {
    name: gps.name,
    before: gps.report.anatomy,
    a: gps.size,
    after: examples.gpsClean.anatomy,
    b: gps.cleaned.size,
    removed: gps.cleaned.removed,
    note: "",
  },
  chatgpt: {
    name: chatgpt.name,
    before: chatgpt.report.anatomy,
    a: chatgpt.size,
    // Nothing private to remove: the clean copy is the file, byte for byte.
    after: chatgpt.report.anatomy,
    b: chatgpt.cleaned.size,
    removed: chatgpt.cleaned.removed,
    note: [
      esc(chatgpt.cleaned.notes.join(" ")),
      chatgpt.hint && chatgpt.command
        ? hintHTML(chatgpt.hint, chatgpt.command)
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  },
};
let key = "gps";
let last = 0;
const model = () => CL[key] as Model;
const names = (s: Seg) => (s.p.part === "pixels" ? "Picture data" : s.p.note);

function render(animate: boolean): void {
  const m = model();
  const barA = $("#cl-bar-a");
  const barB = $("#cl-bar-b");
  barB.style.width = (m.b / m.a) * 100 + "%";
  buildBar(barA, m.before, m.a, null, { minPct: 0.6, names, focusable: false });
  buildBar(barB, m.after, m.b, null, { minPct: 0.6, names, focusable: false });
  attachCursor(barA);
  attachCursor(barB);
  let keyEl = document.querySelector<HTMLElement>("#cl-key");
  if (!keyEl) {
    keyEl = document.createElement("p");
    keyEl.id = "cl-key";
    keyEl.className = "cl-key";
    keyEl.setAttribute("aria-hidden", "true");
    $("#cl-note").before(keyEl);
  }
  const seenNames = new Set<string>();
  keyEl.innerHTML = m.before
    .filter((p) => {
      const n = p.part === "pixels" ? "Picture data" : p.note;
      if (seenNames.has(n)) return false;
      seenNames.add(n);
      return true;
    })
    .map(
      (p) =>
        `<span class="k-${p.part}">${esc(p.part === "pixels" ? "Picture data" : p.note)}</span>`,
    )
    .join("");
  $("#cl-size-a").textContent = `${m.name} · ${fmt(m.a)} bytes`;
  $("#cl-size-b").textContent = `${cleanName(m.name)} · ${fmt(m.b)} bytes`;
  const kept: { n: string; k: string }[] = [];
  const seen = new Set<string>();
  m.after.forEach((p) => {
    p.note.split(", ").forEach((n) => {
      if (n === "End" || n === "File signature" || seen.has(n)) return;
      seen.add(n);
      kept.push({
        n:
          p.part === "pixels"
            ? "Picture data, byte for byte"
            : n.replace(/ · signed by .*/, ""),
        k:
          p.part === "label"
            ? "k-label"
            : p.part === "pixels"
              ? "k-pixels"
              : "",
      });
    });
  });
  $("#cl-removed").innerHTML = m.removed.length
    ? m.removed
        .map((g) => `<li class="k-private">${esc(GROUP_WORDS[g] ?? g)}</li>`)
        .join("")
    : `<li class="k-none">Nothing</li>`;
  $("#cl-kept").innerHTML = kept
    .map((x) => `<li class="${x.k}">${esc(x.n)}</li>`)
    .join("");
  $("#cl-delta").innerHTML = m.removed.length
    ? `<b>${fmt(m.a - m.b)} bytes</b> removed · picture data unchanged`
    : `Same file, byte for byte`;
  $("#cl-note").innerHTML = m.note;
  requestAnimationFrame(() => {
    fitNames($("#cl"));
    drawLinks();
  });
  if (animate) play();
}

/** Kept parts: each in the original, paired with itself in the copy. */
function keptPairs(): [HTMLElement, HTMLElement][] {
  const pa = $$("#cl-bar-a .part");
  const pb = $$("#cl-bar-b .part:not(.ghost)");
  const nameOf = (el: HTMLElement) => {
    const n = el.querySelector<HTMLElement>(".part-name");
    return n?.dataset["full"] || n?.textContent;
  };
  const used = new Set<number>();
  const pairs: [HTMLElement, HTMLElement][] = [];
  pb.forEach((b) => {
    const name = nameOf(b);
    const i = pa.findIndex(
      (a, k) =>
        !used.has(k) &&
        a.dataset["kind"] === b.dataset["kind"] &&
        a.dataset["kind"] !== "metadata" &&
        nameOf(a) === name,
    );
    const a = pa[i];
    if (a) {
      used.add(i);
      pairs.push([a, b]);
    }
  });
  return pairs;
}

/** Thin connectors from each kept part in the original to the same part
 * in the clean copy. */
export function drawLinks(): void {
  const svg = document.querySelector<SVGSVGElement>("#cl-links");
  if (!svg) return;
  const box = svg.getBoundingClientRect();
  if (!box.width) return;
  svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
  svg.innerHTML = keptPairs()
    .map(([a, b]) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const ax0 = ra.left - box.left + 1;
      const ax1 = ra.right - box.left - 1;
      const bx0 = rb.left - box.left + 1;
      const bx1 = rb.right - box.left - 1;
      const h = box.height;
      return `<polygon points="${ax0},0 ${ax1},0 ${bx1},${h} ${bx0},${h}"/><line x1="${ax0}" y1="0" x2="${bx0}" y2="${h}"/><line x1="${ax1}" y1="0" x2="${bx1}" y2="${h}"/>`;
    })
    .join("");
}

/** The original fills, then the private parts blink out like deleted
 * bytes and the kept parts close up cell by cell. */
function play(): void {
  if (!motion()) return;
  last = Date.now();
  const m = model();
  const barA = $("#cl-bar-a");
  const barB = $("#cl-bar-b");
  const partsA = $$(".part", barA);
  const partsB = $$(".part", barB);
  const tl = G.timeline({ defaults: { ease: STEP(0.9) } });
  decode($("#cl-delta"), 0.45);
  tl.fromTo(
    barA,
    { clipPath: "inset(0 100% 0 0)" },
    { clipPath: "inset(0 0% 0 0)", duration: 0.9, clearProps: "clipPath" },
    0,
  );
  G.set("#cl-links", { opacity: 0 });
  if (!m.removed.length) {
    tl.fromTo(
      barB,
      { clipPath: "inset(0 100% 0 0)" },
      { clipPath: "inset(0 0% 0 0)", duration: 0.9, clearProps: "clipPath" },
      0.25,
    ).add(() => {
      drawLinks();
      G.to("#cl-links", { opacity: 1, ...FADE });
    }, ">");
    return;
  }
  const bRect = barB.getBoundingClientRect();
  const used = new Set<number>();
  const ghosts: HTMLElement[] = [];
  partsA.forEach((pa) => {
    if (pa.dataset["kind"] !== "metadata") return;
    const r = pa.getBoundingClientRect();
    const g = pa.cloneNode(true) as HTMLElement;
    g.style.left = r.left - bRect.left + "px";
    g.style.width = r.width + "px";
    g.tabIndex = -1;
    g.classList.add("ghost");
    g.setAttribute("aria-hidden", "true");
    barB.appendChild(g);
    ghosts.push(g);
  });
  partsB.forEach((pb) => {
    const note = pb.querySelector(".part-name")?.textContent;
    const match = partsA.find(
      (pa, i) =>
        !used.has(i) &&
        pa.dataset["kind"] === pb.dataset["kind"] &&
        pa.dataset["kind"] !== "metadata" &&
        pa.querySelector(".part-name")?.textContent === note &&
        (used.add(i), true),
    );
    if (!match) return;
    const ra = match.getBoundingClientRect();
    const rb = pb.getBoundingClientRect();
    tl.fromTo(
      pb,
      {
        x: ra.left - rb.left,
        scaleX: ra.width / rb.width,
        transformOrigin: "0 50%",
      },
      {
        x: 0,
        scaleX: 1,
        duration: 0.6,
        ease: STEP(0.6),
        clearProps: "transform",
      },
      1.3,
    );
  });
  tl.fromTo(
    barB,
    { clipPath: "inset(0 -60% 0 0)" },
    { clipPath: "inset(0 -60% 0 0)", duration: 0.01 },
    0,
  );
  tl.fromTo(barB, { opacity: 0 }, { opacity: 1, ...FADE }, 0.5);
  tl.to(
    ghosts,
    {
      keyframes: [
        { opacity: 0.25, duration: TICK },
        { opacity: 1, duration: TICK },
        { opacity: 0, duration: TICK },
      ],
      ease: "steps(1)",
      stagger: TICK,
    },
    0.95,
  );
  tl.add(() => {
    ghosts.forEach((g) => g.remove());
    G.set(barB, { clearProps: "clipPath" });
  }, ">");
  tl.add(() => {
    drawLinks();
    G.fromTo("#cl-links", { opacity: 0 }, { opacity: 1, ...FADE });
  }, ">");
  const sizeB = $("#cl-size-b");
  const o = { v: m.a };
  tl.to(
    o,
    {
      v: m.b,
      duration: 0.6,
      ease: STEP(0.6),
      onUpdate: () => {
        sizeB.textContent = `${cleanName(m.name)} · ${fmt(o.v)} bytes`;
      },
    },
    1.3,
  );
}

export function initClean(): void {
  $("#cl-body").addEventListener("pointerenter", () => {
    if (!motion() || Date.now() - last < 3500) return;
    play();
  });
  tabs($("#cl .tabs"), (t) => {
    key = t.dataset["file"] ?? "gps";
    $("#cl-body").setAttribute("aria-labelledby", t.id);
    swap($("#cl-body"), () => render(motion()));
  });
  render(false);
  addEventListener("resize", () => {
    fitNames($("#cl"));
    drawLinks();
  });
}

export function cleanScenes(): void {
  ScrollTrigger.create({
    trigger: "#cl",
    start: "top 72%",
    once: true,
    onEnter: play,
  });
}
