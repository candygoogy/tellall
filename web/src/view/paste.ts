// Text in. "Paste text" (and "New text" under a text) opens an empty text
// in the reader; a paste anywhere else on the page is read at once as a
// new text. Each of the visitor's texts is an editable box, read again as
// it changes (live-text.ts, as the Hidden-characters section's box is),
// with its hidden characters marked under it and the engine's sentences.
// A paste brings both text/plain and text/html (spec §7.4): the engine
// finds hidden characters in the text and extras (IDs, styling, the page's
// address) in the HTML, which goes with the text only while the text is
// still exactly what was pasted. A dropped or chosen text file comes in
// here too, as a paste with no HTML.
import { $, $$, maybe } from "../dom.ts";
import { read, STALE } from "../engine.ts";
import { announce } from "../feedback.ts";
import { TOUCH } from "../motion.ts";
import { MOST, nextId, onTextFile, readDropped } from "./drop.ts";
import { liveText, lines } from "./live-text.ts";
import { textName } from "./reader-html.ts";
import {
  bringReaderIntoView,
  current,
  drawTextReport,
  finishReading,
  forget,
  live,
  onLeave,
  onTextView,
  prune,
  renderLiveList,
  revealCurrent,
  setCrumbs,
  setStatus,
  show,
  statusFor,
  textActionsHTML,
  textNoteHTML,
  wireCopyClean,
  type Item,
} from "./result.ts";

/** The keys a paste is on this computer. */
const APPLE = /Mac|iPhone|iPad|iPod/.test(
  navigator.platform || navigator.userAgent,
);
const PASTE_KEY = APPLE ? "⌘V" : "Ctrl+V";

const DRAFT_LABEL = TOUCH
  ? "Paste or type text here. tellall reads it on this device as you type."
  : `Paste text here with ${PASTE_KEY}, or type it. tellall reads it on this device as you type.`;
const EDIT_LABEL = "Edit the text and tellall reads it again.";

/** The empty text "Paste text" opens: in no list until it has words. */
let draft: Item | null = null;

/** Opens an empty text in the reader, its box focused. */
export function startText(): void {
  bringReaderIntoView();
  draft ??= {
    id: nextId(),
    live: true,
    kind: "text",
    name: "New text",
    plain: "",
    state: "paste",
  };
  show(draft, "swap");
}

/** Reads a text, or reads it again after an edit. A text keeps its row;
 * its name follows its words. Answers to all but the latest reading are
 * dropped. */
async function readItem(
  item: Item,
  plain: string,
  html: string | undefined,
): Promise<void> {
  const mine = (item.asked = (item.asked ?? 0) + 1);
  item.plain = plain;
  delete item.error;
  if (!plain) {
    // Emptied: the text waits for words again, in its place in the list.
    item.state = "paste";
    delete item.report;
    delete item.cleaned;
    Object.assign(item, textName(""));
    renderLiveList();
    if (current === item) refresh(item);
    return;
  }
  if (item === draft) {
    draft = null;
    live.unshift(item);
    prune(MOST);
  }
  const first = !item.report;
  if (first) item.state = "reading";
  // The name from the words at once; where the copy came from, while the
  // HTML still goes with them.
  Object.assign(item, textName(plain, html ? item.report : undefined));
  renderLiveList();
  if (current === item) {
    refresh(item);
    setStatus("Reading…", true);
    revealCurrent();
  }
  try {
    const res = await read({ kind: "text", plain, ...(html ? { html } : {}) });
    if (mine !== item.asked) return;
    item.report = res.report;
    item.cleaned = res.cleaned;
    item.ms = res.ms;
    item.state = "done";
    Object.assign(item, textName(plain, res.report));
  } catch (err) {
    if (mine !== item.asked) return;
    const message = (err as Error).message;
    item.error =
      message === STALE ? message : "The engine stopped on it: " + message;
    if (!item.report) item.state = "error";
  }
  prune(MOST);
  renderLiveList();
  if (current !== item) return;
  // A paste from elsewhere on the page arrives as any reading does; an
  // edit in the box changes the result in place, without moving a thing.
  if (first && item.focusOnRead && item.state === "done") show(item, "swap");
  else refresh(item);
}

/** A paste from anywhere on the page but a text box: a new text. */
export function readText(plain: string, html?: string): void {
  bringReaderIntoView();
  const item: Item = {
    id: nextId(),
    live: true,
    kind: "text",
    ...textName(plain),
    plain,
    state: "reading",
    pasted: html ? { plain: lines(plain), html } : null,
    focusOnRead: true,
  };
  live.unshift(item);
  prune(MOST);
  renderLiveList();
  show(item, "swap");
  void readItem(item, plain, html);
}

