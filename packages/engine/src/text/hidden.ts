// Hidden characters in pasted text (spec §4 "Text"). The rules, and the
// notes' wording, are ported from Docs/tellall/textcheck/xcheck.py
// (classify, decode_runs). No DOM or Node APIs.

export type CharKind = "hidden" | "space" | "harmless";

export interface CharHit {
  /** UTF-16 offset into the text, so `plain.codePointAt(index) === codePoint`. */
  index: number;
  codePoint: number;
  /** Unicode character name, or `U+XXXX` when it has none here. */
  name: string;
  kind: CharKind;
  note: string;
}

export interface DecodedRun {
  how: "tags" | "variation-selectors";
  decoded: string;
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => from + i);

const BIDI = new Set([
  ...range(0x202a, 0x202f),
  ...range(0x2066, 0x206a),
  0x200e,
  0x200f,
  0x061c,
]);
const ODD_INVISIBLE = new Set([
  0x200b, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x00ad, 0x180e, 0x3164,
  0x115f, 0x1160, 0x2800, 0xffa0, 0x034f,
]);
const SPACES = new Set([
  0x00a0,
  0x202f,
  0x205f,
  0x3000,
  ...range(0x2000, 0x200b),
]);

const isTag = (cp: number) => cp >= 0xe0000 && cp <= 0xe007f;

function vsValue(cp: number): number | null {
  if (cp >= 0xfe00 && cp <= 0xfe0f) return cp - 0xfe00;
  if (cp >= 0xe0100 && cp <= 0xe01ef) return cp - 0xe0100 + 16;
  return null;
}

const isEmoji = (cp: number) =>
  cp >= 0x1f000 ||
  (cp >= 0x2600 && cp <= 0x27bf) ||
  (cp >= 0x2190 && cp <= 0x21ff) ||
  (cp >= 0x2b00 && cp <= 0x2bff);

// Scripts where ZWNJ/ZWJ are part of normal spelling: Arabic, Persian, Indic, Sinhala, etc.
const joinsScript = (cp: number) =>
  (cp >= 0x0600 && cp <= 0x08ff) ||
  (cp >= 0x0900 && cp <= 0x0dff) ||
  (cp >= 0xfb50 && cp <= 0xfeff);

// Python's unicodedata.category(ch) in ("Cf", "Cc", "Co", "Cn"), tried at one position.
const INVISIBLE_CATEGORY = /(\p{Cf})|(\p{Cc})|(\p{Co})|(\p{Cn})/uy;
const CATEGORIES = ["Cf", "Cc", "Co", "Cn"];

/** xcheck.py classify(); `prev`/`next` are -1 at the ends. Null: nothing to report. */
function classify(
  text: string,
  index: number,
  cp: number,
  prev: number,
  next: number,
): [CharKind, string] | null {
  if (isTag(cp))
    return ["hidden", "Unicode tag character (can spell out invisible ASCII)"];
  if (vsValue(cp) !== null) {
    if (cp === 0xfe0f && prev >= 0 && isEmoji(prev))
      return ["harmless", "emoji presentation selector after an emoji"];
    if (cp === 0xfe0e && prev >= 0)
      return ["harmless", "text presentation selector"];
    return [
      "hidden",
      "variation selector not attached to an emoji (can carry hidden bytes)",
    ];
  }
  if (cp === 0x200d) {
    if ((prev >= 0 && isEmoji(prev)) || (next >= 0 && isEmoji(next)))
      return ["harmless", "zero-width joiner inside an emoji"];
    if ((prev >= 0 && joinsScript(prev)) || (next >= 0 && joinsScript(next)))
      return ["harmless", "zero-width joiner in a script that uses it"];
    return ["hidden", "zero-width joiner between ordinary letters"];
  }
  if (cp === 0x200c) {
    if ((prev >= 0 && joinsScript(prev)) || (next >= 0 && joinsScript(next)))
      return ["harmless", "zero-width non-joiner in a script that uses it"];
    return ["hidden", "zero-width non-joiner between ordinary letters"];
  }
  if (cp === 0xfeff)
    return index === 0
      ? ["harmless", "byte-order mark at the start"]
      : ["hidden", "byte-order mark in the middle of text"];
  if (BIDI.has(cp)) return ["hidden", "direction control (bidi)"];
  if (ODD_INVISIBLE.has(cp)) return ["hidden", "invisible character"];
  if (SPACES.has(cp)) return ["space", "non-standard space"];
  INVISIBLE_CATEGORY.lastIndex = index;
  const m = INVISIBLE_CATEGORY.exec(text);
  if (m)
    return [
      "hidden",
      `invisible ${CATEGORIES[m.slice(1).findIndex(Boolean)]} character`,
    ];
  return null; // xcheck.py's "visible": an ordinary non-ASCII character
}

