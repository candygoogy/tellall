// "The same engine in your terminal and your agent.": a terminal that types
// the command and prints the CLI's output for the ChatGPT example, or the
// agent skill's JSON. The lines are the engine's report, printed the way
// the CLI prints it.
import examples from "virtual:examples";
import { $, $$, esc, tabs } from "../dom.ts";
import { copyWith, setRest } from "../feedback.ts";
import { FADE, G, ScrollTrigger, fadeIn, motion } from "../motion.ts";

const CLI_CMD = `npx tellall ${examples.files.chatgpt.name}`;
const AGENT_CMD = "/plugin install tellall --marketplace candygoogy/tellall";

interface Line {
  cls: string;
  text?: string;
  html?: string;
}

function cliLines(): Line[] {
  const r = examples.files.chatgpt.report;
  return [
    { cls: "t-file", text: r.name },
    { cls: "t-head", text: "  " + r.headline },
    ...r.findings.map((f) => ({
      cls: "",
      html: `  <span class="t-dot">·</span> ${esc(f.sentence)}`,
    })),
  ];
}

function agentLines(): Line[] {
  const r = examples.files.chatgpt.report;
  const j = (k: string, v: string) =>
    `    <span class="t-key">"${k}"</span>: <span class="t-str">${esc(JSON.stringify(v))}</span>,`;
  return [
    { cls: "t-dim", text: `tellall skill: npx -y tellall --json -- ${r.name}` },
    { cls: "", text: "[" },
    { cls: "", text: "  {" },
    { cls: "", html: j("name", r.name) },
    { cls: "", html: j("format", r.format) },
    { cls: "", html: j("headline", r.headline) },
    { cls: "", text: '    "findings": [' },
    ...r.findings.map((f, i) => ({
      cls: "",
      html: `      { <span class="t-key">"group"</span>: <span class="t-str">"${esc(f.group)}"</span>, <span class="t-key">"sentence"</span>: <span class="t-str">${esc(JSON.stringify(f.sentence))}</span> }${i < r.findings.length - 1 ? "," : ""}`,
    })),
    { cls: "t-dim", text: "    ], …fields and anatomy omitted here" },
    { cls: "", text: "  }" },
    { cls: "", text: "]" },
  ];
}

let termKey = "cli";
let termTL: gsap.core.Timeline | null = null;

/** A tab's command, prompt and printed lines, as the window shows them. */
function markup(isCli: boolean) {
  const cmd = isCli
    ? CLI_CMD
    : `What does ${examples.files.chatgpt.name} give away?`;
  const prompt = isCli ? "$ " : "> ";
  const lines = isCli ? cliLines() : agentLines();
  const pre = isCli
    ? ""
    : `<span class="t-dim">${esc("Install once in Claude Code: " + AGENT_CMD)}</span>\n\n`;
  const html =
    `${pre}<span class="t-prompt">${prompt}</span><span class="t-cmd"></span><span class="caret" aria-hidden="true"></span>\n` +
    lines
      .map(
        (l) =>
          `<span class="t-line ${l.cls}">${l.html ?? esc(l.text ?? "")}</span>`,
      )
      .join("\n") +
    // Then a fresh prompt, waiting; its caret comes once the output is in.
    `\n\n<span class="t-line t-idle"><span class="t-prompt">${prompt}</span></span>`;
  return { cmd, html };
}

/** On wider screens both tabs get the height of the longer one, so
 * switching tabs never resizes the window. Measured on a hidden copy, at
 * the window's width. */
function fitHeight(): void {
  const body = $("#term-body");
  // On phones the JSON wraps to twice the CLI's height: each keeps its own.
  if (window.matchMedia("(max-width: 759px)").matches) {
    body.style.minHeight = "";
    return;
  }
  const probe = document.createElement("pre");
  probe.className = body.className;
  probe.setAttribute("aria-hidden", "true");
  Object.assign(probe.style, {
    position: "absolute",
    left: "0",
    top: "0",
    visibility: "hidden",
    width: `${body.offsetWidth}px`,
    minHeight: "0",
  });
  document.body.append(probe);
  let h = 0;
  for (const isCli of [true, false]) {
    const m = markup(isCli);
    probe.innerHTML = m.html;
    $(".t-cmd", probe).textContent = m.cmd;
    h = Math.max(h, probe.offsetHeight);
  }
  probe.remove();
  body.style.minHeight = `${Math.ceil(h)}px`;
}

function render(animate: boolean): void {
  const body = $("#term-body");
  termTL?.kill();
  termTL = null;
  const isCli = termKey === "cli";
  const { cmd, html } = markup(isCli);
  body.innerHTML = html;
  const idle = $(".t-idle", body);
  const wait = () =>
    idle.insertAdjacentHTML(
      "beforeend",
      '<span class="caret" aria-hidden="true"></span>',
    );
  const cmdEl = $(".t-cmd", body);
  const caret = $(".caret", body);
  const out = $$(".t-line", body);
  setRest($("#term-copy"), isCli ? "Copy command" : "Copy install command");
  if (!animate || !motion()) {
    cmdEl.textContent = cmd;
    caret.remove();
    wait();
    if (animate) fadeIn(body);
    return;
  }
  G.set(out, { opacity: 0 });
  const tl = G.timeline();
  termTL = tl;
  // Typed at a person's uneven pace (a fixed pattern, so every visit looks
  // the same), a beat after each space; then Enter, and the output prints
  // line by line, as a terminal does.
  let at = 0.25;
  for (let i = 1; i <= cmd.length; i++) {
    at += 0.028 + ((i * 37) % 23) / 1000 + (cmd[i - 2] === " " ? 0.06 : 0);
    tl.call(() => (cmdEl.textContent = cmd.slice(0, i)), undefined, at);
  }
  tl.add(() => caret.remove(), at + 0.35)
    .to(out, { opacity: 1, ...FADE, stagger: 0.055 }, ">")
    .call(wait);
}

export function initTerm(): void {
  tabs($("#term .tabs"), (t) => {
    termKey = t.dataset["term"] ?? "cli";
    $("#term-body").setAttribute("aria-labelledby", t.id);
    render(true);
  });
  render(false);
  fitHeight();
  void document.fonts.ready.then(fitHeight);
  let width = 0;
  new ResizeObserver(([e]) => {
    const w = Math.round(e?.contentRect.width ?? 0);
    if (w === width) return;
    width = w;
    fitHeight();
  }).observe($("#term"));
  const copy = $("#term-copy");
  copy.addEventListener("click", () => {
    const cli = termKey === "cli";
    void copyWith(
      copy,
      cli ? CLI_CMD : AGENT_CMD,
      cli ? "Copied the command." : "Copied the install command.",
    );
  });
}

export function termScenes(): void {
  // Start blank, so the terminal doesn't show its finished output and then
  // wipe it when the typing starts.
  if (motion()) {
    const body = $("#term-body");
    $(".t-cmd", body).textContent = "";
    G.set($$(".t-line", body), { opacity: 0 });
  }
  ScrollTrigger.create({
    trigger: "#term",
    start: "top 75%",
    once: true,
    onEnter: () => render(true),
  });
}
