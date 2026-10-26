// What a file or a text gives away, as findings: one group of the spec's
// §4 tables each, worded by words/en.ts. Built from fields, never per
// vendor: a label from a maker this has never seen reads the same way.
import type { Label } from "./c2pa/read.ts";
import type { Block, Meta, Read } from "./image/read.ts";
import { chunks as pngChunks } from "./image/strip/png.ts";
import type { Field, Finding, Group } from "./index.ts";
import { decodeRuns, scanText, type CharHit } from "./text/hidden.ts";
import type { CopyExtras } from "./text/html.ts";
import { en, type Moment } from "./words/en.ts";

/** The groups in the order a report lists them. */
export const GROUPS: Group[] = [
  "ai-label",
  "ai-source",
  "location",
  "device",
  "dates",
  "software",
  "ids",
  "other-text",
  "hidden-chars",
  "copy-extras",
];

/** IPTC source types that say a picture was made by AI. */
const AI_SOURCES = new Set([
  "trainedAlgorithmicMedia",
  "compositeWithTrainedAlgorithmicMedia",
]);

/** The code at the end of an IPTC source type URI. */
export const sourceCode = (uri: string) =>
  uri.trim().split("/").at(-1) ?? uri.trim();

export const saysAi = (uri: string | null | undefined) =>
  !!uri && AI_SOURCES.has(sourceCode(uri));

// --- Values ---------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  !ArrayBuffer.isView(v) &&
  !(v instanceof Date);

/** The most of one value a sentence quotes. */
const QUOTE = 120;
const quote = (s: string) =>
  s.length > QUOTE ? `${s.slice(0, QUOTE - 1).trimEnd()}…` : s;

/** The most of one value a field holds ("Show everything", --json). */
const FIELD = 2000;
function fieldValue(s: string): string {
  if (s.length <= FIELD) return s;
  // Not between the two halves of an emoji.
  const end = /[\uD800-\uDBFF]/.test(s[FIELD - 1] ?? "") ? FIELD - 1 : FIELD;
  return `${s.slice(0, end)}${en.text.cut(s.length)}`;
}

/** Markup (`<rdf:li>`, `</x>`, `<!--`) in a value: a damaged XMP packet or
 * a planted tag. Such values stay in the fields, out of sentences. */
const MARKUP = /<[/!?]?[\p{L}_]/u;
const sayable = (s: string) => !MARKUP.test(s);

/** One value as text: lists comma-separated, an XMP language alternative
 * as its text, short bytes as letters or numbers, long bytes not at all. */
function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString();
  }
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(", ") || null;
  if (ArrayBuffer.isView(v)) {
    const bytes = Array.from(
      new Uint8Array(v.buffer, v.byteOffset, v.byteLength),
    );
    if (bytes.length > 64) return null;
    const printable = bytes.every((b) => b >= 0x20 && b < 0x7f);
    return printable ? String.fromCharCode(...bytes) : bytes.join(", ");
  }
  if (isObject(v)) {
    if ("value" in v) return asText(v["value"]);
    const parts = Object.entries(v)
      .map(([k, x]) => {
        const t = asText(x);
        return t === null ? null : `${k}: ${t}`;
      })
      .filter(Boolean);
    return parts.join("; ") || null;
  }
  return null;
}

/** Every piece of text in a value (a list's items, an object's values). */
function texts(v: unknown): string[] {
  if (typeof v === "string") return v.trim() ? [v.trim()] : [];
  if (typeof v === "number") return [String(v)];
  if (Array.isArray(v)) return v.flatMap(texts);
  if (isObject(v)) {
    return "value" in v ? texts(v["value"]) : Object.values(v).flatMap(texts);
  }
  return [];
}

const unique = (items: string[]) => [...new Set(items)];

// --- Image metadata -------------------------------------------------------

const BLOCK_NAMES: Record<Block, string> = {
  exif: "Exif",
  gps: "Exif GPS",
  xmp: "XMP",
  iptc: "IPTC",
  text: "Text",
};

