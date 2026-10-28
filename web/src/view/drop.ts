// Images in: the "Choose images" buttons, a drop anywhere on the page, or
// images pasted. Each file gets its own row in "Your files" and is read
// in the engine's worker, one after another; up to 200 at once (the rest
// are left out, and the sidebar says so). An empty file gets a row that
// says it couldn't be read. Several clean copies download together as
// one zip, and a batch ends with one line said to a screen reader. A text
// file (.txt, .md) is read as a paste is, unless its bytes are a picture.
import { $, $$, cleanName, download, fmt, maybe } from "../dom.ts";
import { read, STALE } from "../engine.ts";
import { announce, flash, saved } from "../feedback.ts";
import { zip } from "../zip.ts";
import { dotFor } from "./reader-html.ts";
import {
  bringReaderIntoView,
  current,
  free,
  gone,
  live,
  prune,
  renderLiveList,
  show,
  type Item,
} from "./result.ts";

/** The most files read at once, and kept: past it, the oldest finished
 * ones go (their copies and pictures freed). */
export const MOST = 200;
let liveSeq = 0;
export const nextId = () => "l" + ++liveSeq;

/** The picture's longest side in the reader, in pixels. */
const THUMB = 480;

/** A small copy of the picture for the sidebar and the reader, so no
 * full-size decode stays behind a 28 px thumbnail. Undefined when the
 * browser can't draw it (a HEIC, a damaged file). */
async function thumbnail(file: File): Promise<string | undefined> {
  let full: ImageBitmap | undefined;
  try {
    full = await createImageBitmap(file);
    const k = Math.min(1, THUMB / Math.max(full.width, full.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(full.width * k));
    canvas.height = Math.max(1, Math.round(full.height * k));
    canvas.getContext("2d")?.drawImage(full, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) =>
      canvas.toBlob(ok, "image/webp", 0.85),
    );
    canvas.width = canvas.height = 0;
    return blob ? URL.createObjectURL(blob) : undefined;
  } catch {
    return undefined;
  } finally {
    full?.close();
  }
}

const HEIC = /\.(heic|heif)$/i;

/** What an empty file's result says under "tellall couldn't read this file." */
const EMPTY = "The file is empty: it has no bytes to read.";

/** The largest text file read as text: a few hundred pages, read in well
 * under a second. Larger ones get a row that says so. */
const TEXT_MOST = 2 * 1024 * 1024;
const TOO_BIG =
  "This text file is larger than 2 MB, more than tellall reads at once. Paste the part you want to check.";
/** Files that get a row with a sentence instead of a reading. */
const refused = new WeakMap<File, string>();

/** Said once a batch of several is read: "Read 60 files: 10 with AI
 * labels, 3 couldn't be read." The counts follow the sidebar's dots. */
function batchLine(items: Item[], left: number): string {
  const count = (cls: string) =>
    items.filter((x) => dotFor(x)[0] === cls).length;
  const n = (k: number, one: string, many: string) =>
    `${fmt(k)} ${k === 1 ? one : many}`;
  const label = count("dot-label");
  const about = count("dot-private");
  const error = count("dot-error");
  const said = [
    label ? n(label, "with an AI label", "with AI labels") : "",
    about ? n(about, "with personal data", "with personal data") : "",
    error ? `${fmt(error)} couldn't be read` : "",
  ].filter(Boolean);
  const head = `Read ${left ? "the first " : ""}${fmt(items.length)} files`;
  const tail = left ? `; ${fmt(left)} left out.` : ".";
  return `${head}: ${said.length ? said.join(", ") : "no marks found"}${tail}`;
}

/** Named or typed as text, and not empty. */
const TEXTISH = /\.(txt|md|markdown)$/i;
const textish = (f: File) =>
  f.size > 0 &&
  (TEXTISH.test(f.name) || /^text\/(plain|markdown)$/.test(f.type));

/** The first bytes of the pictures tellall reads (and a GIF's, which it
 * says it can't), as the engine's detect() knows them: a file named .txt
 * with these is a picture. */
