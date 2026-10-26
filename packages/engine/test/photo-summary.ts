// Photo check's sentences, test-only; replaced by src/words in Task 7.
// What a photo gives away, in words: where, with what, when, edited with
// what, and whose. Read from every block the photo holds (Exif, XMP, IPTC
// and plain text), each value under the names those blocks give it.
import { copy, fill } from "./photo-copy.ts";
import { BLOCKS, type Block, type Meta } from "../src/image/read.ts";

export interface Summary {
  gps?: { lat: number; lon: number };
  /** Named places, smallest first. */
  places: string[];
  make?: string;
  model?: string;
  lens?: string;
  serials: string[];
  date?: string;
  software?: string;
  names: string[];
  contacts: string[];
  captions: string[];
  comments: string[];
  /** 1 to 8, as Exif counts turns and flips; 1 is upright. */
  orientation: number;
  groups: [Block, Meta][];
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

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  !ArrayBuffer.isView(v);

/** Every piece of text in a value: a list's items, an object's values (an
 * XMP language alternative's "value" only). */
function texts(v: unknown): string[] {
  if (typeof v === "string") return v.trim() ? [v.trim()] : [];
  if (typeof v === "number") return [String(v)];
  if (Array.isArray(v)) return v.flatMap(texts);
  if (isObject(v)) {
    return "value" in v ? texts(v["value"]) : Object.values(v).flatMap(texts);
  }
  return [];
}

const str = (v: unknown): string | undefined => texts(v)[0];

/** Each text once, from the first of these fields that has it. */
const from = (m: Meta, keys: string[]) => [
  ...new Set(keys.flatMap((key) => texts(m[key]))),
];

/** Degrees from Exif's [d, m, s], XMP's "51,28.614N", or a plain number;
 * south and west are negative. */
function degrees(value: unknown, ref: unknown): number | undefined {
  let parts: number[];
  let hemisphere = str(ref)?.toUpperCase();
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
  const abs = d + m / 60 + s / 3600;
  const signed = hemisphere === "S" || hemisphere === "W" ? -abs : abs;
  return Math.round(signed * 1e6) / 1e6;
}

/** "2026:10:01 12:00:00" or "2026-10-01T12:00" → "Oct 1, 2026, 12:00". */
function formatDate(value: unknown): string | undefined {
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(
    str(value) ?? "",
  );
  if (!m) return undefined;
  const [, y, mo, d, h, mi] = m;
  const month = MONTHS[Number(mo) - 1];
  if (!month) return undefined;
  const day = `${month} ${Number(d)}, ${y}`;
  return h && mi ? `${day}, ${h}:${mi}` : day;
}

// Fields that name a person: Exif's Artist, Copyright and owner, Windows'
// author, XMP's creator and rights, IPTC's by-line, credit, writer and
// copyright, a PNG's Author.
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
];
// Fields that name a place, smallest first (IPTC and XMP use the same
// names); a country's code only when its name is missing.
const PLACES = ["Sublocation", "Location", "City", "State", "Country"];
const SERIALS = [
  "SerialNumber",
  "BodySerialNumber",
  "CameraSerialNumber",
  "InternalSerialNumber",
  "LensSerialNumber",
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
  "Description",
  "Title",
];
// A JPEG's comments, a PNG's Comment, Exif's and Windows' comments.
const COMMENTS = ["Comment", "UserComment", "XPComment"];

export function summarize(
  meta: Meta | undefined,
  groups?: [Block, Meta][],
): Summary {
  const m = meta ?? {};
  const s: Summary = {
    places: from(m, PLACES),
    serials: from(m, SERIALS),
    names: from(m, NAMES),
    contacts: from(m, CONTACTS),
    captions: from(m, CAPTIONS),
    comments: from(m, COMMENTS),
    orientation: 1,
    groups: groups ?? (meta ? [["exif", meta]] : []),
  };
  if (!s.places.length) s.places = from(m, ["CountryCode"]);
  const lat = degrees(m["GPSLatitude"], m["GPSLatitudeRef"]);
  const lon = degrees(m["GPSLongitude"], m["GPSLongitudeRef"]);
  if (lat !== undefined && lon !== undefined) s.gps = { lat, lon };
  const make = str(m["Make"]);
  const model = str(m["Model"]);
  const lens = str(m["LensModel"]) ?? str(m["Lens"]);
  const date = formatDate(
    m["DateTimeOriginal"] ??
      m["CreateDate"] ??
      m["DateCreated"] ??
      m["ModifyDate"],
  );
  const software = str(m["Software"]) ?? str(m["CreatorTool"]);
  if (make) s.make = make;
  if (model) s.model = model;
  if (lens) s.lens = lens;
  if (date) s.date = date;
  if (software) s.software = software;
  const orientation = Number(m["Orientation"]);
  if (Number.isInteger(orientation) && orientation >= 1 && orientation <= 8) {
    s.orientation = orientation;
  }
  return s;
}