/** A text in the reader: the engine's headline, the box with its words,
 * the words with their hidden characters marked, the sentences. */
function textView(v: HTMLElement, item: Item): void {
  v.innerHTML = `
      <div class="rv-text-body is-edit">
        <h2 class="rv-headline" tabindex="-1"></h2>
        <p class="rv-status js-reading" hidden></p>
        <div class="tx-field">
          <label class="tx-label" for="paste-area"></label>
          <textarea id="paste-area" class="tx-input" spellcheck="false"></textarea>
        </div>
        <div class="tx-wrap">
          <div class="tx" tabindex="0" role="region"></div>
          <div class="pmap" aria-hidden="true"></div>
        </div>
        <div class="rv-report rv-report-text"><ul class="rv-findings"></ul></div>
      </div>
      ${textActionsHTML(item.report)}`;
  const box = $<HTMLTextAreaElement>("#paste-area", v);
  box.value = item.plain ?? "";
  wireCopyClean(v, item);
  const status = $(".js-copy-status", v);
  const box$ = liveText(box, {
    pasted: () => item.pasted,
    setPasted: (p) => (item.pasted = p),
    empty: () => (status.textContent = "Paste or type some text first."),
    read: (plain, html) => {
      status.textContent = "";
      void readItem(item, plain, html);
    },
  });
  // Leaving reads what's still waiting, so nothing typed is lost. A text
  // left empty leaves the list with it; while it's on screen it keeps its
  // row, as its words may be on their way back.
  onLeave((next) => {
    box$.flush();
    if (next === item || item.plain?.trim()) return;
    item.asked = (item.asked ?? 0) + 1; // a reading still out is dropped
    forget(item);
  });
  refresh(item, true);
  if (item.state === "paste")
    requestAnimationFrame(() => box.focus({ preventScroll: true }));
}

/** The text view, brought up to date with its item, in place: the box and
 * the focus stay as they are. */
function refresh(item: Item, fresh = false): void {
  const v = $("#r-view");
  const body = maybe(".rv-text-body.is-edit", v);
  if (!body) return;
  const r = item.state === "paste" ? undefined : item.report;
  body.classList.toggle("is-draft", item.state === "paste");
  $(".tx-label", v).textContent =
    item.state === "paste" ? DRAFT_LABEL : EDIT_LABEL;
  const note = $(".js-reading", v);
  note.textContent =
    item.state === "reading"
      ? "Reading the text on this device…"
      : (item.error ?? "");
  note.classList.toggle("rv-err", !!item.error);
  note.hidden = !note.textContent;
  const head = $(".rv-headline", v);
  head.hidden = !r;
  for (const el of $$(
    ".tx-wrap, .rv-report-text, .js-copy-clean, .js-new-text",
    v,
  ))
    el.hidden = !r;
  $(".js-text-note", v).innerHTML = textNoteHTML(r);
  if (r) {
    if (head.textContent !== r.headline) {
      // A headline still being uncovered settles first, then changes.
      if (!fresh) finishReading();
      head.textContent = r.headline;
      if (!fresh) announce(r.headline);
    }
    drawTextReport(body, item);
    $(".tx", v).setAttribute(
      "aria-label",
      `${item.name}, with hidden characters marked`,
    );
  }
  setCrumbs(item);
  if (!fresh) setStatus(statusFor(item), item.state === "reading");
}

export function initPaste(): void {
  onTextView(textView);
  onTextFile((plain) => readText(plain));
  $$(".js-paste-key").forEach((el) => (el.textContent = PASTE_KEY));
  $$(".js-paste").forEach((b) => b.addEventListener("click", startText));
  // "New text", under each text in the reader.
  document.addEventListener("click", (e) => {
    if ((e.target as Element | null)?.closest?.(".view .js-new-text"))
      startText();
  });
  document.addEventListener("paste", (e) => {
    // A text box takes its own paste: the reader's and the section's are
    // read as they change.
    const t = e.target as Element | null;
    if (t?.closest?.('textarea, input, [contenteditable="true"]')) return;
    const cd = e.clipboardData;
    if (!cd) return;
    // Files copied from a folder: pictures, and text files read as text.
    const files = Array.from(cd.files || []).filter((f) =>
      /^(image\/|text\/(plain|markdown)$)/.test(f.type),
    );
    if (files.length) {
      e.preventDefault();
      void readDropped(files);
      return;
    }
    const plain = cd.getData("text/plain");
    if (!plain) return;
    e.preventDefault();
    readText(plain, cd.getData("text/html") || undefined);
  });
}
