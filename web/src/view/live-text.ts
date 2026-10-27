// A text box read as you type: the reader's and the Hidden-characters
// section's. Each change is read about 220 ms after the last keystroke,
// Ctrl+Enter (⌘+Enter) reads at once, and a paste happens in the box as
// any paste does. A paste's formatted copy (its HTML) goes with the text
// only while the box holds exactly what was pasted: typed or edited text
// has no page behind it.

export interface Pasted {
  plain: string;
  html: string;
}

export interface LiveText {
  /** Reads now what's still waiting for its 220 ms. */
  flush(): void;
}

/** Line ends as a textarea keeps them. */
export const lines = (t: string) => t.replace(/\r\n?/g, "\n");

/** The HTML that goes with `plain`: the paste's, while it's unchanged. */
export const htmlFor = (plain: string, pasted: Pasted | null | undefined) =>
  pasted && lines(plain) === pasted.plain ? pasted.html : undefined;

export function liveText(
  box: HTMLTextAreaElement,
  o: {
    read: (plain: string, html: string | undefined) => void;
    /** The paste the box last had (kept by the caller, across redraws). */
    pasted: () => Pasted | null | undefined;
    setPasted: (p: Pasted | null) => void;
    /** Ctrl+Enter in an empty box. */
    empty?: () => void;
  },
): LiveText {
  let timer = 0;
  const go = () => {
    clearTimeout(timer);
    timer = 0;
    o.read(box.value, htmlFor(box.value, o.pasted()));
  };
  box.addEventListener("paste", (e) => {
    const html = e.clipboardData?.getData("text/html");
    const plain = e.clipboardData?.getData("text/plain");
    o.setPasted(html && plain ? { plain: lines(plain), html } : null);
  });
  box.addEventListener("input", () => {
    clearTimeout(timer);
    timer = window.setTimeout(go, 220);
  });
  box.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (!box.value.trim()) o.empty?.();
    else go();
  });
  return {
    flush: () => {
      if (timer) go();
    },
  };
}
