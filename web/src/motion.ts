// The page's motion grammar. Everything moves continuously, every frame:
// transforms and opacity on strong out-curves for arrivals, in-out curves
// for things travelling on screen, linear only for constant flow. Exits are
// quicker than entrances and nothing grows from nothing. Headlines are
// uncovered by the yellow cursor gliding along each line, readable within
// about 0.7 s; only mono readouts "decode" (their own UTF-8 hex resolves
// into the text), on an eased progress. Cursor blinks stay on/off, in CSS.
// Reduced motion, or ?still, keeps settled states and gentle fades for
// changes the visitor asked for.
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
/** A fill or count arriving: fast off the mark, settling gently. */
export const FILL = "power3.out";
/** Something travelling on screen from one place to another. */
export const TRAVEL = "power3.inOut";
/** Arrivals: a plain 120 ms linear fade, no travel. */
export const FADE = { duration: 0.12, ease: "none" } as const;
/** A small part arriving in a sequence (a field, a chip): a short fade. */
export const POP = { duration: 0.18, ease: "power2.out" } as const;

/** Hidden characters light up where they sit, one after another: each
 * chip's mark fades in (its --lit, reader.css) while its letters brighten
 * from the page's dimmest text colour, never fainter, so a chip reads at
 * AA contrast in every frame. */
export function lightChips(
  chips: HTMLElement[],
  stagger: number,
): gsap.core.Tween {
  const dim = getComputedStyle(document.documentElement)
    .getPropertyValue("--ink-3")
    .trim();
  return gsap.from(chips, {
    "--lit": 0,
    color: dim,
    ...POP,
    stagger,
    clearProps: "color,--lit",
  });
}

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

interface Line {
  /** The line's own box, masked. */
  el: HTMLElement;
  /** The text's left and right in the line's box. */
  l: number;
  r: number;
  /** The line's box in the title's box. */
  x: number;
  /** The cursor's top in the title's box. */
  y: number;
  /** When the line starts, in seconds into the reveal. */
  s: number;
}

const typed = new WeakSet<Element>();
const glide = gsap.parseEase(FILL);
const clamp01 = gsap.utils.clamp(0, 1);
/** The longest a title takes to become readable, however many lines. */
const READABLE = 0.8;

/** Where an element sits in an ancestor's box, by layout offsets (so a
 * title in the tilted window measures in its own, untransformed space). */
function offsetIn(n: HTMLElement, root: HTMLElement): [number, number] {
  let x = 0;
  let y = 0;
  for (let e: Element | null = n; e && e !== root;) {
    const h = e as HTMLElement;
    x += h.offsetLeft;
    y += h.offsetTop;
    e = h.offsetParent;
  }
  return [x, y];
}

/** A title uncovered by the cursor: on each line the yellow block glides
 * from the first letter to the last on a strong out-curve, the text
 * appearing just behind it through a soft edge, and fades out at the
 * line's end. Lines overlap a little. `dur` is one line's glide. The
 * title stays hidden until it plays; its lines are split and measured
 * then, with the fonts in. Each line is masked on its own, so a line's
 * descenders and the next line's ascenders never show early. Null when it
 * won't move. */
