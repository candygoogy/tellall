// "Nothing leaves this page.": a map of where a file goes (into this tab's
// worker, onto the screen) and the one way it can't (the network), with an
// honest count of the page's network requests and a button that tries to
// send one, so the visitor sees the page's own rules stop it.
import { $, $$, fmt } from "../dom.ts";
import { FADE, G, ScrollTrigger, motion, reduceMQ } from "../motion.ts";
import { latestFileName, onLiveChange } from "./result.ts";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Geo {
  f: Box;
  t: Box;
  o: Box;
  n: Box;
  g: Box;
}

const narrowMQ = matchMedia("(max-width: 899px)");
/** A name reserved never to resolve (RFC 2606). */
const TARGET = "tellall.invalid";
let geo: Geo | null = null;
let netTL: gsap.core.Timeline | null = null;

function buildGrid(): void {
  const grid = $("#net-grid");
  const narrow = narrowMQ.matches;
  const cols = narrow ? 8 : 16;
  const rows = narrow ? 16 : 11;
  grid.style.setProperty("--cols", String(cols));
  grid.textContent = "";
  for (let r = 0; r < rows; r++) {
    const b = document.createElement("b");
    b.textContent = (r * cols).toString(16).padStart(4, "0");
    grid.appendChild(b);
    for (let c = 0; c < cols; c++)
      grid.appendChild(document.createElement("i"));
  }
  grid.dataset["cols"] = String(cols);
  grid.dataset["rows"] = String(rows);
}

function drawLines(): Geo {
  const svg = $("#net-lines");
  const box = $(".net-map").getBoundingClientRect();
  const c = (id: string): Box => {
    const r = $(id).getBoundingClientRect();
    return {
      x: r.left - box.left + r.width / 2,
      y: r.top - box.top + r.height / 2,
      w: r.width,
      h: r.height,
    };
  };
  const f = c("#node-file");
  const t = c("#node-tab");
  const o = c("#node-out");
  const n = c("#node-net");
  const g = c("#gate");
  svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
  const narrow = narrowMQ.matches;
  const p1 = narrow
    ? `M${f.x} ${f.y + f.h / 2} L${t.x} ${t.y - t.h / 2}`
    : `M${f.x + f.w / 2} ${f.y} L${t.x - t.w / 2} ${t.y}`;
  const p2 = narrow
    ? `M${t.x} ${t.y + t.h / 2} L${o.x} ${o.y - o.h / 2}`
    : `M${t.x + t.w / 2} ${t.y} L${o.x - o.w / 2} ${o.y}`;
  const p3 = narrow
    ? `M${t.x + t.w / 2} ${t.y} L${g.x - g.w / 2} ${g.y}`
    : `M${t.x} ${t.y - t.h / 2} L${g.x} ${g.y + g.h / 2}`;
  const p4 = narrow
    ? `M${g.x + g.w / 2} ${g.y} L${n.x - n.w / 2} ${n.y}`
    : `M${g.x} ${g.y - g.h / 2} L${n.x} ${n.y + n.h / 2}`;
  svg.innerHTML = `<path class="ln" d="${p1}"/><path class="ln" d="${p2}"/><path class="ln-flow" id="flow1" d="${p1}"/><path class="ln-flow" id="flow2" d="${p2}"/><path class="ln" d="${p3}"/><path class="ln-block" d="${p4}"/>`;
  return { f, t, o, n, g };
}

function layoutNet(): void {
  buildGrid();
  geo = drawLines();
}

