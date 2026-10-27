// "An AI image carries a signed label.": three steps (who signed it, what
// made it and when, what it says about the pixels) light the matching rows
// of an example label card. On wide screens the section pins and scrolling
// walks the steps. Every row and sentence comes from the engine's report.
import type { Report } from "@tellall/engine";
import examples from "virtual:examples";
import { $, $$, applyGeometry, esc, fmt, tabs } from "../dom.ts";
import type { ExampleFile } from "../example-types.ts";
import {
  FILL,
  G,
  POP,
  ScrollTrigger,
  decode,
  motion,
  swap,
} from "../motion.ts";
import { attachCursor, buildBar, zoomRange } from "./anatomy.ts";

interface Action {
  action: string;
  when?: string;
  softwareAgent?: string;
  digitalSourceType?: string;
  description?: string;
}
interface Row {
  k: string;
  v: string;
  step: number;
  code?: boolean;
}
interface Model {
  ex: ExampleFile;
  rows: Row[];
  actions: Action[];
  offset: number;
  where: string;
  sentences: string[];
}

function labelModel(ex: ExampleFile): Model {
  const report: Report = ex.report;
  const f0 = report.findings[0];
  const fields = f0?.fields ?? [];
  const get = (n: string) => fields.find((x) => x.name === n)?.value;
  const issuer = get("Certificate issuer") ?? "";
  const cn = /CN=([^,]+(?:\\,[^,]+)*)/.exec(issuer)?.[1] ?? issuer;
  const actions: Action[] = [];
  let cur: Action | null = null;
  for (const x of fields) {
    if (x.name === "action") {
      cur = { action: x.value };
      actions.push(cur);
    } else if (cur && /action \d+$/.test(x.from)) {
      (cur as unknown as Record<string, string>)[x.name] = x.value;
    }
  }
  const agent = actions.find((a) => a.softwareAgent)?.softwareAgent;
  const source = actions
    .find((a) => a.digitalSourceType)
    ?.digitalSourceType?.split("/")
    .pop();
  const wm = actions.find((a) =>
    /watermark/i.test(a.action + " " + (a.description ?? "")),
  );
  const label = report.anatomy.find((p) => p.part === "label");
  const rows: Row[] = [
    { k: "Signed by", v: get("Signer") ?? "", step: 0 },
    { k: "Certificate issued by", v: cn.replace(/\\,/g, ","), step: 0 },
    {
      k: "Signature",
      v:
        ex.signatureMatches === true
          ? "Matches this file"
          : ex.signatureMatches === false
            ? "Doesn't match this file"
            : "",
      step: 0,
    },
    { k: "Tool", v: agent ?? get("claim_generator_info") ?? "", step: 1 },
    { k: "Says it was", v: source ? `made by AI (${source})` : "", step: 1 },
    {
      k: "Watermark",
      v: wm
        ? wm.description
          ? wm.description.replace(/\.$/, "")
          : wm.action
        : "",
      code: !!wm && !wm.description,
      step: 2,
    },
  ].filter((r) => r.v);
  return {
    ex,
    rows,
    actions,
    offset: label ? label.offset : 0,
    where: label
      ? `C2PA label · <b>${fmt(label.length)} bytes</b> at byte ${fmt(label.offset)}`
      : "C2PA label",
    sentences: report.findings
      .filter((f) => f.group === "ai-label")
      .slice(0, 3)
      .map((f) => f.sentence),
  };
}

const LM: Record<string, Model> = {
  chatgpt: labelModel(examples.files.chatgpt),
  gemini: labelModel(examples.files.gemini),
};
let lmKey = "chatgpt";
let step = 0;
let pin: ScrollTrigger | null = null;
const model = () => LM[lmKey] as Model;

/** The label's first 16 bytes, read from the fixture. */
function hexRow(m: Model): string {
  const bytes = (m.ex.labelHead ?? "").match(/../g) ?? [];
  return `<span class="hd-off">${m.offset.toString(16).padStart(8, "0")}</span><span class="lc-hex-b">${bytes.slice(0, 8).join(" ")}</span><span class="lc-hex-b lc-hex-2">${bytes.slice(8).join(" ")}</span>`;
}

