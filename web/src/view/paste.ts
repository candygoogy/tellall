// Text in: "Paste text" opens a paste box in the reader, and a paste
// anywhere on the page is read at once. The paste reads both text/plain
// and text/html from the clipboard (spec §7.4); the engine finds hidden
// characters in the text and extras (IDs, styling) in the HTML. A page
// never sees the address the browser attaches to a copy (Task 2's paste
// probe), so the view carries the general note instead.
import { $, $$ } from "../dom.ts";
import { read, STALE } from "../engine.ts";
import { TOUCH } from "../motion.ts";
import { MOST, readFiles, nextId } from "./drop.ts";
import {
  bringReaderIntoView,
  current,
  live,
  prune,
  onPasteView,
  renderLiveList,
  show,
  type Item,
} from "./result.ts";

const NOTE =
  "Formatted copies can carry the page's address into apps like Word and OneNote; Copy clean text copies plain text only.";

export async function readText(plain: string, html?: string): Promise<void> {
  bringReaderIntoView();
  const item: Item = {
    id: nextId(),
    live: true,
    kind: "text",
    name: "Pasted text",
    plain,
    state: "reading",
  };
  live.unshift(item);
  prune(MOST);
  renderLiveList();
  show(item, "swap");
  try {
    const res = await read({ kind: "text", plain, ...(html ? { html } : {}) });
    item.report = res.report;
    item.cleaned = res.cleaned;
    item.ms = res.ms;
    item.state = "done";
  } catch (err) {
    item.state = "error";
    const message = (err as Error).message;
    item.error =
      message === STALE ? message : "The engine stopped on it: " + message;
  }
  prune(MOST);
  renderLiveList();
  // Only if the visitor is still looking at it.
  if (current === item) show(item, "swap");
}

function pasteView(view: HTMLElement): void {
  view.innerHTML = `<div class="paste-box">
        <label for="paste-area">${TOUCH ? "Paste or type text here. tellall reads it on this device." : "Paste text here with Ctrl+V or ⌘V, or type it. tellall reads it on this device."}</label>
        <textarea id="paste-area" spellcheck="false"></textarea>
        <div class="hero-actions"><button class="btn btn-primary btn-sm js-read-typed" type="button">Read this text</button></div>
        <p>${NOTE}</p>
      </div>`;
  const ta = $<HTMLTextAreaElement>("#paste-area", view);
  $(".js-read-typed", view).addEventListener("click", () => {
    if (ta.value.trim()) void readText(ta.value);
    else ta.focus();
  });
  setTimeout(() => ta.focus({ preventScroll: true }), 30);
}

export function initPaste(): void {
  onPasteView(pasteView);
  $$(".js-paste").forEach((b) =>
    b.addEventListener("click", () => {
      bringReaderIntoView();
      show(
        {
          id: "paste",
          state: "paste",
          name: "New text",
          live: true,
          kind: "text",
        },
        "swap",
      );
    }),
  );
  document.addEventListener("paste", (e) => {
    const t = e.target as Element | null;
    if (t?.closest?.("#hx-input")) return;
    if (t?.closest?.("textarea, input") && !t.closest("#paste-area")) return;
    const cd = e.clipboardData;
    if (!cd) return;
    const imgs = Array.from(cd.files || []).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (imgs.length) {
      e.preventDefault();
      void readFiles(imgs);
      return;
    }
    const plain = cd.getData("text/plain");
    if (!plain) return;
    e.preventDefault();
    void readText(plain, cd.getData("text/html") || undefined);
  });
}