function looksLikeImage(b: Uint8Array): boolean {
  const at = (o: number, s: string) =>
    [...s].every((c, i) => b[o + i] === c.charCodeAt(0));
  return (
    (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
    (b[0] === 0x89 && at(1, "PNG")) ||
    (at(0, "RIFF") && at(8, "WEBP")) ||
    at(4, "ftyp") ||
    at(0, "GIF8")
  );
}

/** A text file's words, or null when its bytes aren't text (a picture, or
 * anything with a NUL byte in it). */
async function textOf(f: File): Promise<string | null> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (looksLikeImage(bytes)) return null;
  // UTF-16, by its byte order mark; otherwise UTF-8, and no NUL bytes.
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be").decode(bytes);
  if (bytes.includes(0)) return null;
  return new TextDecoder().decode(bytes);
}

/** Reads a text as a paste is (paste.ts). */
let readAsText: ((plain: string) => void) | null = null;
export const onTextFile = (fn: (plain: string) => void) => {
  readAsText = fn;
};

/** Files from a drop, a pick or a paste: text files are read as text,
 * everything else as a file. */
export async function readDropped(files: FileList | File[]): Promise<void> {
  const rest: File[] = [];
  const texts: string[] = [];
  for (const f of Array.from(files)) {
    if (textish(f) && f.size > TEXT_MOST) {
      refused.set(f, TOO_BIG);
      rest.push(f);
      continue;
    }
    const plain = textish(f) && readAsText ? await textOf(f) : null;
    if (plain === null) rest.push(f);
    else texts.push(plain);
  }
  // Texts first, so a batch's pictures lead the list and the first shows.
  for (const plain of texts) readAsText?.(plain);
  await readFiles(rest);
}

export async function readFiles(files: FileList | File[]): Promise<void> {
  const all = Array.from(files);
  const list = all.slice(0, MOST);
  const left = all.length - list.length;
  if (!list.length) return;
  bringReaderIntoView();
  // Past the most at once: the first are read, and the sidebar says how
  // many were left out.
  const note = $("#side-live-note");
  note.textContent = left
    ? `Read the first ${fmt(MOST)} files; ${fmt(left)} left out.`
    : "";
  note.hidden = !left;
  const items: Item[] = list.map((f) =>
    f.size > 0 && !refused.has(f)
      ? {
          id: nextId(),
          live: true,
          kind: "file",
          name: f.name,
          size: f.size,
          file: f,
          state: "reading",
        }
      : {
          id: nextId(),
          live: true,
          kind: "file",
          name: f.name,
          size: f.size,
          state: "error",
          error: refused.get(f) ?? EMPTY,
        },
  );
  // Newest batch first, each in the order it was chosen.
  live.unshift(...items);
  prune(MOST);
  renderLiveList();
  const first = items[0];
  if (first) {
    first.focusOnRead = true;
    if (first.file) first.thumbUrl = await thumbnail(first.file);
    show(first, "swap");
  }
  for (const item of items) {
    const file = item.file;
    // Removed from the list (or cleared, past Undo) before its turn.
    if (!file || gone.has(item)) continue;
    try {
      if (item !== first) item.thumbUrl = await thumbnail(file);
      renderLiveList();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const res = await read({ kind: "file", name: item.name, bytes }, [
        bytes.buffer,
      ]);
      item.report = res.report;
      item.hint = res.hint;
      item.command = res.command;
      item.ms = res.ms;
      item.state = "done";
      const out = res.cleaned.output;
      // One Blob per clean copy: the download link and the zip share it,
      // and the bytes themselves aren't kept.
      if (res.cleaned.cleaned && out instanceof Uint8Array) {
        item.cleanBlob = new Blob([out as Uint8Array<ArrayBuffer>], {
          type: file.type || "application/octet-stream",
        });
        item.cleanUrl = URL.createObjectURL(item.cleanBlob);
      }
      item.cleaned = { ...res.cleaned, output: new Uint8Array(0) };
    } catch (err) {
      item.state = "error";
      const message = (err as Error).message;
      item.error =
        message === STALE ? message : "The engine stopped on it: " + message;
    }
    // A HEIC keeps its file, for the browser's own decoder to draw.
    if (!HEIC.test(item.name)) delete item.file;
    // Removed while it was read: what the reading made goes too.
    if (gone.has(item)) {
      free(item);
      continue;
    }
    prune(MOST);
    renderLiveList();
    if (current === item) show(item, "swap");
  }
  // One file: its headline takes the focus (result.ts landed). Several:
  // one line for the whole batch, never one per file.
  // Those taken out of the list meanwhile aren't counted.
  const kept = items.filter((x) => !gone.has(x));
  if (kept.length > 1) announce(batchLine(kept, left));
}

