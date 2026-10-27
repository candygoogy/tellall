// What a button says back: one way for every copy and every download on
// the page. A button's icon turns into a tick (and its label, if it has
// one, says what happened) for a moment, then goes back to what the button
// says at rest *now*: each button keeps its own timer, so a second click
// restarts it rather than saving "Copied" as the label to go back to, and
// a button whose resting label changes (the terminal's, per tab) is told
// with setRest(). What happened is said in a line beside the button, or,
// with none, to a screen reader only.
import { $, copyText, fmt } from "./dom.ts";

/** How long the tick and "Copied" stay. */
const HOLD = 1600;

interface Rest {
  icon: string | null;
  label: string;
}
const rests = new WeakMap<HTMLElement, Rest>();
const timers = new WeakMap<HTMLElement, number>();

/** The button's own text, if it has any (else it's named by aria-label). */
const labelOf = (btn: HTMLElement) =>
  btn.querySelector<HTMLElement>(":scope > span:not(.sr-only)");

function rest(btn: HTMLElement): Rest {
  let r = rests.get(btn);
  if (!r) {
    r = {
      icon: btn.querySelector("use")?.getAttribute("href") ?? null,
      label: labelOf(btn)?.textContent ?? btn.getAttribute("aria-label") ?? "",
    };
    rests.set(btn, r);
  }
  return r;
}

function write(btn: HTMLElement, label: string): void {
  const span = labelOf(btn);
  if (span) span.textContent = label;
  else btn.setAttribute("aria-label", label);
}

/** Back to rest at once: the resting icon and label. */
function settle(btn: HTMLElement): void {
  clearTimeout(timers.get(btn));
  timers.delete(btn);
  const r = rest(btn);
  if (r.icon) btn.querySelector("use")?.setAttribute("href", r.icon);
  write(btn, r.label);
}

/** The label a button goes back to, from now on; it shows at once. */
export function setRest(btn: HTMLElement, label: string): void {
  rest(btn).label = label;
  settle(btn);
}

/** The tick (when it worked) and, if given, a label, for a moment. */
export function flash(btn: HTMLElement, ok: boolean, label?: string): void {
  const r = rest(btn);
  clearTimeout(timers.get(btn));
  const use = btn.querySelector("use");
  if (use && r.icon) use.setAttribute("href", ok ? "#i-check" : r.icon);
  if (label !== undefined) write(btn, label);
  timers.set(
    btn,
    window.setTimeout(() => settle(btn), HOLD),
  );
}

/** Said to a screen reader (the page's one polite live region). The same
 * words twice are said twice. */
export function announce(text: string): void {
  const el = $("#r-live");
  el.textContent = "";
  requestAnimationFrame(() => (el.textContent = text));
}

const COPY_FAILED =
  "The browser didn't allow copying. Select the text and copy it instead.";

/** Copies `text` and says so: the tick and "Copied" on the button, and
 * `done` in `line` (a live region) or, without one, to a screen reader. */
export async function copyWith(
  btn: HTMLElement,
  text: string,
  done: string,
  line?: HTMLElement | null,
): Promise<boolean> {
  const ok = await copyText(text);
  const named = !!labelOf(btn);
  flash(
    btn,
    ok,
    ok ? "Copied" : named ? "Copy failed" : "Copy failed, select it instead",
  );
  const said = ok ? done : COPY_FAILED;
  if (line) line.textContent = said;
  else announce(said);
  return ok;
}

/** "Copied 112 characters as plain text." */
export const copiedChars = (text: string) =>
  `Copied ${fmt([...text].length)} characters as plain text.`;

/** A download started: the tick on the button, `said` in `line` (shown,
 * not live) and to a screen reader. */
export function saved(
  btn: HTMLElement,
  said: string,
  line?: HTMLElement | null,
  ok = true,
): void {
  flash(btn, ok);
  if (line) {
    line.textContent = said;
    line.hidden = false;
  }
  announce(said);
}

/** "Saved gps.clean.jpg: 1,733 bytes, 951 bytes of personal data removed." */
export function savedLine(
  name: string,
  before: number,
  after: number,
  removed: boolean,
): string {
  const gone = before - after;
  return `Saved ${name}: ${fmt(after)} bytes${removed && gone > 0 ? `, ${fmt(gone)} bytes of personal data removed` : ""}.`;
}