const PLACES = ["Sublocation", "Location", "City", "State", "Country"];
const PLACE_KEYS = new Set([
  ...PLACES,
  "CountryCode",
  "LocationCreated",
  "LocationShown",
]);
const SERIALS = [
  "SerialNumber",
  "BodySerialNumber",
  "CameraSerialNumber",
  "InternalSerialNumber",
  "LensSerialNumber",
];
const DEVICE_KEYS = new Set([
  "Make",
  "Model",
  "LensModel",
  "Lens",
  "LensMake",
  "LensID",
  "HostComputer",
  "CameraFirmware",
  "Firmware",
  ...SERIALS,
]);
const TAKEN = [
  "DateTimeOriginal",
  "CreateDate",
  "DateCreated",
  "DateTimeDigitized",
];
const SAVED = ["ModifyDate", "DateTime", "MetadataDate"];
const DATE_KEYS = new Set([
  ...TAKEN,
  ...SAVED,
  "DigitalCreationDate",
  "TimeCreated",
  "DigitalCreationTime",
  "OffsetTime",
  "OffsetTimeOriginal",
  "OffsetTimeDigitized",
  "SubSecTime",
  "SubSecTimeOriginal",
  "SubSecTimeDigitized",
  "DateAcquired",
]);
const SOFTWARE_KEYS = new Set([
  "Software",
  "CreatorTool",
  "ProcessingSoftware",
  "History",
  "OriginatingProgram",
  "ProgramVersion",
  "ImageEditingSoftware",
  "RAWDevelopingSoftware",
  "MetadataEditingSoftware",
]);
const ID_KEYS = new Set([
  "DocumentID",
  "InstanceID",
  "OriginalDocumentID",
  "ImageUniqueID",
  "DerivedFrom",
  "UniqueID",
  "DocumentAncestors",
  "DigitalImageGUID",
  "ImageSupplierImageID",
  "LicensorImageID",
  "ModelReleaseID",
  "PropertyReleaseID",
  "Identifier",
  "identifier",
  "TransmissionReference",
]);
const NAMES = [
  "Artist",
  "creator",
  "Byline",
  "Author",
  "XPAuthor",
  "OwnerName",
  "CameraOwnerName",
  "Copyright",
  "CopyrightNotice",
  "rights",
  "Credit",
  "Writer",
  "CaptionWriter",
  "PersonInImage",
  "PersonInImageWDetails",
  // The names in face regions (image/read.ts reads them out).
  "RegionName",
  "Owner",
  "ImageCreator",
  "CopyrightOwner",
  "Licensor",
  "ImageSupplier",
  "contributor",
  "publisher",
  "author",
  "Photographer",
  "ImageEditor",
];
const CONTACTS = ["CreatorContactInfo", "Contact"];
const CAPTIONS = [
  "ImageDescription",
  "Caption",
  "description",
  "Headline",
  "title",
  "XPTitle",
  "XPSubject",
  "XPKeywords",
  "Description",
  "Title",
  "subject",
  "Keywords",
  "ObjectName",
  "ImageTitle",
  "Label",
  "hierarchicalSubject",
  "weightedFlatSubject",
  "LastKeywordXMP",
  "LastKeywordIPTC",
  "TagsList",
  "Event",
];
const COMMENTS = ["Comment", "UserComment", "XPComment", "Instructions"];
/** Face and image regions: their names are read out as RegionName; the
 * rest of them (shapes, types) says nothing more. */
const REGIONS = ["Regions", "ImageRegion"];
const OTHER_TEXT_KEYS = new Set([
  ...NAMES,
  ...CONTACTS,
  ...CAPTIONS,
  ...COMMENTS,
  ...REGIONS,
]);
/** Other text about the picture or who made it, quoted as it is: file
 * names and paths, a nickname, links, a job title. */