/** Every hidden, unusual-space and usually-harmless character, in order. */
export function scanText(plain: string): CharHit[] {
  const hits: CharHit[] = [];
  let prev = -1;
  for (let i = 0; i < plain.length;) {
    const cp = plain.codePointAt(i) ?? 0; // i < length, so never undefined
    const size = cp > 0xffff ? 2 : 1;
    // Printable ASCII, newline, carriage return and tab are never reported.
    if (!(
      (cp >= 0x20 && cp <= 0x7e) ||
      cp === 0x0a ||
      cp === 0x0d ||
      cp === 0x09
    )) {
      const next = plain.codePointAt(i + size) ?? -1;
      const res = classify(plain, i, cp, prev, next);
      if (res)
        hits.push({
          index: i,
          codePoint: cp,
          name: charName(cp),
          kind: res[0],
          note: res[1],
        });
    }
    prev = cp;
    i += size;
  }
  return hits;
}

/** Runs of 2+ tag characters (decoded to ASCII) and variation selectors (decoded as UTF-8 bytes). */
export function decodeRuns(plain: string): DecodedRun[] {
  const out: DecodedRun[] = [];
  for (const m of plain.matchAll(/[\u{E0000}-\u{E007F}]{2,}/gu)) {
    const decoded = [...m[0]]
      .map((c) => String.fromCodePoint((c.codePointAt(0) ?? 0) - 0xe0000))
      .join("");
    out.push({ how: "tags", decoded });
  }
  // Bad bytes become U+FFFD as with Python's "replace"; a leading BOM is kept, as Python does.
  const utf8 = new TextDecoder("utf-8", { ignoreBOM: true });
  for (const m of plain.matchAll(/[︀-️\u{E0100}-\u{E01EF}]{2,}/gu)) {
    const bytes = Uint8Array.from(
      [...m[0]],
      (c) => vsValue(c.codePointAt(0) ?? 0) ?? 0,
    );
    out.push({ how: "variation-selectors", decoded: utf8.decode(bytes) });
  }
  return out;
}

/** The text without its "hidden" characters; harmless ones and unusual spaces stay. */
export function cleanText(plain: string): string {
  let out = "";
  let from = 0;
  for (const h of scanText(plain)) {
    if (h.kind !== "hidden") continue;
    out += plain.slice(from, h.index);
    from = h.index + (h.codePoint > 0xffff ? 2 : 1);
  }
  return out + plain.slice(from);
}

// --- names -------------------------------------------------------------------
// JS has no character names. This table is Python's unicodedata.name()
// (Unicode 16) for every character classify() reports by itself: the sets
// above, the harmless joiners and selectors, and every Cf character except
// tags and variation selectors, which are named by rule in charName(). Cc, Co
// and Cn characters have no names in Python either; both fall back to U+XXXX.

