// Every sentence tellall says, in English (spec §5.4). Findings are built
// from fields, never per vendor; this module only words them. A
// translation is another file with the same shape.
//
// Never say real, fake, verified, trusted or authentic (test/words.test.ts
// checks every sentence here): no tool can prove where a file came from.

/** A moment, already split up; `utc` when the time zone is known to be UTC. */
export interface Moment {
  year: number;
  month: number; // 1 to 12
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
  utc?: boolean;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** A file name as one shell word: as it is when that's safe, else in
 * single quotes, a quote inside written as '\''. A name that starts with
 * "-" gets "./" first, so it can't read as an option. */
function shellWord(file: string): string {
  const name = file.startsWith("-") ? `./${file}` : file;
  if (/^[\w.,+@%/:=-]+$/.test(name)) return name;
  return `'${name.replace(/'/g, "'\\''")}'`;
}

const two = (n: number) => String(n).padStart(2, "0");

/** "25 Oct 2026 at 14:46:19 UTC", or "1 Oct 2026" without a time. */
function moment(m: Moment): string {
  const day = `${m.day} ${MONTHS[m.month - 1] ?? "?"} ${m.year}`;
  if (m.hour === undefined) return day;
  const time = `${two(m.hour)}:${two(m.minute ?? 0)}:${two(m.second ?? 0)}`;
  return `${day} at ${time}${m.utc ? " UTC" : ""}`;
}

/** "a", "a and b", "a, b and c". */
function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** "51.4769° N, 0.0005° W". */
function place(lat: number, lon: number): string {
  const part = (v: number, pos: string, neg: string) =>
    `${Math.abs(v).toFixed(4)}° ${v < 0 ? neg : pos}`;
  return `${part(lat, "N", "S")}, ${part(lon, "E", "W")}`;
}

/** How an IPTC DigitalSourceType code reads, after "says it was". */
const SOURCE_WORDS: Record<string, string> = {
  trainedAlgorithmicMedia: "made by AI",
  compositeWithTrainedAlgorithmicMedia: "partly made by AI",
  algorithmicallyEnhanced: "changed by software",
  algorithmicMedia: "made by a computer program",
  compositeSynthetic: "put together with computer-made parts",
  digitalCapture: "taken with a camera",
  computationalCapture: "taken with a camera that processed it",
  digitalCreation: "drawn or made on a computer",
  screenCapture: "a screenshot",
  composite: "put together from several pictures",
};

export const en = {
  // Headlines, in the order inspect() picks them.
  headline: {
    aiMade: "This image says it was made by AI.",
    aiLabel: "This image carries an AI label.",
    personal: (n: number) =>
      `This file gives away ${count(n, "kind", "kinds")} of personal data.`,
    hidden: (n: number) =>
      `This text has ${count(n, "hidden character", "hidden characters")}.`,
    noHidden: "No hidden characters.",
    copyAddress: "This copy carries the page's address.",
    copyExtras: "This copy carries extras from the page.",
    empty:
      "No marks found. That doesn't prove anything: many apps and sites strip them.",
    unknown: "tellall can't read this kind of file yet.",
  },

  // The AI label (C2PA).
  label: {
    signed: (signer: string, matches: boolean | null) =>
      matches === true
        ? `Signed with a certificate issued to ${signer}. The signature matches this file.`
        : matches === false
          ? `Signed with a certificate issued to ${signer}. The signature doesn't match this file (it was changed after signing).`
          : `Signed with a certificate issued to ${signer}. tellall couldn't check whether the signature matches this file.`,
    unsigned: (matches: boolean | null) =>
      matches === false
        ? "The label's signature doesn't match this file (it was changed after signing)."
        : "The label doesn't name who signed it.",
    /** "ChatGPT (gpt-image)". */
    agent: (name: string, version: string | null) =>
      version ? `${name} (${version})` : name,
    madeWith: (agent: string, when: Moment | null) =>
      when ? `Made with ${agent} on ${moment(when)}.` : `Made with ${agent}.`,
    /** The created action's own words, when it names no tool: its own
     * full stop kept. */
    says: (description: string, when: Moment | null) => {
      const quoted = `The label says: "${description}"`;
      if (when) return `${quoted} on ${moment(when)}.`;
      return /[.!?]$/.test(description) ? quoted : `${quoted}.`;
    },
    watermark: (signerShort: string | null) =>
      `The label says ${signerShort ?? "its maker"} also put an invisible watermark in the pixels. A clean copy can't remove it.`,
    webp: "This image carries an AI label (details can't be read for WebP yet).",
    damaged:
      "This image carries an AI label, but it's damaged and can't be read.",
    nothingElse: "No location, camera or other personal data.",
  },

  // An AI-source tag (IPTC/XMP DigitalSourceType) outside a C2PA label.
  source: (code: string) => {
    const words = SOURCE_WORDS[code];
    return words
      ? `A tag in the file says it was ${words}.`
      : `A tag in the file says how it was made: ${code}.`;
  },

  // Personal data in an image's metadata.
  location: {
    gps: (lat: number, lon: number) =>
      `It records the exact place it was taken: ${place(lat, lon)}.`,
    gpsUnreadable: "It records where it was taken.",
    places: (names: string[]) => `It names a place: ${names.join(", ")}.`,
  },
  device: {
    camera: (camera: string) => `It names the camera: ${camera}.`,
    lens: (lens: string) => `It names the lens: ${lens}.`,
    serials: (serials: string[]) =>
      `It records ${serials.length === 1 ? "a serial number" : "serial numbers"} that can identify the camera or lens: ${serials.join(", ")}.`,
  },
  dates: {
    taken: (when: Moment) => `It records when it was taken: ${moment(when)}.`,
    saved: (when: Moment) =>
      `It records when it was last saved: ${moment(when)}.`,
    other: (text: string) => `It records a date: ${text}.`,
  },
  software: (names: string[]) =>
    `It names the software that saved it: ${list(names)}.`,
  ids: (ids: string[]) =>
    ids.length === 1
      ? `It carries an ID that can link it to other copies of the same file: ${ids[0]}.`
      : `It carries IDs that can link it to other copies of the same file: ${ids.join(", ")}.`,
  otherText: {
    names: (names: string[]) =>
      names.length === 1
        ? `It names a person: ${names[0]}.`
        : `It names people: ${list(names)}.`,
    contact: (contacts: string[]) =>
      `It holds contact details: ${contacts.join(", ")}.`,
    caption: (captions: string[]) =>
      `It carries a caption: ${captions.join(" / ")}.`,
    comment: (comments: string[]) =>
      `It carries a comment: ${comments.join(" / ")}.`,
    text: (entries: string[]) => `It carries text: ${entries.join(" / ")}.`,
  },

  // The file itself.
  damaged: "This file is damaged; tellall read what it could.",
  detailsStoredOddly:
    "This file stores its details in a way tellall can't read yet.",

  // Pasted text.
  text: {
    name: "Pasted text",
    hidden: (n: number, names: string[]) =>
      `${count(n, "hidden character", "hidden characters")}: ${names.join(", ")}. They don't show, but they travel with the text.`,
    decodedTags: (decoded: string) =>
      `Unicode tag characters spell out hidden text: "${decoded}".`,
    decodedSelectors: (decoded: string) =>
      `Variation selectors carry hidden bytes that read: "${decoded}".`,
    spaces: (n: number, names: string[]) =>
      `${count(n, "unusual space", "unusual spaces")}: ${names.join(", ")}. They look like ordinary spaces and stay in the clean text.`,
    harmless: (n: number, names: string[]) =>
      `${count(n, "usually harmless character", "usually harmless characters")}, such as emoji joiners: ${names.join(", ")}. They stay in the clean text.`,
    /** A character and how often it appears: "ZERO WIDTH SPACE (U+200B) ×2". */
    char: (name: string, codePoint: number, times: number) =>
      `${name} (U+${codePoint.toString(16).toUpperCase().padStart(4, "0")})${times > 1 ? ` ×${times}` : ""}`,
  },
  // What a formatted copy carries besides the words. The link comes from
  // the browser's copy (spec §3), never from the AI company.
  copy: {
    sourceUrl: (url: string) =>
      `The browser added the page's address to this copy: ${url}. Apps like Word and OneNote can keep it when you paste.`,
    ids: (ids: string[]) =>
      ids.length === 1
        ? `The copy carries an ID from the page that looks like a response ID: ${ids[0]}.`
        : `The copy carries IDs from the page that look like response IDs: ${ids.join(", ")}.`,
    styling: (classes: number, styles: number) => {
      const parts = [
        classes ? count(classes, "class name", "class names") : "",
        styles ? count(styles, "inline style", "inline styles") : "",
      ].filter(Boolean);
      return `The copy carries the page's own styling (${parts.join(", ")}), which can hint at the site it came from.`;
    },
    hiddenStyled:
      "Part of the copy is styled to be invisible, so it can hold text you don't see.",
  },

  // clean() notes (spec §6).
  clean: {
    nothing: "Nothing private to remove.",
    labelChanged:
      "The AI label was kept, but it no longer matches this file because other data was removed.",
    labelsRemoved:
      "AI labels removed. The invisible watermark in the pixels (if any) stays; this tool can't remove it.",
    damaged: "This file is damaged, so tellall can't make a clean copy of it.",
    unknown:
      "tellall can't read this kind of file yet, so it can't make a clean copy.",
    heicXmpKept: (fields: string[]) =>
      `The AI-source tag was kept in its XMP packet, which also still holds: ${fields.join(", ")}.`,
  },

  // The command that removes a file's labels, its name one shell word;
  // and the web page's hint under a label, which holds that command.
  removeLabels: (filename: string) =>
    `npx tellall clean --remove-labels ${shellWord(filename)}`,
  webHint: (filename: string) =>
    `Want the label gone too? On files you own: ${en.removeLabels(filename)}. The invisible watermark stays either way.`,

  // The anatomy map's notes.
  anatomy: {
    signature: "File signature",
    imageHeader: "Image header",
    tables: "Decoding tables",
    jfif: "JFIF header",
    pixels: "Picture data",
    label: (signer: string | null) =>
      signer ? `C2PA label · signed by ${signer}` : "C2PA label",
    exif: "Exif",
    xmp: "XMP",
    iptc: "IPTC",
    comment: "Comment",
    text: "Text",
    time: "Time saved",
    profile: "Colour profile",
    end: "End",
    afterEnd: "After the end of the image",
    cutShort: "Cut short",
    unreadable: "Can't be followed",
    items: "Item table",
    gap: "Unused bytes",
  },
};

export type Words = typeof en;
