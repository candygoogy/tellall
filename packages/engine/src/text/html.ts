// What a formatted (HTML) copy carries besides the words (spec §4 "Text").
// Ported from Docs/tellall/textcheck/xcheck.py html_fragment(). No DOM or
// Node APIs: a few regexes, as there.

export interface CopyExtras {
  /** The `SourceURL:` the browser put in the clipboard header (the chat's link), if any. */
  sourceUrl: string | null;
  /** Element ids that look like response IDs: longer than 12 characters, with a digit. */
  ids: string[];
  /** Distinct CSS class names, sorted. */
  classes: string[];
  /** Elements in the fragment with a non-empty inline `style`. */
  styles: number;
  /** Has `display: none`, `visibility: hidden` or `font-size: 0` styling. */
  hiddenStyled: boolean;
  /** The fragment's text: tags stripped, character references decoded. */
  text: string;
}

/**
 * Accepts a Windows "HTML Format" clipboard blob (a `Version:` header whose
 * StartFragment/EndFragment are UTF-8 byte offsets) or a bare fragment, as a
 * browser paste gives it.
 */
export function scanHtml(html: string): CopyExtras {
  // Header fields only count in a real header, not in a fragment's text.
  const header = html.startsWith("Version:")
    ? html.slice(0, html.indexOf("<"))
    : "";
  const start = /StartFragment:(\d+)/.exec(header);
  const end = /EndFragment:(\d+)/.exec(header);
  const frag =
    start && end ? sliceUtf8(html, Number(start[1]), Number(end[1])) : html;

  const classes = new Set<string>();
  for (const m of frag.matchAll(/class="([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c) classes.add(c);
  }
  const ids = new Set<string>();
  for (const m of frag.matchAll(/\sid="([^"]*)"|\sid='([^']*)'/g)) {
    const id = m[1] ?? m[2];
    if (id.length > 12 && /\d/.test(id)) ids.add(id);
  }
  let styles = 0;
  for (const m of frag.matchAll(
    /<[a-zA-Z][^>]*?\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
  )) {
    if ((m[1] ?? m[2] ?? "").trim()) styles++;
  }
  return {
    sourceUrl: /SourceURL:(\S+)/.exec(header)?.[1] ?? null,
    ids: [...ids],
    classes: [...classes].sort(),
    styles,
    // `font-size: 0` (any unit), but not `0.875rem`.
    hiddenStyled:
      /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0+(?:\.0+)?(?![\d.])/i.test(
        frag,
      ),
    text: unescape(frag.replace(/<[^>]+>/g, "")),
  };
}

/** `raw[from:to].decode("utf-8", "replace")` on the string's UTF-8 bytes. */
function sliceUtf8(s: string, from: number, to: number): string {
  const bytes = new TextEncoder().encode(s);
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(
    bytes.subarray(from, Math.max(from, to)),
  );
}

// --- html.unescape -------------------------------------------------------------
// Python's html.unescape(), with its numeric-reference rules ported in full.
// Named references: JS has no table without the DOM, so this one covers the
// markup basics, common typography, and every invisible character and space
// the hidden-character scan looks for. Unknown names stay as written.