export function initDrop(): void {
  const input = $<HTMLInputElement>("#file-input");
  $$(".js-choose").forEach((b) =>
    b.addEventListener("click", () => input.click()),
  );
  // Buttons drawn later inside the reader (the error view's).
  document.addEventListener("click", (e) => {
    const t = e.target as Element | null;
    if (t?.closest?.(".view .js-choose")) input.click();
  });
  input.addEventListener("change", () => {
    if (input.files) void readDropped(Array.from(input.files));
    input.value = "";
  });

  // A drop anywhere on the page.
  const drop = $("#drop");
  const mini = maybe("#mini-drop");
  if (mini) {
    // The closing section's drop box opens the picker too (a pointer's
    // shortcut: its Choose images button is beside it for the keyboard).
    mini.addEventListener("click", () => input.click());
    mini.addEventListener("dragenter", () => mini.classList.add("is-over"));
    mini.addEventListener("dragleave", (e) => {
      if (!mini.contains(e.relatedTarget as Node | null))
        mini.classList.remove("is-over");
    });
    addEventListener("drop", () => mini.classList.remove("is-over"));
  }
  let depth = 0;
  const hasFiles = (e: DragEvent) =>
    !!e.dataTransfer &&
    Array.from(e.dataTransfer.types || []).includes("Files");
  addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    drop.hidden = !!(e.target as Element | null)?.closest?.("#mini-drop");
  });
  addEventListener("dragover", (e) => {
    if (!hasFiles(e) || !e.dataTransfer) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) drop.hidden = true;
  });
  addEventListener("drop", (e) => {
    if (!hasFiles(e) || !e.dataTransfer) return;
    e.preventDefault();
    depth = 0;
    drop.hidden = true;
    void readDropped(e.dataTransfer.files);
  });

  // Every clean copy, as one zip; the line under it says what's in it
  // and which files aren't.
  const all = $<HTMLButtonElement>("#dl-all");
  const line = $("#dl-all-note");
  all.addEventListener("click", async () => {
    all.disabled = true;
    try {
      const files = live.filter((x) => x.kind === "file");
      const inZip = files.filter((x) => x.state === "done" && x.cleanBlob);
      const entries = inZip.map((x) => ({
        name: cleanName(x.name),
        blob: x.cleanBlob as Blob,
      }));
      download(await zip(entries), "tellall-clean.zip");
      saved(
        all,
        zipLine(
          entries.length,
          files.filter((x) => !inZip.includes(x)),
        ),
        line,
      );
    } catch {
      flash(all, false, "Couldn't make the zip");
      line.textContent =
        "Couldn't make the zip. Download the clean copies one by one instead.";
      line.hidden = false;
      announce(line.textContent);
    } finally {
      all.disabled = false;
    }
  });
}

/** "Saved tellall-clean.zip: 9 clean copies. Left out, with no clean
 * copy: anim.gif." Up to three names each, then how many more. */
function zipLine(n: number, out: Item[]): string {
  const names = (xs: Item[]) => {
    const said = xs.slice(0, 3).map((x) => x.name);
    if (xs.length > 3) said.push(`${fmt(xs.length - 3)} more`);
    return said.join(", ");
  };
  const reading = out.filter((x) => x.state === "reading");
  const none = out.filter((x) => x.state !== "reading");
  return [
    `Saved tellall-clean.zip: ${fmt(n)} clean ${n === 1 ? "copy" : "copies"}.`,
    none.length ? `Left out, with no clean copy: ${names(none)}.` : "",
    reading.length ? `Still being read: ${names(reading)}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
