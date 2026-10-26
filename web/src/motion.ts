// The page's motion grammar. Reading steps like a cursor (TICK); headlines
// are set word by word by a yellow cursor and are readable within half a
// second; only mono readouts "decode" (their own UTF-8 hex resolves into
// the text). Reduced motion, or ?still, keeps settled states and gentle
// fades for changes the visitor asked for.
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { esc } from "./dom.ts";

gsap.registerPlugin(ScrollTrigger, SplitText);

export { gsap as G, ScrollTrigger, SplitText };

export const still = /[?&]still\b/.test(location.search);
export const reduceMQ = matchMedia("(prefers-reduced-motion: reduce)");
export const fineMQ = matchMedia("(hover: hover) and (pointer: fine)");
export const motion = () => !reduceMQ.matches && !still;
export const TOUCH = matchMedia("(hover: none)").matches;

/** Headlines and the window's arrival only. */
export const EASE = "expo.out";
/** One cursor tick: slow enough to read as a deliberate step, never as a
 * dropped frame. A stepped ease takes one step per tick. */
export const TICK = 0.085;
export const STEP = (dur: number) =>
  `steps(${Math.max(2, Math.round(dur / TICK))})`;
/** Arrivals: a plain 120 ms linear fade, no steps, no travel. */
export const FADE = { duration: 0.12, ease: "none" } as const;

/** Reduced motion keeps a gentle fade for a change the visitor asked for. */
export function fadeIn(el: Element | null): void {
  if (!still && reduceMQ.matches && el && "animate" in el) {
    el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 200,
      easing: "linear",
    });
  }
}

/** A swap the visitor asked for: the old content cuts out at once, the
 * new one fades in over 120 ms. */
export function swap(el: HTMLElement, build: () => void): void {
  if (!motion()) {
    build();
    fadeIn(el);
    return;
  }
  gsap.set(el, { opacity: 0, overwrite: true });
  build();
  gsap.to(el, { opacity: 1, ...FADE });
}

const typed = new WeakSet<Element>();

/** A title set by the cursor: a yellow block moves word by word and each
 * word appears as it passes. Null when it won't move. */
export function typeTitle(
  el: HTMLElement | null,
  per = 0.075,
): gsap.core.Timeline | null {
  if (!motion() || !el || typed.has(el)) return null;
  typed.add(el);
  const split = SplitText.create(el, { type: "words", wordsClass: "tw" });
  const words = split.words as HTMLElement[];
  const first = words[0];
  if (!first) return null;
  const cur = document.createElement("span");
  cur.className = "tcur";
  cur.setAttribute("aria-hidden", "true");
  el.appendChild(cur);
  gsap.set(words, { opacity: 0 });
  // Where the cursor sits, measured when the title plays (function-based
  // values are read on first render), so a font that arrives after the
  // title is set up still puts the cursor at the end of each word.
  const at = (w: HTMLElement, end: boolean) => ({
    x: () => w.offsetLeft + (end ? w.offsetWidth + 2 : 0),
    y: () => w.offsetTop + Math.max(0, (w.offsetHeight - cur.offsetHeight) / 2),
  });
  const tl = gsap.timeline({
    paused: true,
    onComplete: () => {
      cur.remove();
      split.revert();
    },
  });
  tl.set(cur, { ...at(first, false), opacity: 1 }, 0);
  words.forEach((w, i) => {
    tl.set(w, { opacity: 1 }, i * per).set(cur, at(w, true), i * per);
  });
  tl.to(
    cur,
    {
      keyframes: [
        { opacity: 0, duration: 0.18 },
        { opacity: 1, duration: 0.18 },
        { opacity: 0, duration: 0.01 },
      ],
      ease: "steps(1)",
    },
    words.length * per,
  );
  return tl;
}

const enc = new TextEncoder();
const decoding = new WeakMap<Element, () => void>();

/** Decode, for mono readouts only: each glyph first shows a hex digit of
 * its own UTF-8 encoding, then the cursor walks left to right and resolves
 * it. The real text keeps its box (transparent under an aria-hidden
 * overlay), so nothing reflows and assistive tech reads the real text. */
export function decode(el: HTMLElement | null, dur = 0.5): void {
  if (!el || !motion() || !el.textContent?.trim()) return;
  decoding.get(el)?.();
  const chars = Array.from(el.textContent);
  const hexd = chars.map((c) =>
    /\s/.test(c) ? c : (enc.encode(c)[0] ?? 0).toString(16).slice(-1),
  );
  const ov = document.createElement("span");
  ov.className = "dc-ov";
  ov.setAttribute("aria-hidden", "true");
  el.classList.add("is-decoding");
  el.appendChild(ov);
  const t0 = performance.now();
  let raf = 0;
  const done = () => {
    cancelAnimationFrame(raf);
    ov.remove();
    el.classList.remove("is-decoding");
    decoding.delete(el);
  };
  decoding.set(el, done);
  const frame = (now: number) => {
    const k = Math.min(1, (now - t0) / (dur * 1000));
    const n = Math.floor(k * chars.length);
    ov.innerHTML =
      esc(chars.slice(0, n).join("")) +
      (n < chars.length
        ? `<i class="dc-cur">${esc(hexd[n])}</i>` +
          esc(hexd.slice(n + 1).join(""))
        : "");
    if (k < 1) raf = requestAnimationFrame(frame);
    else done();
  };
  raf = requestAnimationFrame(frame);
}