const TEXT_KEYS = new Set([
  "DocumentName",
  "PageName",
  "PreservedFileName",
  "RawFileName",
  "OriginalFileName",
  "Nickname",
  "BaseURL",
  "WebStatement",
  "UsageTerms",
  "Source",
  "source",
  "AuthorsPosition",
  "OrganisationInImageName",
  "ArtworkOrObject",
]);
/** IPTC's own bookkeeping: not about the picture or anyone. */
const IPTC_BOOKKEEPING = new Set([
  "ApplicationRecordVersion",
  "CodedCharacterSet",
  "EnvelopeRecordVersion",
  "ModelVersion",
]);
/** exifr's own readings of GPS, already listed as they're stored. */
const DERIVED = new Set(["latitude", "longitude"]);

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** The group a metadata field belongs to, or null for the technical ones
 * (resolution, colour space, versions) no one is given away by. */
function groupOf(key: string, block: Block): Group | null {
  if (key === "DigitalSourceType") return "ai-source";
  if (block === "gps" || /^GPS/.test(key) || PLACE_KEYS.has(key)) {
    return "location";
  }
  if (DEVICE_KEYS.has(key)) return "device";
  if (DATE_KEYS.has(key)) return "dates";
  if (SOFTWARE_KEYS.has(key)) return "software";
  if (ID_KEYS.has(key)) return "ids";
  if (OTHER_TEXT_KEYS.has(key) || TEXT_KEYS.has(key)) return "other-text";
  if (block === "text") {
    if (/software|generator/i.test(key)) return "software";
    if (/time|date/i.test(key)) return "dates";
    return "other-text";
  }
  if (block === "iptc" && !IPTC_BOOKKEEPING.has(key)) return "other-text";
  return null;
}

interface Entry {
  key: string;
  value: unknown;
  block: Block;
}

/** A moment from Exif's "2026:10:01 12:00:00", XMP's ISO dates or a Date. */
export function momentOf(v: unknown): Moment | null {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return {
      year: v.getFullYear(),
      month: v.getMonth() + 1,
      day: v.getDate(),
      hour: v.getHours(),
      minute: v.getMinutes(),
      second: v.getSeconds(),
    };
  }
  const text = texts(v)[0] ?? "";
  const m =
    /^(\d{4})[:-](\d{2})[:-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z)?)?/.exec(
      text,
    );
  if (!m) return null;
  const out: Moment = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
  };
  if (m[4] !== undefined) {
    out.hour = Number(m[4]);
    out.minute = Number(m[5]);
    out.second = Number(m[6] ?? 0);
    if (m[7]) out.utc = true;
  }
  return realMoment(out) ? out : null;
}

/** Whether a moment is a real calendar day and time: no 31 Feb, no 25:61. */
export function realMoment(m: Moment): boolean {
  const { year, month, day } = m;
  if (![year, month, day].every(Number.isInteger)) return false;
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > (days[month - 1] ?? 0)) return false;
  if (m.hour === undefined) return true;
  const { hour, minute = 0, second = 0 } = m;
  return (
    [hour, minute, second].every(Number.isInteger) &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 60 // a leap second
  );
}

/** A label's ISO time ("2026-10-25T14:46:19.830385961Z") in UTC. */
export function utcMoment(when: string | null): Moment | null {
  if (!when) return null;
  // Date.parse rolls 31 Feb over to 3 Mar: check the written parts first.
  const parts =
    /^\s*([+-]?\d{4,6})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(
      when,
    );
  if (
    parts &&
    !realMoment({
      year: Number(parts[1]),
      month: Number(parts[2]),
      day: Number(parts[3]),
      ...(parts[4] !== undefined
        ? {
            hour: Number(parts[4]),
            minute: Number(parts[5]),
            second: Number(parts[6] ?? 0),
          }
        : {}),
    })
  ) {
    return null;
  }
  // Date reads milliseconds at most.
  const ms = Date.parse(when.trim().replace(/(\.\d{3})\d+/, "$1"));
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    utc: true,
  };
}

/** Degrees from Exif's [d, m, s], XMP's "51,28.614N", or a number; south
 * and west negative. */
