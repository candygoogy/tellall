// "Copied text can hide characters.": the example text with its hidden
// characters marked, the engine's sentences under it, and Copy clean text.
// "Paste your own" reads the visitor's text as they type.
import examples from "virtual:examples";
import type { Report } from "@tellall/engine";
import { $, $$, applyGeometry, copyText, fmt } from "../dom.ts";
import { read } from "../engine.ts";
import { FADE, G, ScrollTrigger, motion } from "../motion.ts";
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
      if (motion()) {
        G.fromTo(
          $$(".chip", text),
          { opacity: 0 },
          { opacity: 1, duration: 0.01, stagger: 0.06, clearProps: "opacity" },
        );
      }
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
  // A paste's formatted copy goes with its text only while the box still
  // holds exactly that text: typed or edited text has no page behind it.
  const lines = (t: string) => t.replace(/\r\n?/g, "\n");
  let pasted: { plain: string; html: string } | null = null;
  input.addEventListener("paste", (e) => {
    const html = e.clipboardData?.getData("text/html");
    const plain = e.clipboardData?.getData("text/plain");
    pasted = html && plain ? { plain: lines(plain), html } : null;
  });
  let timer = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = window.setTimeout(async () => {
      const plain = input.value;
      if (!plain) {
        example();
        return;
      }
      const html =
        pasted && lines(plain) === pasted.plain ? pasted.html : undefined;
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
    }, 220);
  });
  $("#hx-copy").addEventListener("click", async () => {
    const ok = await copyText(hx.clean);
    status.textContent = ok
      ? `Copied ${fmt([...hx.clean].length)} characters as plain text.`
      : "The browser didn't allow copying. Select the text and copy it instead.";
    const lbl = $("#hx-copy span");
    if (ok) {
      lbl.textContent = "Copied";
      setTimeout(() => (lbl.textContent = "Copy clean text"), 1600);
    }
  });
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
        .fromTo(
          chips,
          { opacity: 0 },
          { opacity: 1, duration: 0.01, stagger: 0.14, clearProps: "opacity" },
          0.2,
        )
        .from(ticks, { opacity: 0, duration: 0.01, stagger: 0.14 }, 0.2)
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
