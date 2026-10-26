// "The same engine in your terminal and your agent.": a terminal that types
// the command and prints the CLI's output for the ChatGPT example, or the
// agent skill's JSON. The lines are the engine's report, printed the way
// the CLI prints it.
import examples from "virtual:examples";
import { $, $$, copyText, esc, tabs } from "../dom.ts";
import { G, ScrollTrigger, TICK, TYPE, fadeIn, motion } from "../motion.ts";

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
    { cls: "t-dim", text: `tellall skill: npx -y tellall --json ${r.name}` },
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

function render(animate: boolean): void {
  const body = $("#term-body");
  termTL?.kill();
  termTL = null;
  const isCli = termKey === "cli";
  const cmd = isCli
    ? CLI_CMD
    : `What does ${examples.files.chatgpt.name} give away?`;
  const prompt = isCli ? "$ " : "> ";
  const lines = isCli ? cliLines() : agentLines();
  const pre = isCli
    ? ""
    : `<span class="t-dim">${esc("Install once in Claude Code: " + AGENT_CMD)}</span>\n\n`;
  body.innerHTML =
    `${pre}<span class="t-prompt">${prompt}</span><span class="t-cmd"></span><span class="caret" aria-hidden="true"></span>\n` +
    lines
      .map(
        (l) =>
          `<span class="t-line ${l.cls}">${l.html ?? esc(l.text ?? "")}</span>`,
      )
      .join("\n");
  const cmdEl = $(".t-cmd", body);
  const caret = $(".caret", body);
  const out = $$(".t-line", body);
  $("#term-copy span").textContent = isCli
    ? "Copy command"
    : "Copy install command";
  if (!animate || !motion()) {
    cmdEl.textContent = cmd;
    caret.remove();
    if (animate) fadeIn(body);
    return;
  }
  G.set(out, { opacity: 0 });
  const tl = G.timeline();
  termTL = tl;
  const o = { n: 0 };
  // Typed one character per tick, then the output prints line by line, as
  // a terminal does.
  tl.to(
    o,
    {
      n: cmd.length,
      duration: cmd.length * TYPE,
      ease: `steps(${cmd.length})`,
      onUpdate: () => {
        cmdEl.textContent = cmd.slice(0, Math.round(o.n));
      },
    },
    0.25,
  )
    .add(() => caret.remove(), "+=0.3")
    .to(out, { opacity: 1, duration: 0.01, stagger: TICK }, ">");
}

export function initTerm(): void {
  tabs($("#term .tabs"), (t) => {
    termKey = t.dataset["term"] ?? "cli";
    $("#term-body").setAttribute("aria-labelledby", t.id);
    render(true);
  });
  render(false);
  $("#term-copy").addEventListener("click", async () => {
    const ok = await copyText(termKey === "cli" ? CLI_CMD : AGENT_CMD);
    const s = $("#term-copy span");
    const was = s.textContent;
    s.textContent = ok ? "Copied" : "Copy failed";
    setTimeout(() => (s.textContent = was), 1600);
  });
}

export function termScenes(): void {
  ScrollTrigger.create({
    trigger: "#term",
    start: "top 75%",
    once: true,
    onEnter: () => render(true),
  });
}