function degrees(value: unknown, ref: unknown): number | undefined {
  let parts: number[];
  let hemisphere = texts(ref)[0]?.toUpperCase();
  if (typeof value === "number") parts = [value];
  else if (Array.isArray(value)) parts = value.map(Number);
  else if (typeof value === "string") {
    const m = /^\s*([\d.,\s]+?)\s*([NSEW])?\s*$/i.exec(value);
    if (!m?.[1]) return undefined;
    parts = m[1].split(",").map(Number);
    hemisphere = m[2]?.toUpperCase() ?? hemisphere;
  } else return undefined;
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return undefined;
  const [d = 0, m = 0, s = 0] = parts;
  // Minutes and seconds are under 60; only a lone number can be negative.
  if (parts.length > 1 && (d < 0 || m < 0 || m >= 60 || s < 0 || s >= 60))
    return undefined;
  const abs = d + m / 60 + s / 3600;
  return hemisphere === "S" || hemisphere === "W" ? -abs : abs;
}

/** A real place on Earth: latitude within ±90°, longitude within ±180°. */
const onEarth = (lat: number, lon: number) =>
  Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/** Whether two moments name the same date and time (zone aside). */
const sameMoment = (a: Moment, b: Moment) =>
  a.year === b.year &&
  a.month === b.month &&
  a.day === b.day &&
  a.hour === b.hour &&
  a.minute === b.minute &&
  a.second === b.second;

/** A PNG's tIME chunk (the time it was last saved, in UTC). */
export function pngTime(b: Uint8Array): Moment | null {
  try {
    const c = pngChunks(b).list.find((x) => x.type === "tIME");
    if (!c || c.end - c.data - 4 !== 7) return null;
    const d = b.subarray(c.data, c.data + 7);
    const out: Moment = {
      year: ((d[0] ?? 0) << 8) | (d[1] ?? 0),
      month: d[2] ?? 0,
      day: d[3] ?? 0,
      hour: d[4] ?? 0,
      minute: d[5] ?? 0,
      second: d[6] ?? 0,
      utc: true,
    };
    return realMoment(out) ? out : null;
  } catch {
    return null;
  }
}

const iso = (m: Moment) =>
  `${m.year}-${String(m.month).padStart(2, "0")}-${String(m.day).padStart(2, "0")} ` +
  `${String(m.hour ?? 0).padStart(2, "0")}:${String(m.minute ?? 0).padStart(2, "0")}:${String(m.second ?? 0).padStart(2, "0")}`;

/** The XMP DigitalSourceType the image states outside any C2PA label. */
export function xmpSource(read: Read | undefined): string | undefined {
  const v = read?.groups.find(([b]) => b === "xmp")?.[1]["DigitalSourceType"];
  return texts(v)[0];
}

/** The findings an image's metadata makes: an AI-source tag, then the
 * private groups. `textFrom` names where a "text" block came from. */