function secs(iso: string) {
  const m = /T(\d\d):(\d\d):(\d\d)(?:\.(\d+))?/.exec(iso);
  if (!m) return null;
  return {
    s:
      +(m[1] ?? 0) * 3600 +
      +(m[2] ?? 0) * 60 +
      +(m[3] ?? 0) +
      (m[4] ? +("0." + m[4]) : 0),
    hms: `${m[1]}:${m[2]}:${m[3]}`,
  };
}

function renderTimeline(m: Model): void {
  const box = $("#lc-time");
  const timed = m.actions
    .map((a) => ({ ...a, t: a.when ? secs(a.when) : null }))
    .filter((a): a is Action & { t: { s: number; hms: string } } => !!a.t);
  if (!timed.length) {
    box.innerHTML = `<ul class="actions-list">${m.actions.map((a) => `<li><span><code>${esc(a.action)}</code>${a.description ? ` · ${esc(a.description)}` : ""}</span></li>`).join("")}</ul><p class="tl-note tl-note-gap">This label lists its steps without times.</p>`;
    return;
  }
  const ts = timed.map((a) => a.t.s);
  const lo = Math.min(...ts);
  const hi = Math.max(...ts);
  const span = Math.max(hi - lo, 0.002);
  const a0 = lo - span * 0.22;
  const a1 = hi + span * 0.22;
  const x = (s: number) => ((s - a0) / (a1 - a0)) * 100;
  const groups = new Map<string, typeof timed>();
  timed.forEach((a) => {
    const k = a.t.s.toFixed(6);
    groups.set(k, [...(groups.get(k) ?? []), a]);
  });
  const hms = timed[0]?.t.hms ?? "";
  const ms = (s: number) => (s - Math.floor(s)).toFixed(3).slice(1);
  let html = `<div class="tl"><span class="tl-axis"></span>`;
  const tickN = 4;
  for (let i = 0; i <= tickN; i++) {
    const s = a0 + ((a1 - a0) * i) / tickN;
    html += `<span class="tl-tick" data-left="${x(s)}"></span><span class="tl-tick-label${i === 0 ? " is-first" : i === tickN ? " is-last" : ""}" data-left="${x(s)}">${i === 0 ? hms : ""}${ms(s)}</span>`;
  }
  for (const [, list] of groups) {
    const s = list[0]?.t.s ?? lo;
    html += `<span class="tl-ev is-up${s === lo && groups.size > 1 ? " is-alt" : ""}${x(s) < 22 ? " is-edge-l" : x(s) > 78 ? " is-edge-r" : ""}" data-left="${x(s)}"><span class="tl-name">${list.map((a) => `<code>${esc(a.action)}</code>`).join("<br>")}</span><span class="tl-dot"></span></span>`;
  }
  const earliest = timed.find((a) => a.t.s === lo);
  const said =
    groups.size > 1 && earliest && /watermark/i.test(earliest.action)
      ? `The watermark step is stamped ${((hi - lo) * 1000).toFixed(1)} ms before the image was created. `
      : "";
  if (groups.size > 1) {
    const gap = (hi - lo) * 1000;
    html += `<span class="tl-gap" data-left="${x(lo)}" data-width="${x(hi) - x(lo)}"></span><span class="tl-gap-label" data-left="${(x(lo) + x(hi)) / 2}">${gap.toFixed(1)} ms</span>`;
  }
  html += `</div><p class="tl-note">${said}Times are UTC, from the label.</p>`;
  box.innerHTML = html;
  applyGeometry(box);
}

