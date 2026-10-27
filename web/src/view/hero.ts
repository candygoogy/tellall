// The hero: the dump of chatgpt-image.png's first bytes (written into
// index.html at build time from the fixture), whose cursor glides the PNG
// header to the byte where the C2PA label starts; and the tilted reader
// window, which flattens as the page scrolls and leans toward the pointer.
import { $, $$, maybe } from "../dom.ts";
import { G, decode, fineMQ, motion, still } from "../motion.ts";

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

/** The window flattens over the first 600 px of scroll; on a fine pointer
 * it leans toward the pointer and, at rest, eases flat and drops its
 * transform so its text renders crisp. */
export function initTilt(): void {
  const stage = $("#stage");
  const tilt = $(".win-tilt");
  const reader = $("#reader");
  G.matchMedia().add(
    { ok: "(min-width: 760px) and (prefers-reduced-motion: no-preference)" },
    (ctx) => {
      if (!ctx.conditions?.["ok"] || still) return;
      G.fromTo(
        ".win-scroll",
        { rotateX: 20, scale: 0.92 },
        {
          rotateX: 6,
          scale: 1,
          ease: "none",
          scrollTrigger: { start: 0, end: 600, scrub: 0.6 },
        },
      );
      if (!fineMQ.matches) return;
      G.set(tilt, { transformPerspective: 2400 });
      const rx = G.quickTo(tilt, "rotationX", {
        duration: 0.8,
        ease: "power3",
      });
      const ry = G.quickTo(tilt, "rotationY", {
        duration: 0.8,
        ease: "power3",
      });
      let flat = false;
      let lastMove = 0;
      let idleT = 0;
      const settle = () => {
        rx(0);
        ry(0);
        setTimeout(() => {
          if (Date.now() - lastMove > 1300) {
            G.set(tilt, { clearProps: "transform" });
            flat = true;
          }
        }, 950);
      };
      const move = (e: PointerEvent) => {
        if (flat) {
          G.set(tilt, { transformPerspective: 2400 });
          flat = false;
        }
        const r = reader.getBoundingClientRect();
        rx(-((e.clientY - r.top) / r.height - 0.5) * 2.4);
        ry(((e.clientX - r.left) / r.width - 0.5) * 3.2);
        lastMove = Date.now();
        clearTimeout(idleT);
        idleT = window.setTimeout(settle, 1400);
      };
      stage.addEventListener("pointermove", move);
      stage.addEventListener("pointerleave", settle);
      return () => {
        stage.removeEventListener("pointermove", move);
        stage.removeEventListener("pointerleave", settle);
        G.set(tilt, { clearProps: "transform" });
      };
    },
  );
}