export function metaFindings(
  read: Read | undefined,
  time: Moment | null,
  textFrom: string,
): Finding[] {
  const entries: Entry[] = (read?.groups ?? []).flatMap(([block, meta]) =>
    Object.entries(meta).map(([key, value]) => ({ key, value, block })),
  );
  const byGroup = new Map<Group, Entry[]>();
  const fields = new Map<Group, Field[]>();
  const from = (block: Block) =>
    block === "text" ? textFrom : BLOCK_NAMES[block];
  const addField = (group: Group, field: Field) => {
    const list = fields.get(group) ?? [];
    list.push({ ...field, value: fieldValue(field.value) });
    fields.set(group, list);
  };
  const guids: string[] = [];
  for (const e of entries) {
    if (DERIVED.has(e.key)) continue;
    const group = groupOf(e.key, e.block);
    const value = asText(e.value);
    if (group) {
      const list = byGroup.get(group);
      if (list) list.push(e);
      else byGroup.set(group, [e]);
      if (value !== null)
        addField(group, { name: e.key, value, from: from(e.block) });
    }
    // A GUID anywhere else is a tracking ID too.
    if (group !== "ids" && value !== null) {
      for (const g of value.match(GUID) ?? []) {
        guids.push(g);
        addField("ids", { name: e.key, value: g, from: from(e.block) });
      }
    }
  }
  if (time) {
    addField("dates", {
      name: "tIME",
      value: `${iso(time)} UTC`,
      from: "PNG tIME chunk",
    });
  }

  const meta = (group: Group) => {
    const out: Meta = {};
    for (const e of byGroup.get(group) ?? [])
      if (!(e.key in out)) out[e.key] = e.value;
    return out;
  };
  const pick = (m: Meta, keys: string[]) =>
    unique(keys.flatMap((k) => texts(m[k])).filter(sayable)).map(quote);
  /** The first text of a value, if a sentence can quote it. */
  const first = (v: unknown) => texts(v).filter(sayable)[0];
  const sentences = new Map<Group, string[]>();
  const say = (group: Group, sentence: string) => {
    const list = sentences.get(group);
    if (list) list.push(sentence);
    else sentences.set(group, [sentence]);
  };

  // AI source.
  const source = xmpSource(read);
  if (source) say("ai-source", en.source(sourceCode(source)));

  // Location.
  const loc = meta("location");
  if (byGroup.has("location")) {
    const lat = degrees(loc["GPSLatitude"], loc["GPSLatitudeRef"]);
    const lon = degrees(loc["GPSLongitude"], loc["GPSLongitudeRef"]);
    const places = pick(loc, PLACES);
    if (!places.length) places.push(...pick(loc, ["CountryCode"]));
    if (lat !== undefined && lon !== undefined && onEarth(lat, lon))
      say("location", en.location.gps(lat, lon));
    else if (!places.length) say("location", en.location.gpsUnreadable);
    if (places.length) say("location", en.location.places(places));
  }

  // Device.
  const dev = meta("device");
  if (byGroup.has("device")) {
    const make = first(dev["Make"]);
    const model = first(dev["Model"]);
    // "Canon EOS R6", not "Canon Canon EOS R6".
    const repeats = make && model?.toLowerCase().startsWith(make.toLowerCase());
    const camera =
      make && model && !repeats
        ? `${make} ${model}`
        : (model ?? make ?? first(dev["HostComputer"]));
    const lens = first(dev["LensModel"]) ?? first(dev["Lens"]);
    const serials = pick(dev, SERIALS);
    if (camera) say("device", en.device.camera(quote(camera)));
    if (lens) say("device", en.device.lens(quote(lens)));
    if (serials.length) say("device", en.device.serials(serials));
    if (!sentences.has("device")) {
      const any = pick(dev, [...DEVICE_KEYS]);
      say(
        "device",
        any.length ? en.device.camera(any.join(", ")) : en.device.unnamed,
      );
    }
  }

  // Dates.
  const dat = meta("dates");
  if (byGroup.has("dates") || time) {
    const firstMoment = (keys: string[]) => {
      for (const k of keys) {
        const m = momentOf(dat[k]);
        if (m) return m;
      }
      return null;
    };
    // A date that isn't a real day and time is said without it.
    const has = (keys: string[]) => keys.some((k) => texts(dat[k]).length);
    const taken = firstMoment(TAKEN);
    const saved = firstMoment(SAVED) ?? time;
    if (taken) say("dates", en.dates.taken(taken));
    else if (has(TAKEN)) say("dates", en.dates.takenUnreadable);
    // The same moment twice (Exif's and a PNG's tIME) is said once.
    if (saved && !(taken && sameMoment(taken, saved))) {
      say("dates", en.dates.saved(saved));
    } else if (!saved && has(SAVED)) say("dates", en.dates.savedUnreadable);
    if (!sentences.has("dates")) {
      const any = (byGroup.get("dates") ?? [])
        .map((e) => asText(e.value))
        .find((v) => v !== null && sayable(v));
      say("dates", any ? en.dates.other(quote(any)) : en.dates.unreadable);
    }
  }

  // Software.
  if (byGroup.has("software")) {
    const soft = meta("software");
    const names = pick(soft, [
      "Software",
      "CreatorTool",
      "ProcessingSoftware",
      "OriginatingProgram",
    ]);
    // XMP's history: each step's softwareAgent.
    const history = soft["History"];
    for (const step of Array.isArray(history)
      ? history
      : history
        ? [history]
        : []) {
      if (isObject(step))
        names.push(...texts(step["softwareAgent"]).filter(sayable).map(quote));
    }
    for (const e of byGroup.get("software") ?? []) {
      if (e.block === "text")
        names.push(...texts(e.value).filter(sayable).map(quote));
    }
    const all = unique(names);
    const any = all.length ? all : pick(soft, [...SOFTWARE_KEYS]);
    say("software", any.length ? en.software(any) : en.softwareUnnamed);
  }

  // IDs.
  const allIds = unique([
    ...(byGroup.get("ids") ?? []).flatMap((e) => texts(e.value)),
    ...guids,
  ]);
  const idValues = allIds.filter(sayable).map(quote);
  if (idValues.length) say("ids", en.ids(idValues));
  else if (allIds.length) say("ids", en.idsUnnamed);

  // Other text.
  if (byGroup.has("other-text")) {
    const other = meta("other-text");
    const names = pick(other, NAMES);
    const contacts = pick(other, CONTACTS);
    const captions = pick(other, CAPTIONS);
    const comments = pick(other, COMMENTS);
    if (names.length) say("other-text", en.otherText.names(names));
    if (contacts.length) say("other-text", en.otherText.contact(contacts));
    if (captions.length) say("other-text", en.otherText.caption(captions));
    if (comments.length) say("other-text", en.otherText.comment(comments));
    const rest = (byGroup.get("other-text") ?? [])
      .filter((e) => !OTHER_TEXT_KEYS.has(e.key))
      .map((e) => `${e.key}: ${quote(asText(e.value) ?? "")}`)
      .filter(sayable);
    if (rest.length) say("other-text", en.otherText.text(unique(rest)));
    if (!sentences.has("other-text") && fields.get("other-text")?.length)
      say("other-text", en.otherText.unnamed);
  }

  const out: Finding[] = [];
  for (const group of GROUPS) {
    const said = sentences.get(group);
    if (!said) continue;
    const label = group === "ai-source";
    out.push({
      group,
      kind: label ? "label" : "private",
      sentence: said.join(" "),
      fields: fields.get(group) ?? [],
      cleanedBy: label ? "remove-labels" : "clean",
    });
  }
  return out;
}

