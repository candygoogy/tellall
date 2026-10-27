// "Copied text can hide characters.": the example text with its hidden
// characters marked, the engine's sentences under it, and Copy clean text.
// "Paste your own" reads the visitor's text as they type (live-text.ts,
// as the reader's own text box does).
import examples from "virtual:examples";
import type { Report } from "@tellall/engine";
import { $, $$, applyGeometry, fmt } from "../dom.ts";
import { read } from "../engine.ts";
import { copiedChars, copyWith } from "../feedback.ts";
import { FADE, G, POP, ScrollTrigger, lightChips, motion } from "../motion.ts";
import { liveText, type Pasted } from "./live-text.ts";
import { renderChips, sentenceHTML } from "./text.ts";

const EXAMPLE = "Example text with planted characters";

const hx = {
  plain: examples.text.plain,
  report: examples.text.report as Report,
  clean: examples.text.clean,
};

function render(): void {
  renderChips($("#hx-text"), $("#hx-map"), hx.plain, hx.report);
  $("#hx-headline").textContent = hx.report.headline;
  const n = Array.from(hx.plain).length;
  $("#hx-scale").innerHTML =
    `<span>Character 0</span><span>${fmt(Math.max(0, n - 1))}</span>`;
  $("#hx-findings").innerHTML = hx.report.findings
    .map(
      (f) =>
        `<li><span class="f-mark k-${f.kind}" aria-hidden="true"></span><span>${sentenceHTML(f.sentence)}</span></li>`,
    )
    .join("");
}

export function initHidden(): void {
  const text = $("#hx-text");
  const status = $("#hx-status");
  render();
  $<HTMLInputElement>("#hx-show").addEventListener("change", (e) => {
    const on = (e.target as HTMLInputElement).checked;
    if (on) {
      text.classList.remove("chips-off");
      if (motion()) lightChips($$(".chip", text), 0.06);
    } else text.classList.add("chips-off");
  });
  const own = $("#hx-own");
  const input = $<HTMLTextAreaElement>("#hx-input");
  const wrap = $("#hx-input-wrap");
  // Each reading's number: an answer that isn't the latest one asked, or
  // that comes after the box was closed, is dropped.
  let asked = 0;
  const example = () => {
    asked++;
    hx.plain = examples.text.plain;
    hx.report = examples.text.report;
    hx.clean = examples.text.clean;
    $("#hx-src").textContent = EXAMPLE;
    status.textContent = "";
    render();
  };
  own.addEventListener("click", () => {
    const open = wrap.hidden;
    wrap.hidden = !open;
    own.setAttribute("aria-expanded", String(open));
    own.textContent = open ? "Back to the example" : "Paste your own";
    if (open) input.focus();
    else example();
  });
  let pasted: Pasted | null = null;
  liveText(input, {
    pasted: () => pasted,
    setPasted: (p) => (pasted = p),
    empty: () => (status.textContent = "Paste or type some text first."),
    read: async (plain, html) => {
      if (!plain) {
        example();
        return;
      }
      const mine = ++asked;
      status.textContent = "Reading…";
      try {
        const res = await read({
          kind: "text",
          plain,
          ...(html ? { html } : {}),
        });
        if (mine !== asked || wrap.hidden) return;
        hx.plain = plain;
        hx.report = res.report;
        hx.clean = String(res.cleaned.output);
        $("#hx-src").textContent = "Your text";
        status.textContent = `Read on this device in ${fmt(Math.max(1, res.ms))} ms.`;
        render();
      } catch (err) {
        if (mine !== asked || wrap.hidden) return;
        status.textContent =
          "tellall couldn't read it: " + (err as Error).message;
      }
    },
  });
  const copy = $("#hx-copy");
  copy.addEventListener(
    "click",
    () => void copyWith(copy, hx.clean, copiedChars(hx.clean), status),
  );
  // The formatted-copy bars, to scale.
  applyGeometry($(".fc"));
}

export function hiddenScenes(): void {
  // The text settles, then each hidden character lights up where it sits.
  ScrollTrigger.create({
    trigger: "#hx",
    start: "top 75%",
    once: true,
    onEnter: () => {
      const chips = $$(".chip", $("#hx-text"));
      const ticks = $$(".pmap-tick", $("#hx-map"));
      G.timeline()
        .add(lightChips(chips, 0.14), 0.2)
        .from(ticks, { opacity: 0, ...POP, stagger: 0.14 }, 0.2)
        .from(
          $$("#hx-findings li"),
          { opacity: 0, ...FADE, stagger: 0.08 },
          0.7,
        );
    },
  });
  G.from(".fc-layer", {
    opacity: 0,
    ...FADE,
    stagger: 0.12,
    clearProps: "opacity",
    scrollTrigger: { trigger: ".fc-layers", start: "top 80%", once: true },
  });
}