/** "51.4769° N", never split across lines (a no-break space). */
const coordinate = (value: number, positive: string, negative: string) =>
  `${Math.abs(value).toFixed(4)}°\u00a0${value < 0 ? negative : positive}`;

const VERSION_ONLY = /^v?\d+(\.\d+)*$/i;

export function sentences(s: Summary): string[] {
  const out: string[] = [];
  if (s.gps) {
    out.push(
      fill(copy.gps, {
        lat: coordinate(s.gps.lat, "N", "S"),
        lon: coordinate(s.gps.lon, "E", "W"),
      }),
    );
  }
  if (s.places.length) {
    out.push(fill(copy.place, { place: s.places.join(", ") }));
  }
  if (s.make || s.model) {
    // "Canon EOS R6", not "Canon Canon EOS R6": makers often repeat
    // themselves in the model.
    const repeats =
      s.make && s.model?.toLowerCase().startsWith(s.make.toLowerCase());
    const camera =
      s.make && s.model && !repeats
        ? `${s.make} ${s.model}`
        : (s.model ?? s.make ?? "");
    let device = fill(copy.device, { camera });
    if (s.lens) device += fill(copy.lens, { lens: s.lens });
    out.push(device);
  }
  if (s.serials.length) {
    out.push(fill(copy.serial, { serial: s.serials.join(", ") }));
  }
  if (s.date) out.push(fill(copy.date, { date: s.date }));
  // Phones write their system version as the software ("18.1"): that
  // names no editor, so it's left to Show everything.
  if (s.software && !VERSION_ONLY.test(s.software)) {
    out.push(fill(copy.software, { software: s.software }));
  }
  if (s.names.length) out.push(fill(copy.names, { name: s.names.join(", ") }));
  if (s.contacts.length) {
    out.push(fill(copy.contact, { contact: s.contacts.join(", ") }));
  }
  if (s.captions.length) {
    out.push(fill(copy.caption, { caption: s.captions.join(" / ") }));
  }
  if (s.comments.length) {
    out.push(fill(copy.comment, { comment: s.comments.join(" / ") }));
  }
  return out.length ? out : [copy.nothing];
}

// exifr's own readings of the GPS fields, already listed as they're stored.
const DERIVED = new Set(["latitude", "longitude"]);

const isBytes = (v: unknown): v is ArrayLike<number> =>
  ArrayBuffer.isView(v) ||
  (typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.keys(v).length > 0 &&
    Object.keys(v).every((k) => /^\d+$/.test(k)) &&
    Object.values(v).every((n) => Number.isInteger(n) && n >= 0 && n <= 255));

/** A code a field stores, in words, where it's a common one. */
function decoded(key: string, v: unknown): string | null {
  const words = copy.values[key];
  if (words && typeof v === "number") return words[v] ?? null;
  if (key === "Flash" && typeof v === "number") {
    return v & 1 ? copy.flash.fired : copy.flash.not;
  }
  if (key === "ComponentsConfiguration" && isBytes(v)) {
    const channels = Array.from(v)
      .map((n) => copy.channels[n])
      .filter(Boolean);
    return channels.length ? channels.join(", ") : null;
  }
  return null;
}

/** One value as text: a version or code stored as bytes reads as its
 * letters ("0230"), other bytes as numbers, lists comma-separated. */
function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(", ") || null;
  if (isBytes(v)) {
    const bytes = Array.from(v as ArrayLike<number>);
    if (bytes.length > 64) return null; // binary data, not a value
    const printable = bytes.every((b) => b >= 0x20 && b < 0x7f);
    return printable ? String.fromCharCode(...bytes) : bytes.join(", ");
  }
  // An XMP language alternative: its text.
  if (isObject(v) && "value" in v) return asText(v["value"]);
  return null;
}

/** A field's name as a label: "creator" → "Creator". */
const label = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);

/** One field as rows: an object (XMP's contact details, say) becomes a
 * row per part, "CreatorContactInfo.CiEmailWork". */
function rows(key: string, value: unknown): [string, string][] {
  const words = decoded(key, value);
  if (words) return [[label(key), words]];
  if (isObject(value) && !("value" in value) && !isBytes(value)) {
    return Object.entries(value).flatMap(([k, v]) =>
      rows(`${label(key)}.${k}`, v),
    );
  }
  const text = asText(value);
  return text === null ? [] : [[label(key), text]];
}

export interface Detail {
  block: Block;
  rows: [string, string][];
}

/** Everything the photo holds, by block, as label and text, for "Show
 * everything". */
export function details(s: Summary): Detail[] {
  return s.groups
    .map(([block, fields]) => ({
      block,
      rows: Object.entries(fields).flatMap(([key, value]) =>
        DERIVED.has(key) ? [] : rows(key, value),
      ),
    }))
    .filter((d) => d.rows.length)
    .sort((x, y) => BLOCKS.indexOf(x.block) - BLOCKS.indexOf(y.block));
}