// --- AI label --------------------------------------------------------------

/** "OpenAI" from "OpenAI OpCo, LLC", "Google" from "Google LLC". */
const firstWord = (s: string | null) =>
  s
    ?.trim()
    .split(/\s+/)[0]
    ?.replace(/[,;:.]+$/, "") || null;

export function labelFindings(label: Label, webp: boolean): Finding[] {
  const finding = (sentence: string, fields: Field[] = []): Finding => ({
    group: "ai-label",
    kind: "label",
    sentence,
    fields,
    cleanedBy: "remove-labels",
  });
  if (label.detailsUnavailable) {
    return [finding(webp ? en.label.webp : en.label.damaged, label.fields)];
  }
  const out = [
    finding(
      label.signer
        ? en.label.signed(label.signer, label.signatureMatches)
        : en.label.unsigned(label.signatureMatches),
      label.fields,
    ),
  ];
  // Who made it: the created action's softwareAgent, else another
  // action's; never the claim's generator (the library that wrote the
  // label, still in the fields). No tool named: the created action's own
  // description, if it has one.
  const created = label.actions.find((a) => a.action === "c2pa.created");
  const by = [
    ...(created ? [created] : []),
    ...label.actions.filter((a) => a !== created),
  ].find((a) => a.agent);
  if (by?.agent) {
    const agent = by.agentName
      ? en.label.agent(by.agentName, by.agentVersion)
      : by.agent;
    const when = utcMoment(by.when ?? created?.when ?? null);
    out.push(finding(en.label.madeWith(agent, when)));
  } else if (created?.description) {
    const when = utcMoment(created.when);
    out.push(finding(en.label.says(created.description, when)));
  }
  if (label.watermarkStated) {
    out.push(finding(en.label.watermark(firstWord(label.signer))));
  }
  return out;
}

