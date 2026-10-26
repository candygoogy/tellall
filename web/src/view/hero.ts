// The hero: the dump of chatgpt-image.png's first bytes (written into
// index.html at build time from the fixture), whose cursor walks the PNG
// header to the byte where the C2PA label starts; and the tilted reader
// window, which flattens as the page scrolls and leans toward the pointer.
import { $, $$, maybe } from "../dom.ts";
import { G, TICK, decode, fineMQ, motion, still } from "../motion.ts";

/** The cursor walks the header a row at a time to the label's first byte,
 * then the label's rows light up and the cursor rests there. */
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
  if (!motion()) {
    for (let i = 0; i <= at; i++) seen(i);
    rows.slice(Math.floor(at / 8)).forEach((r) => r.classList.add("is-on"));
    rest();
    return;
  }
  const stops = [
    ...Array.from({ length: Math.floor(at / 8) + 1 }, (_, k) => k * 8).filter(
      (s) => s < at,
    ),
    at,
  ];
  let k = 0;
  let prev = -1;
  const walk = () => {
    if (prev >= 0) cells[prev]?.classList.remove("cur");
    const stop = stops[k++];
    if (stop !== undefined) {
      for (let j = Math.max(0, prev + 1); j <= stop; j++) seen(j);
      cells[stop]?.classList.add("cur");
      prev = stop;
      setTimeout(walk, TICK * 1000);
      return;
    }
    rest();
    let r = Math.floor(at / 8);
    const light = () => {
      const row = rows[r++];
      if (!row) {
        decode(maybe(".hd-note", dump), 0.4);
        return;
      }
      row.classList.add("is-on");
      setTimeout(light, TICK * 1000);
    };
    light();
  };
  walk();
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
          ease: "steps(7)",
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
