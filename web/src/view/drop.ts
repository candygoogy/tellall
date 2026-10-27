// Images in: the "Choose images" buttons, a drop anywhere on the page, or
// images pasted. Each file gets its own row in "Your files" and is read
// in the engine's worker, one after another; up to 200 at once. Several
// clean copies download together as one zip.
import { $, $$, cleanName, download, fmt, maybe } from "../dom.ts";
import { read, STALE } from "../engine.ts";
import { announce, flash, saved } from "../feedback.ts";
import { zip } from "../zip.ts";
import {
  bringReaderIntoView,
  current,
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

export async function readFiles(files: FileList | File[]): Promise<void> {
  const list = Array.from(files)
    .filter((f) => f.size > 0)
    .slice(0, MOST);
  if (!list.length) return;
  bringReaderIntoView();
  const items: Item[] = list.map((f) => ({
    id: nextId(),
    live: true,
    kind: "file",
    name: f.name,
    size: f.size,
    file: f,
    state: "reading",
  }));
  // Newest batch first, each in the order it was chosen.
  live.unshift(...items);
  prune(MOST);
  renderLiveList();
  const first = items[0];
  if (first) {
    first.focusOnRead = true;
    first.thumbUrl = await thumbnail(first.file as File);
    show(first, "swap");
  }
  for (const item of items) {
    const file = item.file as File;
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
    prune(MOST);
    renderLiveList();
    if (current === item) show(item, "swap");
  }
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
    if (input.files) void readFiles(input.files);
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
    void readFiles(e.dataTransfer.files);
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