function renderLabel(animate: boolean): void {
  const m = model();
  $("#lc-where").innerHTML = m.where;
  const rep = m.ex.report;
  const size = m.ex.size;
  const strip = $("#lc-strip");
  const zoom = zoomRange(rep.anatomy, size);
  buildBar(strip, rep.anatomy, size, zoom, {
    minPct: 0.8,
    focusable: false,
    names: (sg) => (sg.p.part === "label" ? `${fmt(sg.p.length)} bytes` : ""),
  });
  attachCursor(strip);
  $("#lc-hex").innerHTML = hexRow(m);
  $("#lc-strip-cap").textContent = zoom
    ? `The first ${fmt(zoom[1])} bytes of ${m.ex.name}, enlarged; the label is in blue.`
    : `${m.ex.name}, to scale; the label is in blue.`;
  $("#lc-fields").innerHTML = m.rows
    .map(
      (r) =>
        `<dt data-step="${r.step}">${esc(r.k)}</dt><dd data-step="${r.step}">${r.code ? `<code>${esc(r.v)}</code>` : esc(r.v)}</dd>`,
    )
    .join("");
  renderTimeline(m);
  applyStep(animate);
}

function applyStep(animate: boolean): void {
  const m = model();
  $$("#lc-fields [data-step]").forEach((el) => {
    const on = Number(el.dataset["step"]) === step;
    el.classList.toggle("is-dim", !on);
    el.classList.toggle("is-hot", on);
  });
  $("#lc-time").classList.toggle("is-hot", step === 1);
  const sent = $("#lc-sentence");
  const text = m.sentences[step] ?? "";
  if (sent.textContent !== text) {
    if (animate) {
      swap(sent, () => {
        sent.textContent = text;
      });
    } else sent.textContent = text;
  }
  $$(".step").forEach((b) =>
    b.setAttribute("aria-pressed", String(Number(b.dataset["step"]) === step)),
  );
  const mb = document.querySelector(".step-mobile-body");
  const body = $$(".step-body")[step];
  if (mb && body) mb.textContent = body.textContent;
}

const announce = () => {
  $("#lc-live").textContent = model().sentences[step] ?? "";
};

export function initLabels(): void {
  const mb = document.createElement("p");
  mb.className = "step-mobile-body";
  $(".card-col").prepend(mb);
  tabs($("#label-card .tabs"), (t) => {
    lmKey = t.dataset["file"] ?? "chatgpt";
    $("#lc-body").setAttribute("aria-labelledby", t.id);
    swap($("#lc-body"), () => {
      renderLabel(true);
      decode($("#lc-where"), 0.4);
    });
    announce();
  });
  $$(".step").forEach((b) =>
    b.addEventListener("click", () => {
      step = Number(b.dataset["step"]);
      applyStep(true);
      announce();
      if (pin) {
        const y = pin.start + ((step + 0.5) / 3) * (pin.end - pin.start);
        window.scrollTo({ top: y, behavior: motion() ? "smooth" : "auto" });
      }
    }),
  );
  renderLabel(false);
}

/** On wide screens the section pins while scrolling walks the steps. Made
 * first, so every trigger below it is measured after its pin spacing. */
export function labelsPin(navHeight: () => number): void {
  if (!motion()) {
    step = 0;
    applyStep(false);
    return;
  }
  G.matchMedia().add("(min-width: 1024px)", () => {
    const fill = $("#steps-fill");
    const grid = $(".labels-grid");
    pin = ScrollTrigger.create({
      trigger: grid,
      // Pinned in the middle of the screen when it fits, under the nav
      // when it doesn't.
      start: () => {
        const room = window.innerHeight - navHeight() - grid.offsetHeight;
        return `top ${navHeight() + Math.max(32, room / 2)}px`;
      },
      end: "+=110%",
      pin: true,
      anticipatePin: 1,
      onUpdate: (self) => {
        G.set(fill, { scaleY: self.progress });
        const i = Math.min(2, Math.floor(self.progress * 3));
        if (i !== step) {
          step = i;
          applyStep(true);
        }
      },
    });
    return () => {
      pin = null;
    };
  });
}

export function labelsScenes(): void {
  ScrollTrigger.create({
    trigger: "#label-card",
    start: "top 80%",
    once: true,
    onEnter: () => {
      decode($("#lc-where"), 0.5);
      G.from($$("#lc-strip .fill"), {
        scaleX: 0,
        duration: 0.6,
        stagger: 0.08,
        ease: FILL,
      });
      G.from($$("#lc-fields dt, #lc-fields dd"), {
        opacity: 0,
        ...POP,
        stagger: 0.03,
      });
    },
  });
}
