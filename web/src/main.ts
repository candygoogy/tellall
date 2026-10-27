// tellall's page (spec §5.1, §5.1a; the approved mockup design/d2). Every
// sentence on it comes from the engine: the example readings were made by
// the engine on the repo's fixtures when the page was built
// (virtual:examples), and the visitor's own files and text are read by the
// engine in a Web Worker in this tab (worker.ts). Nothing is sent anywhere:
// the page's CSP allows no connections.
import "./styles/index.css";
import { $, $$ } from "./dom.ts";
import { setMayReload, warm } from "./engine.ts";
import { EASE, FADE, G, ScrollTrigger, motion, typeTitle } from "./motion.ts";
import { cleanScenes, initClean } from "./view/clean.ts";
import { initDrop } from "./view/drop.ts";
import { initHidden, hiddenScenes } from "./view/hidden.ts";
import { initTilt, walkDump } from "./view/hero.ts";
import { initLabels, labelsScenes } from "./view/labels.ts";
import { initPaste } from "./view/paste.ts";
import { initPrivacy, privacyScenes } from "./view/privacy.ts";
import {
  FIRST,
  current,
  initReader,
  live,
  play,
  setReading,
  show,
} from "./view/result.ts";
import { fitNames } from "./view/anatomy.ts";
import { initTerm, termScenes } from "./view/term.ts";

const nav = $("#nav");

function initNav(): void {
  const onScroll = () => nav.classList.toggle("is-scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  // Cursors below the fold blink when they come into view, five times,
  // then rest solid.
  const seen = new IntersectionObserver(
    (es) =>
      es.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in-view");
          seen.unobserve(e.target);
        }
      }),
    { threshold: 0.6 },
  );
  $$(".mini-addr, .foot-dump").forEach((el) => seen.observe(el));
  // The nav's own "Choose images" and "Paste text" show once the hero's
  // buttons are gone, under the nav counting as gone.
  new IntersectionObserver(
    ([e]) => nav.classList.toggle("has-cta", !e?.isIntersecting),
    { rootMargin: `-${nav.offsetHeight}px 0px 0px 0px` },
  ).observe($(".hero .hero-actions"));
  const menu = $(".nav-menu");
  const sheet = $("#nav-sheet");
  const close = () => {
    sheet.hidden = true;
    menu.setAttribute("aria-expanded", "false");
    menu.textContent = "Menu";
  };
  menu.addEventListener("click", () => {
    const open = menu.getAttribute("aria-expanded") !== "true";
    menu.setAttribute("aria-expanded", String(open));
    sheet.hidden = !open;
    menu.textContent = open ? "Close" : "Menu";
  });
  $$("a", sheet).forEach((a) => a.addEventListener("click", close));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !sheet.hidden) {
      close();
      menu.focus();
    }
  });
}

// The hero is built before first paint so nothing shifts when the intro
// plays: the example is already in the window, held at its first frame.
let heroTL: gsap.core.Timeline | null = null;
function prepareIntro(): void {
  show(FIRST, "none");
  if (!motion()) {
    walkDump();
    return;
  }
  const reading = play("intro", true);
  // The headline is uncovered by the cursor; everything else fades in, and
  // the dump's cursor glides to the label while the window reads.
  heroTL = G.timeline({ paused: true, defaults: { ease: EASE } });
  const typed = typeTitle($("#hero-title"), 0.6);
  if (typed) heroTL.add(typed.play(), 0.05);
  heroTL
    .from(".hero-lede", { opacity: 0, ...FADE }, 0.1)
    .from(
      ".hero .hero-actions .btn",
      { opacity: 0, ...FADE, stagger: 0.06 },
      0.7,
    )
    .from(".nav-in > *", { opacity: 0, ...FADE, stagger: 0.04 }, 0.1)
    .from("#reader", { opacity: 0, y: 48, duration: 0.95 }, 0.5)
    .add(walkDump, 0.75)
    .add(() => {
      // Only if the first example is still what the window shows.
      if (reading && current === FIRST) {
        setReading(reading);
        reading.play(0);
      }
    }, 1.05);
}

function scrollScenes(): void {
  if (!motion()) return;
  // Section titles: uncovered by the cursor when they come into view; ledes
  // follow with a plain fade.
  $$(".sec-title, .close-title").forEach((t) => {
    const typed = typeTitle(t);
    if (typed)
      ScrollTrigger.create({
        trigger: t,
        start: "top 88%",
        once: true,
        onEnter: () => void typed.play(),
      });
  });
  $$(".sec-lede").forEach((p) =>
    G.from(p, {
      opacity: 0,
      ...FADE,
      delay: 0.3,
      scrollTrigger: { trigger: p, start: "top 88%", once: true },
    }),
  );
  labelsScenes();
  hiddenScenes();
  cleanScenes();
  termScenes();
  privacyScenes();
  // The current section's nav link carries the cursor.
  for (const id of ["labels", "hidden", "clean", "cli", "privacy"]) {
    const link = $(`.nav-links a[href="#${id}"]`);
    ScrollTrigger.create({
      trigger: "#" + id,
      start: "top 50%",
      end: "bottom 50%",
      onToggle: (s) => link.classList.toggle("is-active", s.isActive),
    });
  }
}

/** The opening plays once the fonts are in (they're font-display: block,
 * so text set before them would be invisible), without waiting for load,
 * which waits for every picture on the page. */
let introPlayed = false;
function playIntro(): void {
  if (introPlayed) return;
  introPlayed = true;
  heroTL?.play(0);
}

function start(): void {
  playIntro();
  scrollScenes();
  void document.fonts.ready.then(() => {
    ScrollTrigger.refresh();
    fitNames($("#r-view"));
    fitNames($("#cl"));
  });
  // Start the engine while the visitor reads, so the first drop is quick.
  (window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1200)))(() =>
    warm(),
  );
}

// A page that's out of date reloads only when that loses nothing.
setMayReload(() => live.length === 0);
initNav();
initReader();
initDrop();
initPaste();
initTilt();
initLabels();
initHidden();
initClean();
initTerm();
initPrivacy();
prepareIntro();
// The intro has set its first frames: what head.js held back can show.
document.documentElement.classList.remove("intro");
// The faces the opening sets, the headline's and the lede's: asked for by
// name, since fonts.ready alone can settle before the page has asked for
// any of them.
void Promise.all(
  ['1em "Martian Grotesk"', '1em "Inter"'].map((f) => document.fonts.load(f)),
).then(playIntro, playIntro);
if (document.readyState === "complete") start();
else addEventListener("load", start, { once: true });
