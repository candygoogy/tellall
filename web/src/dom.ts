// Small DOM helpers the whole page shares.

export function $<T extends Element = HTMLElement>(
  s: string,
  r: ParentNode = document,
): T {
  const el = r.querySelector<T>(s);
  if (!el) throw new Error(`The page has no ${s}.`);
  return el;
}

export const maybe = <T extends Element = HTMLElement>(
  s: string,
  r: ParentNode = document,
): T | null => r.querySelector<T>(s);

export const $$ = <T extends Element = HTMLElement>(
  s: string,
  r: ParentNode = document,
): T[] => Array.from(r.querySelectorAll<T>(s));

export const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export const esc = (s: unknown) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );

/** "name.clean.ext": the clean copy's name. */
export const cleanName = (name: string) =>
  name.replace(/(\.[^./]+)?$/, (m) => ".clean" + (m || ""));

/** Writes plain text to the clipboard; true when it worked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.className = "sr-only";
    document.body.appendChild(ta);
    ta.select();
    let ok: boolean;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** Saves bytes or a blob as a file, through a link the browser downloads. */
export function download(data: Blob, name: string): void {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** A tab list: arrows, Home and End move between tabs (WAI-ARIA tabs). */
export function tabs(list: Element, onChange: (t: HTMLElement) => void): void {
  const items = $$('[role="tab"]', list);
  const select = (t: HTMLElement, focus: boolean) => {
    items.forEach((x) => {
      const on = x === t;
      x.setAttribute("aria-selected", on ? "true" : "false");
      x.tabIndex = on ? 0 : -1;
    });
    if (focus) t.focus();
    onChange(t);
  };
  items.forEach((t, i) => {
    t.addEventListener("click", () => {
      if (t.getAttribute("aria-selected") !== "true") select(t, false);
    });
    t.addEventListener("keydown", (e) => {
      let j: number | null = null;
      if (e.key === "ArrowRight") j = (i + 1) % items.length;
      if (e.key === "ArrowLeft") j = (i - 1 + items.length) % items.length;
      if (e.key === "Home") j = 0;
      if (e.key === "End") j = items.length - 1;
      const to = j === null ? undefined : items[j];
      if (to) {
        e.preventDefault();
        select(to, true);
      }
    });
  });
}

/** A copy button's icon turns into a tick for a moment. */
export function flashIcon(btn: HTMLElement, ok: boolean): void {
  const use = btn.querySelector("use");
  if (!use) return;
  use.setAttribute("href", ok ? "#i-check" : "#i-copy");
  btn.setAttribute(
    "aria-label",
    ok ? "Copied" : "Copy failed, select the text instead",
  );
  setTimeout(() => {
    use.setAttribute("href", "#i-copy");
    btn.setAttribute("aria-label", "Copy the command");
  }, 1600);
}

/** Base64 to bytes. */
export const b64 = (s: string) =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Sets the widths and lefts a markup string carries as data-w / data-left
 * (percentages): the page's CSP allows no style attributes. */
export function applyGeometry(root: ParentNode): void {
  for (const el of $$("[data-w]", root)) {
    el.style.width = `calc(${el.dataset["w"]}% - 2px)`;
    delete el.dataset["w"];
  }
  for (const el of $$("[data-left]", root)) {
    el.style.left = `${el.dataset["left"]}%`;
    delete el.dataset["left"];
  }
  for (const el of $$("[data-width]", root)) {
    el.style.width = `${el.dataset["width"]}%`;
    delete el.dataset["width"];
  }
}
