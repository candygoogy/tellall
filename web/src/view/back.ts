// The way back after a paste, a drop or a pick from far down the page took
// the page up to the reader: "Back to where you were", at the foot of the
// screen for 10 s (the clock stops while it's pointed at or focused). It
// goes once used, or once the visitor scrolls away on their own. Where to
// go back to is kept as a place in a section, not a scroll position, so a
// reader that grew taller meanwhile doesn't throw it off.
import { $, $$, heldTimer } from "../dom.ts";
import { motion } from "../motion.ts";

const SHOW_MS = 10_000;
/** How far the visitor may scroll, once the jump has settled, before the
 * way back goes. */
const AWAY = 160;

interface Place {
  el: HTMLElement;
  off: number;
  /** What had the focus (the button that was pressed), to give it back. */
  focus: HTMLElement | null;
}
let from: Place | null = null;
let stopTimer: (() => void) | null = null;
let settled: number | null = null;
let settling = 0;
let leaving = 0;

const btn = () => $<HTMLButtonElement>("#back-to");
const top = (el: HTMLElement) => el.getBoundingClientRect().top + scrollY;

/** The section the top of the screen is in, and how far into it. */
function here(): Place {
  const line = scrollY + $("#nav").offsetHeight;
  const parts = $$("main > section, footer");
  const el =
    parts.filter((p) => top(p) <= line).pop() ?? parts[0] ?? document.body;
  const a = document.activeElement;
  return {
    el,
    off: scrollY - top(el),
    focus: a instanceof HTMLElement && a !== document.body ? a : null,
  };
}

function onScroll(): void {
  if (settled === null) {
    // The jump is still moving: where it comes to rest is the mark.
    clearTimeout(settling);
    settling = window.setTimeout(() => (settled = scrollY), 150);
  } else if (Math.abs(scrollY - settled) > AWAY) hide();
}

function hide(): void {
  if (!from) return;
  from = null;
  stopTimer?.();
  stopTimer = null;
  clearTimeout(settling);
  removeEventListener("scroll", onScroll);
  const b = btn();
  b.classList.remove("is-on");
  clearTimeout(leaving);
  leaving = window.setTimeout(() => (b.hidden = true), motion() ? 220 : 0);
}

/** About to jump to `to` from more than a screen away: offers the way
 * back to here. */
export function offerWayBack(to: number): void {
  // A second jump while the first still moves (a drop of text files and
  // pictures) keeps the first one's place.
  if (from && settled === null) return;
  hide();
  from = here();
  const b = btn();
  b.classList.toggle("is-up", to > scrollY);
  clearTimeout(leaving);
  b.hidden = false;
  requestAnimationFrame(() => b.classList.add("is-on"));
  settled = null;
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  stopTimer = heldTimer(b, SHOW_MS, hide);
}

export function initBack(): void {
  btn().addEventListener("click", () => {
    const place = from;
    hide();
    if (!place?.el.isConnected) return;
    window.scrollTo({
      top: Math.max(0, top(place.el) + place.off),
      behavior: motion() ? "smooth" : "auto",
    });
    if (place.focus?.isConnected) place.focus.focus({ preventScroll: true });
  });
}