function playNet(cycles = 2): void {
  if (!motion() || !geo) return;
  const net = $("#net");
  netTL?.kill();
  $$(".packet", net).forEach((p) => p.remove());
  const map = $(".net-map");
  const mk = () => {
    const p = document.createElement("span");
    p.className = "packet";
    map.appendChild(p);
    return p;
  };
  const tl = G.timeline({
    repeat: cycles < 0 ? -1 : cycles - 1,
    repeatDelay: 0.8,
  });
  netTL = tl;
  tl.fromTo(
    $$(".ln-flow", net),
    { strokeDashoffset: 60 },
    { strokeDashoffset: 0, duration: 2.6, ease: "none" },
    0,
  );
  // Three packets: file to tab to screen, gliding along the drawn paths.
  const along = (
    path: SVGPathElement,
    el: HTMLElement,
    at: number,
    dur: number,
  ) => {
    const len = path.getTotalLength();
    const o = { t: 0 };
    tl.fromTo(el, { opacity: 0 }, { opacity: 1, ...FADE }, at)
      .to(
        o,
        {
          t: 1,
          duration: dur,
          ease: "power2.inOut",
          onUpdate: () => {
            const pt = path.getPointAtLength(o.t * len);
            G.set(el, { x: pt.x, y: pt.y });
          },
        },
        at,
      )
      .to(el, { opacity: 0, duration: 0.1, ease: "none" }, at + dur - 0.05);
  };
  const f1 = $<SVGPathElement>("#flow1");
  const f2 = $<SVGPathElement>("#flow2");
  for (let i = 0; i < 3; i++) {
    along(f1, mk(), i * 0.32, 0.9);
    along(f2, mk(), 0.95 + i * 0.32, 0.9);
  }
  // One packet tries the network and stops at the gate.
  const up = mk();
  const g = geo.g;
  const t = geo.t;
  const narrow = narrowMQ.matches;
  const gp = narrow ? { x: g.x - 14, y: g.y } : { x: g.x, y: g.y + 14 };
  tl.set(
    up,
    narrow ? { x: t.x + t.w / 2, y: t.y } : { x: t.x, y: t.y - t.h / 2 },
    0.6,
  )
    .to(up, { opacity: 1, ...FADE }, 0.6)
    .to(up, { x: gp.x, y: gp.y, duration: 0.7, ease: "power2.inOut" }, 0.6)
    .add(() => {
      const gate = $("#gate");
      gate.classList.add("is-hit");
      setTimeout(() => gate.classList.remove("is-hit"), 700);
    }, 1.3)
    .to(
      up,
      {
        keyframes: [
          { opacity: 0.2, duration: 0.1, ease: "power2.out" },
          { opacity: 1, duration: 0.1, ease: "power2.out" },
          { opacity: 0, duration: 0.14, ease: "power2.out" },
        ],
      },
      1.3,
    );
  // The cursor reads the field row by row: each cell lights quickly, then
  // dims and settles back.
  const css = getComputedStyle(document.documentElement);
  const rgb = (name: string) =>
    css.getPropertyValue(name).trim().split(/\s+/).join(",");
  const C = rgb("--cursor-rgb");
  const P = rgb("--paper-rgb");
  tl.fromTo(
    $$("i", $("#net-grid")),
    { backgroundColor: `rgba(${P},0.14)` },
    {
      keyframes: [
        { backgroundColor: `rgba(${C},1)`, duration: 0.1, ease: "power2.out" },
        {
          backgroundColor: `rgba(${C},0.45)`,
          duration: 0.24,
          ease: "power2.out",
        },
        {
          backgroundColor: `rgba(${P},0.14)`,
          duration: 0.3,
          ease: "power2.out",
        },
      ],
      stagger: { amount: 1.6, from: "start" },
    },
    0,
  );
}

// Every resource the browser records that isn't this page's own file, a
// blob or a data URL. connect-src 'none' should keep it at zero.
let count = 0;
function recount(): void {
  const here = location.origin;
  count = performance
    .getEntriesByType("resource")
    .filter(
      (e) => /^(https?|wss?):/i.test(e.name) && !e.name.startsWith(here + "/"),
    ).length;
  $("#req-count").textContent = fmt(count);
}

/** "Your file" is the visitor's newest file, once there is one; the lines
 * are drawn again when its width changes. */
function nameFile(): void {
  const v = $("#node-file .node-v");
  const name = latestFileName();
  if (v.textContent === name) return;
  v.textContent = name;
  v.title = name;
  if (geo) geo = drawLines();
}

export function initPrivacy(): void {
  nameFile();
  layoutNet();
  onLiveChange(nameFile);
  let resizeT = 0;
  addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = window.setTimeout(layoutNet, 150);
  });
  recount();
  try {
    new PerformanceObserver(recount).observe({
      type: "resource",
      buffered: true,
    });
  } catch {
    // Older browsers: the first count stands.
  }
  let blocked = 0;
  let sent = 0;
  $("#req-try").addEventListener("click", async () => {
    const st = $("#req-status");
    st.textContent = "Trying to reach tellall.invalid…";
    // Blocked means the page's own rules (connect-src) refused it, which
    // the browser reports as a violation. A failed fetch alone proves
    // nothing: tellall.invalid doesn't exist, so it fails anyway.
    let refused = false;
    const onViolation = (e: SecurityPolicyViolationEvent) => {
      if (
        /connect-src/.test(e.effectiveDirective || e.violatedDirective) &&
        e.blockedURI.includes(TARGET)
      ) {
        refused = true;
      }
    };
    addEventListener("securitypolicyviolation", onViolation);
    let answered: boolean;
    try {
      await fetch(`https://${TARGET}/`, { mode: "no-cors", cache: "no-store" });
      answered = true;
    } catch {
      answered = false;
    }
    // The report can come a moment after the fetch fails.
    for (let i = 0; i < 10 && !refused; i++) {
      await new Promise((go) => setTimeout(go, 30));
    }
    removeEventListener("securitypolicyviolation", onViolation);
    recount();
    if (refused) blocked++;
    else sent++;
    $("#req-blocked").textContent =
      `${fmt(blocked)} ${blocked === 1 ? "attempt" : "attempts"} blocked, ${fmt(sent)} sent`;
    st.textContent = refused
      ? "Blocked before it left: this page's rules allow no connections."
      : answered
        ? "The request went out. This page's rules should have stopped it."
        : "The request left this page; it failed only because tellall.invalid doesn't exist. This page's rules should have stopped it.";
    playNet(2);
  });
  const replay = $("#net-replay");
  replay.addEventListener("click", () => playNet(2));
  // Under reduced motion the diagram stays still: nothing to replay.
  const sync = () => (replay.hidden = !motion());
  reduceMQ.addEventListener("change", sync);
  sync();
}

export function privacyScenes(): void {
  ScrollTrigger.create({
    trigger: "#net",
    start: "top 70%",
    once: true,
    onEnter: () => {
      G.from(".node", { opacity: 0, ...FADE, stagger: 0.1 });
      playNet(2);
    },
  });
}