export function typeTitle(
  el: HTMLElement | null,
  dur = 0.55,
): gsap.core.Timeline | null {
  if (!motion() || !el || typed.has(el)) return null;
  typed.add(el);
  const st = el.style;
  // Hidden until it plays; no-clip so glyphs that leave the box hide too.
  st.maskClip = "no-clip";
  st.maskImage = "linear-gradient(transparent, transparent)";
  let split: SplitText | null = null;
  let lines: Line[] = [];
  let curs: HTMLElement[] = [];
  let edge = 0;
  let pad = 0;
  const o = { t: 0 };
  const measure = () => {
    if (getComputedStyle(el).position === "static") st.position = "relative";
    const em = parseFloat(getComputedStyle(el).fontSize) || 16;
    edge = 0.5 * em;
    pad = 0.4 * em;
    split = SplitText.create(el, { type: "lines", linesClass: "tcur-line" });
    const els = split.lines as HTMLElement[];
    const n = els.length;
    const gap = n > 1 ? Math.min(dur * 0.25, (READABLE - dur) / (n - 1)) : 0;
    curs = els.map(() => {
      const c = document.createElement("span");
      c.className = "tcur";
      c.setAttribute("aria-hidden", "true");
      c.style.opacity = "0";
      el.appendChild(c);
      return c;
    });
    const ch = curs[0]?.offsetHeight ?? 0;
    lines = els.map((le, i) => {
      // The text's own extent (the line's box is the title's full width),
      // scaled back to layout pixels in case the title sits in the tilted
      // window.
      const box = le.getBoundingClientRect();
      const f = box.width ? le.offsetWidth / box.width : 1;
      const range = document.createRange();
      const walk = document.createTreeWalker(le, NodeFilter.SHOW_TEXT);
      let l = Infinity;
      let r = -Infinity;
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        range.selectNodeContents(n);
        for (const q of Array.from(range.getClientRects())) {
          if (q.width < 1) continue;
          l = Math.min(l, (q.left - box.left) * f);
          r = Math.max(r, (q.right - box.left) * f);
        }
      }
      if (l > r) [l, r] = [0, le.offsetWidth];
      const [x, y] = offsetIn(le, el);
      const ls = le.style;
      ls.removeProperty("text-align");
      ls.maskClip = "no-clip";
      ls.maskRepeat = "repeat-y";
      ls.maskPosition = `${-pad}px 0`;
      ls.maskSize = `calc(100% + ${2 * pad}px) 100%`;
      return {
        el: le,
        l,
        r,
        x,
        y: y + (le.offsetHeight - ch) / 2,
        s: i * Math.max(0.05, gap),
      };
    });
    st.removeProperty("mask-image");
    st.removeProperty("mask-clip");
  };
  const render = () => {
    const t = o.t;
    lines.forEach((ln, i) => {
      const u = clamp01((t - ln.s) / dur);
      const k = glide(u);
      // The soft edge runs just ahead of the block's left side, so the
      // text is uncovered under and behind it, and has passed the last
      // letter when the block arrives.
      const m = ln.l + k * (ln.r + edge - ln.l) + pad;
      ln.el.style.maskImage = `linear-gradient(90deg, #000 ${m - edge}px, transparent ${m}px)`;
      const c = curs[i];
      if (!c) return;
      const cx = ln.x + ln.l + k * (ln.r + 2 - ln.l);
      c.style.transform = `translate(${cx}px, ${ln.y}px)`;
      c.style.opacity = String(
        u <= 0 ? 0 : 1 - clamp01((t - ln.s - dur * 0.8) / 0.15),
      );
    });
  };
  // Long enough for the most lines READABLE allows, plus the last fade.
  const total = Math.max(READABLE, dur) + 0.15;
  const tl = gsap.timeline({
    paused: true,
    onComplete: () => {
      curs.forEach((c) => c.remove());
      split?.revert();
      st.removeProperty("position");
    },
  });
  tl.to(o, {
    t: total,
    duration: total,
    ease: "none",
    onStart: measure,
    onUpdate: render,
  });
  return tl;
}

const enc = new TextEncoder();
const decoding = new WeakMap<Element, () => void>();
const resolve = gsap.parseEase("power2.out");

/** Decode, for mono readouts only: each glyph first shows a hex digit of
 * its own UTF-8 encoding, then the cursor runs left to right and resolves
 * it, every frame, quick at first and settling at the end. The real text
 * keeps its box (transparent under an aria-hidden overlay), so nothing
 * reflows and assistive tech reads the real text. */
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
  let shown = -1;
  const done = () => {
    cancelAnimationFrame(raf);
    ov.remove();
    el.classList.remove("is-decoding");
    decoding.delete(el);
  };
  decoding.set(el, done);
  const frame = (now: number) => {
    const k = Math.min(1, (now - t0) / (dur * 1000));
    const n = Math.floor(resolve(k) * chars.length);
    if (n !== shown) {
      shown = n;
      ov.innerHTML =
        esc(chars.slice(0, n).join("")) +
        (n < chars.length
          ? `<i class="dc-cur">${esc(hexd[n])}</i>` +
            esc(hexd.slice(n + 1).join(""))
          : "");
    }
    if (k < 1) raf = requestAnimationFrame(frame);
    else done();
  };
  raf = requestAnimationFrame(frame);
}