// --- Text ------------------------------------------------------------------

/** The characters of one kind, each once with how often it appears. */
function charList(hits: CharHit[]): { names: string[]; fields: Field[] } {
  const seen = new Map<number, CharHit[]>();
  for (const h of hits) {
    const list = seen.get(h.codePoint);
    if (list) list.push(h);
    else seen.set(h.codePoint, [h]);
  }
  const names: string[] = [];
  const fields: Field[] = [];
  for (const [cp, list] of seen) {
    const first = list[0];
    if (!first) continue;
    names.push(en.text.char(first.name, cp, list.length));
    fields.push({
      name: first.name,
      value: `${first.note}; ${en.text.at(list.map((h) => h.index))}`,
      from: "Text",
    });
  }
  return { names, fields };
}

export function textFindings(
  plain: string,
  extras: CopyExtras | null,
): Finding[] {
  const hits = scanText(plain);
  const out: Finding[] = [];
  const of = (kind: CharHit["kind"]) => hits.filter((h) => h.kind === kind);
  const hidden = of("hidden");
  if (hidden.length) {
    const { names, fields } = charList(hidden);
    out.push({
      group: "hidden-chars",
      kind: "private",
      sentence: en.text.hidden(hidden.length, names),
      fields,
      cleanedBy: "clean",
    });
  }
  for (const run of decodeRuns(plain)) {
    out.push({
      group: "hidden-chars",
      kind: "private",
      sentence:
        run.how === "tags"
          ? en.text.decodedTags(quote(run.decoded))
          : en.text.decodedSelectors(quote(run.decoded)),
      fields: [{ name: run.how, value: fieldValue(run.decoded), from: "Text" }],
      cleanedBy: "clean",
    });
  }
  const spaces = of("space");
  if (spaces.length) {
    const { names, fields } = charList(spaces);
    out.push({
      group: "hidden-chars",
      kind: "info",
      sentence: en.text.spaces(spaces.length, names),
      fields,
      cleanedBy: "nothing",
    });
  }
  const harmless = of("harmless");
  if (harmless.length) {
    const { names, fields } = charList(harmless);
    out.push({
      group: "hidden-chars",
      kind: "harmless",
      sentence: en.text.harmless(harmless.length, names),
      fields,
      cleanedBy: "nothing",
    });
  }
  if (extras) {
    const extra = (sentence: string, fields: Field[]) =>
      out.push({
        group: "copy-extras",
        kind: "private",
        sentence,
        fields,
        cleanedBy: "clean",
      });
    if (extras.sourceUrl) {
      extra(en.copy.sourceUrl(quote(extras.sourceUrl)), [
        {
          name: "SourceURL",
          value: fieldValue(extras.sourceUrl),
          from: "HTML clipboard header",
        },
      ]);
    }
    if (extras.ids.length) {
      extra(
        en.copy.ids(extras.ids.map(quote)),
        extras.ids.map((value) => ({
          name: "id",
          value,
          from: "HTML fragment",
        })),
      );
    }
    if (extras.classes.length || extras.styles) {
      const fields: Field[] = [];
      if (extras.classes.length) {
        fields.push({
          name: "class",
          value: fieldValue(extras.classes.join(" ")),
          from: "HTML fragment",
        });
      }
      if (extras.styles) {
        fields.push({
          name: "style",
          value: `${extras.styles} elements`,
          from: "HTML fragment",
        });
      }
      extra(en.copy.styling(extras.classes.length, extras.styles), fields);
    }
    if (extras.hiddenStyled) {
      extra(en.copy.hiddenStyled, [
        { name: "style", value: "hidden", from: "HTML fragment" },
      ]);
    }
  }
  return out;
}