const NAME_TABLE =
  "00A0 NO-BREAK SPACE|00AD SOFT HYPHEN|034F COMBINING GRAPHEME JOINER|" +
  "0600 ARABIC NUMBER SIGN|0601 ARABIC SIGN SANAH|0602 ARABIC FOOTNOTE MARKER|" +
  "0603 ARABIC SIGN SAFHA|0604 ARABIC SIGN SAMVAT|0605 ARABIC NUMBER MARK ABOVE|" +
  "061C ARABIC LETTER MARK|06DD ARABIC END OF AYAH|070F SYRIAC ABBREVIATION MARK|" +
  "0890 ARABIC POUND MARK ABOVE|0891 ARABIC PIASTRE MARK ABOVE|" +
  "08E2 ARABIC DISPUTED END OF AYAH|115F HANGUL CHOSEONG FILLER|" +
  "1160 HANGUL JUNGSEONG FILLER|180E MONGOLIAN VOWEL SEPARATOR|2000 EN QUAD|2001 EM QUAD|" +
  "2002 EN SPACE|2003 EM SPACE|2004 THREE-PER-EM SPACE|2005 FOUR-PER-EM SPACE|" +
  "2006 SIX-PER-EM SPACE|2007 FIGURE SPACE|2008 PUNCTUATION SPACE|2009 THIN SPACE|" +
  "200A HAIR SPACE|200B ZERO WIDTH SPACE|200C ZERO WIDTH NON-JOINER|" +
  "200D ZERO WIDTH JOINER|200E LEFT-TO-RIGHT MARK|200F RIGHT-TO-LEFT MARK|" +
  "202A LEFT-TO-RIGHT EMBEDDING|202B RIGHT-TO-LEFT EMBEDDING|" +
  "202C POP DIRECTIONAL FORMATTING|202D LEFT-TO-RIGHT OVERRIDE|" +
  "202E RIGHT-TO-LEFT OVERRIDE|202F NARROW NO-BREAK SPACE|205F MEDIUM MATHEMATICAL SPACE|" +
  "2060 WORD JOINER|2061 FUNCTION APPLICATION|2062 INVISIBLE TIMES|" +
  "2063 INVISIBLE SEPARATOR|2064 INVISIBLE PLUS|2066 LEFT-TO-RIGHT ISOLATE|" +
  "2067 RIGHT-TO-LEFT ISOLATE|2068 FIRST STRONG ISOLATE|2069 POP DIRECTIONAL ISOLATE|" +
  "206A INHIBIT SYMMETRIC SWAPPING|206B ACTIVATE SYMMETRIC SWAPPING|" +
  "206C INHIBIT ARABIC FORM SHAPING|206D ACTIVATE ARABIC FORM SHAPING|" +
  "206E NATIONAL DIGIT SHAPES|206F NOMINAL DIGIT SHAPES|2800 BRAILLE PATTERN BLANK|" +
  "3000 IDEOGRAPHIC SPACE|3164 HANGUL FILLER|FEFF ZERO WIDTH NO-BREAK SPACE|" +
  "FFA0 HALFWIDTH HANGUL FILLER|FFF9 INTERLINEAR ANNOTATION ANCHOR|" +
  "FFFA INTERLINEAR ANNOTATION SEPARATOR|FFFB INTERLINEAR ANNOTATION TERMINATOR|" +
  "110BD KAITHI NUMBER SIGN|110CD KAITHI NUMBER SIGN ABOVE|" +
  "13430 EGYPTIAN HIEROGLYPH VERTICAL JOINER|13431 EGYPTIAN HIEROGLYPH HORIZONTAL JOINER|" +
  "13432 EGYPTIAN HIEROGLYPH INSERT AT TOP START|" +
  "13433 EGYPTIAN HIEROGLYPH INSERT AT BOTTOM START|" +
  "13434 EGYPTIAN HIEROGLYPH INSERT AT TOP END|" +
  "13435 EGYPTIAN HIEROGLYPH INSERT AT BOTTOM END|" +
  "13436 EGYPTIAN HIEROGLYPH OVERLAY MIDDLE|13437 EGYPTIAN HIEROGLYPH BEGIN SEGMENT|" +
  "13438 EGYPTIAN HIEROGLYPH END SEGMENT|13439 EGYPTIAN HIEROGLYPH INSERT AT MIDDLE|" +
  "1343A EGYPTIAN HIEROGLYPH INSERT AT TOP|1343B EGYPTIAN HIEROGLYPH INSERT AT BOTTOM|" +
  "1343C EGYPTIAN HIEROGLYPH BEGIN ENCLOSURE|1343D EGYPTIAN HIEROGLYPH END ENCLOSURE|" +
  "1343E EGYPTIAN HIEROGLYPH BEGIN WALLED ENCLOSURE|" +
  "1343F EGYPTIAN HIEROGLYPH END WALLED ENCLOSURE|1BCA0 SHORTHAND FORMAT LETTER OVERLAP|" +
  "1BCA1 SHORTHAND FORMAT CONTINUING OVERLAP|1BCA2 SHORTHAND FORMAT DOWN STEP|" +
  "1BCA3 SHORTHAND FORMAT UP STEP|1D173 MUSICAL SYMBOL BEGIN BEAM|" +
  "1D174 MUSICAL SYMBOL END BEAM|1D175 MUSICAL SYMBOL BEGIN TIE|" +
  "1D176 MUSICAL SYMBOL END TIE|1D177 MUSICAL SYMBOL BEGIN SLUR|" +
  "1D178 MUSICAL SYMBOL END SLUR|1D179 MUSICAL SYMBOL BEGIN PHRASE|" +
  "1D17A MUSICAL SYMBOL END PHRASE";

