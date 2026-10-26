// Text with its hidden characters marked inline as U+XXXX chips, and a
// position map with one tick per marked character. Positions come from the
// engine's own fields ("at 21, 94"), never from a scan of the page's own.
import type { Report } from "@tellall/engine";
import { esc } from "../dom.ts";

// Character names the engine says ("ZERO WIDTH SPACE (U+200B) ×2"), set as code.
const CHAR_RE =
  /([A-Z][A-Z0-9-]*(?: [A-Z0-9-]+)* \(U\+[0-9A-F]{4,6}\)(?: ×\d+)?)/g;

/** An engine sentence as HTML, its character names set as code. */
export const sentenceHTML = (t: string) =>
  esc(t).replace(CHAR_RE, "<code>$1</code>");

export type ChipClass = "c-hidden" | "c-harmless" | "c-space";

export const chipClass = (
  kind: Report["findings"][number]["kind"],
): ChipClass =>
  kind === "private"
    ? "c-hidden"
    : kind === "harmless"
      ? "c-harmless"
      : "c-space";

interface Hit {
  cls: ChipClass;
  name: string;
}

function charMap(report: Report): Map<number, Hit> {
  const map = new Map<number, Hit>();
  for (const f of report.findings) {
    if (f.group !== "hidden-chars") continue;
    const cls = chipClass(f.kind);
    for (const fld of f.fields) {
      const m = /\bat ([\d, ]+)$/.exec(fld.value);
      if (!m?.[1]) continue;
      for (const n of m[1].split(/,\s*/)) {
        const i = parseInt(n, 10);
        if (!Number.isNaN(i)) map.set(i, { cls, name: fld.name });
      }
    }
  }
  return map;
}

/** Writes the text into `box` with chips, and the ticks into `mapEl`. */
export function renderChips(
  box: HTMLElement,
  mapEl: HTMLElement | null,
  plain: string,
  report: Report,
): Map<number, Hit> {
  const map = charMap(report);
  box.textContent = "";
  let buf = "";
  // A nowrap span holding a chip with the word before it and the
  // punctuation after it.
  let group: HTMLSpanElement | null = null;
  const flush = () => {
    if (buf) {
      box.appendChild(document.createTextNode(buf));
      buf = "";
    }
  };
  for (let i = 0; i < plain.length; i++) {
    const hit = map.get(i);
    const cp = plain.codePointAt(i) ?? 0;
    const wide = cp > 0xffff;
    const ch = wide ? plain.slice(i, i + 2) : (plain[i] ?? "");
    if (hit) {
      if (!group) {
        const m = /\S*$/.exec(buf);
        const word = m ? m[0] : "";
        buf = buf.slice(0, buf.length - word.length);
        flush();
        group = document.createElement("span");
        group.className = "nw";
        if (word) group.appendChild(document.createTextNode(word));
        box.appendChild(group);
      }
      const c = document.createElement("span");
      c.className = "chip " + hit.cls;
      c.dataset["at"] = String(i);
      c.textContent = "U+" + cp.toString(16).toUpperCase().padStart(4, "0");
      c.title = hit.name;
      group.appendChild(c);
    } else if (group && !/\s/.test(ch)) {
      group.appendChild(document.createTextNode(ch));
    } else {
      group = null;
      buf += ch;
    }
    if (wide) i++;
  }
  flush();
  if (mapEl) {
    mapEl.textContent = "";
    const track = document.createElement("span");
    track.className = "pmap-track";
    mapEl.appendChild(track);
    for (const [i, hit] of map) {
      const t = document.createElement("span");
      t.className = "pmap-tick " + hit.cls;
      t.style.left = (i / Math.max(1, plain.length - 1)) * 100 + "%";
      t.dataset["at"] = String(i);
      mapEl.appendChild(t);
    }
  }
  return map;
}
