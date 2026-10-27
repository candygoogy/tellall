// The hero: the dump of chatgpt-image.png's first bytes (written into
// index.html at build time from the fixture), whose cursor glides the PNG
// header to the byte where the C2PA label starts; and the tilted reader
// window, which flattens as the page scrolls or the pointer rests on it.
import { $, $$, maybe } from "../dom.ts";
import { G, decode, motion, still } from "../motion.ts";

/** The cursor glides down the header a row at a time to the label's
 * first byte, each move a short ease from cell to cell; then the label's
 * rows light up and the cursor rests there. */
export function walkDump(): void {
  const dump = maybe("#hexdump");
  if (!dump) return;
  const at = Number(dump.dataset["labelAt"]);
  const cells = $$(".hd-hex i", dump);
  const asc = $$(".hd-asc i", dump);
  const rows = $$(".hd-row", dump);
  const seen = (i: number) => {
    cells[i]?.classList.add("seen");
    asc[i]?.classList.add("seen");
  };
  const rest = () => {
    cells.forEach((c) => c.classList.remove("cur"));
    cells[at]?.classList.add("cur", "is-rest");
  };
  const firstLit = Math.floor(at / 8);
  if (!motion()) {
    for (let i = 0; i <= at; i++) seen(i);
    rows.slice(firstLit).forEach((r) => r.classList.add("is-on"));
    rest();
    return;
  }
  const stops = [
    ...Array.from({ length: firstLit + 1 }, (_, k) => k * 8).filter(
      (s) => s < at,
    ),
    at,
  ];
  // The moving cursor is one block under the bytes, carried by transforms;
  // a cell that's hidden (narrow screens show only the rows near the label)
  // is passed without a stop.
  const where = (i: number) => {
    const c = cells[i];
    return c?.offsetParent === dump
      ? { x: c.offsetLeft, y: c.offsetTop }
      : null;
  };
  const block = document.createElement("span");
  block.className = "hd-glide";
  const size = cells[at];
  if (size) {
    block.style.width = size.offsetWidth + "px";
    block.style.height = size.offsetHeight + "px";
  }
  dump.appendChild(block);
  dump.classList.add("is-walk");
  const tl = G.timeline({
    onComplete: () => {
      block.remove();
      dump.classList.remove("is-walk");
    },
  });
  let prev = -1;
  let shown = false;
  for (const stop of stops) {
    const p = where(stop);
    if (p && !shown) {
      tl.set(block, { x: p.x, y: p.y }).to(block, {
        opacity: 1,
        duration: 0.08,
        ease: "none",
      });
      shown = true;
    } else if (p) {
      tl.to(block, { x: p.x, y: p.y, duration: 0.11, ease: "power2.inOut" });
    }
    const from = prev;
    tl.call(() => {
      for (let j = from + 1; j <= stop; j++) seen(j);
    });
    prev = stop;
  }
  // The block hands over to the label's own cell, which blinks and rests.
  tl.call(rest).set(block, { opacity: 0 });
  rows.slice(firstLit).forEach((row, i) => {
    tl.call(() => row.classList.add("is-on"), [], i ? "+=0.07" : ">");
  });
  tl.call(() => decode(maybe(".hd-note", dump), 0.4), [], "+=0.07");
  tl.to({}, { duration: 0.25 });
}

/** The window starts tilted, the hero's picture. Two things flatten it:
 * scrolling (all the way over the first 600 px) and the pointer resting on
 * it, which tilts it back when it leaves. A click or a tab into it keeps it
 * flat for good. Flat, it drops its transform, so its text renders crisp. */
export function initTilt(): void {
  const win = $(".win-scroll");
  G.matchMedia().add(
    { ok: "(min-width: 760px) and (prefers-reduced-motion: no-preference)" },
    (ctx) => {
      if (!ctx.conditions?.["ok"]) return;
      if (still) {
        win.classList.add("is-flat");
        return;
      }
      // How tilted, from 1 (the hero picture) to 0 (flat): what scrolling
      // has left of the tilt, times what the pointer leaves of it.
      const t = { scroll: 1, hover: 1 };
      let used = false;
      const apply = () => {
        const k = t.scroll * t.hover;
        if (k < 0.001) {
          G.set(win, { clearProps: "transform" });
          win.classList.add("is-flat");
          return;
        }
        win.classList.remove("is-flat");
        G.set(win, { rotateX: 20 * k, scale: 1 - 0.08 * k });
      };
      apply();
      G.to(t, {
        scroll: 0,
        ease: "none",
        onUpdate: apply,
        scrollTrigger: { start: 0, end: 600, scrub: 0.6 },
      });
      const ease = (hover: number) =>
        G.to(t, {
          hover,
          duration: 0.45,
          ease: "power2.out",
          overwrite: true,
          onUpdate: apply,
        });
      const enter = (e: PointerEvent) => {
        if (e.pointerType === "mouse") ease(0);
      };
      const leave = () => {
        if (!used) ease(1);
      };
      const use = () => {
        used = true;
        ease(0);
      };
      win.addEventListener("pointerenter", enter);
      win.addEventListener("pointerleave", leave);
      win.addEventListener("pointerdown", use);
      win.addEventListener("focusin", use);
      return () => {
        win.removeEventListener("pointerenter", enter);
        win.removeEventListener("pointerleave", leave);
        win.removeEventListener("pointerdown", use);
        win.removeEventListener("focusin", use);
        win.classList.remove("is-flat");
      };
    },
  );
}