const NAMES = new Map(
  NAME_TABLE.split("|").map((entry) => {
    const space = entry.indexOf(" ");
    return [
      Number.parseInt(entry.slice(0, space), 16),
      entry.slice(space + 1),
    ] as const;
  }),
);

const ASCII_PUNCTUATION = (
  "EXCLAMATION MARK|QUOTATION MARK|NUMBER SIGN|DOLLAR SIGN|PERCENT SIGN|AMPERSAND|APOSTROPHE|" +
  "LEFT PARENTHESIS|RIGHT PARENTHESIS|ASTERISK|PLUS SIGN|COMMA|HYPHEN-MINUS|FULL STOP|SOLIDUS|" +
  "COLON|SEMICOLON|LESS-THAN SIGN|EQUALS SIGN|GREATER-THAN SIGN|QUESTION MARK|COMMERCIAL AT|" +
  "LEFT SQUARE BRACKET|REVERSE SOLIDUS|RIGHT SQUARE BRACKET|CIRCUMFLEX ACCENT|LOW LINE|" +
  "GRAVE ACCENT|LEFT CURLY BRACKET|VERTICAL LINE|RIGHT CURLY BRACKET|TILDE"
).split("|");
const DIGITS = "ZERO|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE".split("|");

/** Name of a printable ASCII character other than space (0x21 to 0x7E). */
function asciiName(c: number): string {
  if (c >= 0x30 && c <= 0x39) return `DIGIT ${DIGITS[c - 0x30]}`;
  if (c >= 0x41 && c <= 0x5a)
    return `LATIN CAPITAL LETTER ${String.fromCharCode(c)}`;
  if (c >= 0x61 && c <= 0x7a)
    return `LATIN SMALL LETTER ${String.fromCharCode(c - 0x20)}`;
  // Punctuation, in code order: 0x21-0x2F, 0x3A-0x40, 0x5B-0x60, 0x7B-0x7E.
  const i =
    c < 0x30
      ? c - 0x21
      : c < 0x41
        ? c - 0x3a + 15
        : c < 0x61
          ? c - 0x5b + 22
          : c - 0x7b + 28;
  return ASCII_PUNCTUATION[i];
}

function charName(cp: number): string {
  const known = NAMES.get(cp);
  if (known) return known;
  if (cp >= 0xfe00 && cp <= 0xfe0f)
    return `VARIATION SELECTOR-${cp - 0xfe00 + 1}`;
  if (cp >= 0xe0100 && cp <= 0xe01ef)
    return `VARIATION SELECTOR-${cp - 0xe0100 + 17}`;
  if (cp === 0xe0001) return "LANGUAGE TAG";
  if (cp === 0xe0020) return "TAG SPACE";
  if (cp === 0xe007f) return "CANCEL TAG";
  if (cp > 0xe0020 && cp < 0xe007f) return `TAG ${asciiName(cp - 0xe0000)}`;
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}