const NAMED: Record<string, string> = {
  "amp;": "&",
  "lt;": "<",
  "gt;": ">",
  "quot;": '"',
  "apos;": "'",
  "AMP;": "&",
  "LT;": "<",
  "GT;": ">",
  "QUOT;": '"',
  "nbsp;": " ",
  "NonBreakingSpace;": " ",
  "shy;": "­",
  "copy;": "©",
  "COPY;": "©",
  "reg;": "®",
  "REG;": "®",
  "trade;": "™",
  "deg;": "°",
  "middot;": "·",
  "times;": "×",
  "divide;": "÷",
  "laquo;": "«",
  "raquo;": "»",
  "sect;": "§",
  "para;": "¶",
  "pound;": "£",
  "euro;": "€",
  "cent;": "¢",
  "yen;": "¥",
  "hellip;": "…",
  "mldr;": "…",
  "ndash;": "–",
  "mdash;": "—",
  "hyphen;": "‐",
  "dash;": "‐",
  "minus;": "−",
  "lsquo;": "‘",
  "rsquo;": "’",
  "sbquo;": "‚",
  "ldquo;": "“",
  "rdquo;": "”",
  "bdquo;": "„",
  "lsaquo;": "‹",
  "rsaquo;": "›",
  "bull;": "•",
  "prime;": "′",
  "Prime;": "″",
  "dagger;": "†",
  "Dagger;": "‡",
  "permil;": "‰",
  "larr;": "←",
  "rarr;": "→",
  "uarr;": "↑",
  "darr;": "↓",
  "harr;": "↔",
  "Tab;": "\t",
  "NewLine;": "\n",
  "ensp;": " ",
  "emsp;": " ",
  "emsp13;": " ",
  "emsp14;": " ",
  "numsp;": " ",
  "puncsp;": " ",
  "thinsp;": " ",
  "ThinSpace;": " ",
  "hairsp;": " ",
  "VeryThinSpace;": " ",
  "MediumSpace;": " ",
  "ThickSpace;": "  ",
  "ZeroWidthSpace;": "​",
  "NegativeVeryThinSpace;": "​",
  "NegativeThinSpace;": "​",
  "NegativeMediumSpace;": "​",
  "NegativeThickSpace;": "​",
  "zwnj;": "‌",
  "zwj;": "‍",
  "lrm;": "‎",
  "rlm;": "‏",
  "NoBreak;": "⁠",
  "af;": "⁡",
  "ApplyFunction;": "⁡",
  "it;": "⁢",
  "InvisibleTimes;": "⁢",
  "ic;": "⁣",
  "InvisibleComma;": "⁣",
  // HTML's legacy names that also work without the semicolon.
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  AMP: "&",
  LT: "<",
  GT: ">",
  QUOT: '"',
  nbsp: " ",
  shy: "­",
  copy: "©",
  COPY: "©",
  reg: "®",
  REG: "®",
  deg: "°",
  middot: "·",
  times: "×",
  divide: "÷",
  laquo: "«",
  raquo: "»",
  sect: "§",
  para: "¶",
  pound: "£",
  cent: "¢",
  yen: "¥",
};

// html._invalid_charrefs
const INVALID_CHARREFS: Record<number, string> = {
  0x00: "�",
  0x0d: "\r",
  0x80: "€",
  0x81: "\x81",
  0x82: "‚",
  0x83: "ƒ",
  0x84: "„",
  0x85: "…",
  0x86: "†",
  0x87: "‡",
  0x88: "ˆ",
  0x89: "‰",
  0x8a: "Š",
  0x8b: "‹",
  0x8c: "Œ",
  0x8d: "\x8d",
  0x8e: "Ž",
  0x8f: "\x8f",
  0x90: "\x90",
  0x91: "‘",
  0x92: "’",
  0x93: "“",
  0x94: "”",
  0x95: "•",
  0x96: "–",
  0x97: "—",
  0x98: "˜",
  0x99: "™",
  0x9a: "š",
  0x9b: "›",
  0x9c: "œ",
  0x9d: "\x9d",
  0x9e: "ž",
  0x9f: "Ÿ",
};

// html._invalid_codepoints: references to these decode to nothing.
const isInvalidCodePoint = (n: number) =>
  (n >= 0x1 && n <= 0x8) ||
  n === 0xb ||
  (n >= 0xe && n <= 0x1f) ||
  (n >= 0x7f && n <= 0x9f) ||
  (n >= 0xfdd0 && n <= 0xfdef) ||
  (n & 0xfffe) === 0xfffe;

function unescape(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(
    /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/g,
    (_, ref: string) => {
      if (ref[0] === "#") {
        const hex = ref[1] === "x" || ref[1] === "X";
        const num = Number.parseInt(
          ref.slice(hex ? 2 : 1).replace(/;$/, ""),
          hex ? 16 : 10,
        );
        if (num in INVALID_CHARREFS) return INVALID_CHARREFS[num];
        if ((num >= 0xd800 && num <= 0xdfff) || num > 0x10ffff) return "�";
        if (isInvalidCodePoint(num)) return "";
        return String.fromCodePoint(num);
      }
      if (Object.hasOwn(NAMED, ref)) return NAMED[ref];
      // The longest known name at the start, as the standard says.
      for (let x = ref.length - 1; x > 1; x--) {
        const name = ref.slice(0, x);
        if (Object.hasOwn(NAMED, name)) return NAMED[name] + ref.slice(x);
      }
      return "&" + ref;
    },
  );
}
