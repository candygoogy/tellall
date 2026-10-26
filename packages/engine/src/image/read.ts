// Reads a photo's metadata. The page finds each block itself, with the
// same walk through the file the clean copy uses, so what the summary
// reads is what the clean copy removes: Exif (as a TIFF block), XMP
// packets, Photoshop's IPTC, and plain text (a JPEG's comments, a PNG's
// text chunks, compressed ones included). exifr, loaded only when a photo
// has any of these, then reads each block on its own, so "Show everything"
// can say where each value came from. No block has to fit in one JPEG
// segment (64 KB): a large one is read in full.
import { ascii, startsWith } from "../bytes.ts";
import type { ImageType } from "./detect.ts";
import { readJobs, type Answer, type Job, type Meta } from "./exif.ts";
import { exifTiff, heifMeta, itemBytes } from "./heif.ts";
import { join, segments } from "./strip/jpeg.ts";
import { chunks as pngChunks } from "./strip/png.ts";

export type { Meta };

/** Where a value came from, in the order "Show everything" lists them. */
export type Block = "exif" | "gps" | "xmp" | "iptc" | "text";
export const BLOCKS: Block[] = ["exif", "gps", "xmp", "iptc", "text"];

export interface Read {
  /** Every value, the first of each name winning, in BLOCKS order. */
  meta: Meta;
  groups: [Block, Meta][];
}

/** Hands a photo's blocks to exifr, and gives back what it made of each,
 * in order. */
export type Runner = (jobs: Job[]) => Promise<Answer[]>;

/** exifr couldn't be loaded (a page gone offline, or replaced since it
 * opened): the engine's own failure, never a sign the file is damaged. */
export class ReaderMissing extends Error {}

/** exifr's readers. In the browser it's a module with named exports; in
 * Node (the page's build) it can come as CommonJS, everything on its
 * default. */
async function exifr() {
  const m = await import("exifr").catch((cause: unknown) => {
    throw new ReaderMissing("tellall's metadata reader couldn't load.", {
      cause,
    });
  });
  return {
    parse: m.parse ?? m.default.parse,
    sidecar: m.sidecar ?? m.default.sidecar,
  };
}

/** exifr on this thread, with no worker of its own: Node, and the worker
 * the engine itself runs in. */
export const inProcessRunner = (): Runner => async (jobs) =>
  readJobs(await exifr(), jobs);

/** The metadata blocks found in a photo. */
interface Blocks {
  /** Whether a block was there but couldn't be taken out to be read. */
  unreadable?: true;
  /** Exif, each a TIFF block. */
  tiff: Uint8Array[];
  /** XMP packets. */
  xmp: Uint8Array[];
  /** Photoshop's image resources, where IPTC lives. */
  irb: Uint8Array[];
  /** Plain text: a name and its value. */
  text: [string, string][];
}

const empty = (): Blocks => ({ tiff: [], xmp: [], irb: [], text: [] });

/** Bytes as Latin-1 text. */
const latin1 = (b: Uint8Array) => ascii(b);
const utf8 = (b: Uint8Array) => new TextDecoder().decode(b);
const EXIF = "Exif\0\0";
const XMP = "http://ns.adobe.com/xap/1.0/\0";
const XMP_EXTENSION = "http://ns.adobe.com/xmp/extension/\0";
const PHOTOSHOP = "Photoshop 3.0\0";

/** A JPEG's blocks, wherever they sit: before the picture, between its
 * scans, or after them. */
function jpegBlocks(b: Uint8Array): Blocks {
  const out = empty();
  // Extended XMP comes in parts, put back together by id and offset.
  const extended = new Map<string, [number, Uint8Array][]>();
  for (const { marker, body, end } of segments(b).list) {
    if (marker === 0xe1 && startsWith(b, body, EXIF)) {
      out.tiff.push(b.subarray(body + EXIF.length, end));
    } else if (marker === 0xe1 && startsWith(b, body, XMP)) {
      out.xmp.push(b.subarray(body + XMP.length, end));
    } else if (marker === 0xe1 && startsWith(b, body, XMP_EXTENSION)) {
      const at = body + XMP_EXTENSION.length;
      if (at + 40 > end) continue;
      const id = latin1(b.subarray(at, at + 32));
      const offset = new DataView(b.buffer, b.byteOffset).getUint32(at + 36);
      extended.set(id, [
        ...(extended.get(id) ?? []),
        [offset, b.subarray(at + 40, end)],
      ]);
    } else if (marker === 0xed && startsWith(b, body, PHOTOSHOP)) {
      out.irb.push(b.subarray(body + PHOTOSHOP.length, end));
    } else if (marker === 0xfe) {
      out.text.push(["Comment", utf8(b.subarray(body, end))]);
    }
  }
  for (const parts of extended.values()) {
    out.xmp.push(join(parts.sort((x, y) => x[0] - y[0]).map(([, p]) => p)));
  }
  return out;
}

/** The most one compressed text chunk may inflate to. */
const CHUNK_LIMIT = 8 << 20;
/** The most a PNG's compressed text may inflate to all together, so
 * thousands of small chunks can't fill the tab's memory either. */
const TEXT_LIMIT = 32 << 20;

/** Inflates zlib data, or null when it's broken, grows past 8 MB, or
 * grows past what the file has left to inflate (`allowance`, which it
 * draws down: once that has run out, nothing more is inflated). */
async function inflate(
  data: Uint8Array,
  allowance: { left: number },
): Promise<Uint8Array | null> {
  if (allowance.left < 0) return null;
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    const reader = new Blob([data as Uint8Array<ArrayBuffer>])
      .stream()
      .pipeThrough(new DecompressionStream("deflate"))
      .getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      allowance.left -= value.length;
      if (total > CHUNK_LIMIT || allowance.left < 0) {
        await reader.cancel();
        return null;
      }
      parts.push(value);
    }
  } catch {
    return null;
  }
  return join(parts);
}

/** ImageMagick's "Raw profile type …" text: a name, a length, then hex. */
function rawProfile(text: string): Uint8Array | null {
  const [, , length, ...hex] = text.split("\n");
  const digits = hex.join("").replace(/\s+/g, "");
  const n = Number(length);
  if (!Number.isInteger(n) || n <= 0 || digits.length < n * 2) return null;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const byte = Number.parseInt(digits.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
}

/** IPTC on its own, wrapped as the Photoshop resource it'd be in a JPEG. */
function iptcResource(iim: Uint8Array): Uint8Array {
  const head = new Uint8Array(12);
  head.set([0x38, 0x42, 0x49, 0x4d, 0x04, 0x04]); // "8BIM", IPTC
  new DataView(head.buffer).setUint32(8, iim.length);
  return join([head, iim, new Uint8Array(iim.length % 2)]);
}

/** Compressed text that can't be read: broken, or past a size limit. */
const UNREADABLE = "unreadable";

/** One text chunk's name and value, compressed or not; null when it isn't
 * a text chunk at all, UNREADABLE when its text can't be inflated. */
async function pngText(
  type: string,
  data: Uint8Array,
  allowance: { left: number },
): Promise<[string, Uint8Array] | null | typeof UNREADABLE> {
  const zero = data.indexOf(0);
  if (zero < 0) return null;
  const name = latin1(data.subarray(0, zero));
  let rest = data.subarray(zero + 1);
  if (type === "zTXt")
    return wrap(name, await inflate(rest.subarray(1), allowance));
  if (type === "iTXt") {
    const compressed = rest[0] === 1;
    rest = rest.subarray(2);
    // The language and the translated name, each ending in a zero.
    for (let n = 0; n < 2; n++) {
      const end = rest.indexOf(0);
      if (end < 0) return null;
      rest = rest.subarray(end + 1);
    }
    return wrap(name, compressed ? await inflate(rest, allowance) : rest);
  }
  return [name, rest];
}

const wrap = (name: string, value: Uint8Array | null) =>
  value ? ([name, value] as [string, Uint8Array]) : UNREADABLE;

/** A PNG's blocks: its Exif chunk, and what its text chunks hold. Its
 * compressed text inflates to `limit` bytes at most, all together: past
 * it, the rest is unreadable. */
export async function pngBlocks(
  b: Uint8Array,
  limit = TEXT_LIMIT,
): Promise<Blocks> {
  const out = empty();
  const allowance = { left: limit };
  for (const c of pngChunks(b).list) {
    const data = b.subarray(c.data, c.end - 4);
    if (c.type === "eXIf" || c.type === "exIf") {
      out.tiff.push(startsWith(data, 0, EXIF) ? data.subarray(6) : data);
      continue;
    }
    if (c.type !== "tEXt" && c.type !== "zTXt" && c.type !== "iTXt") continue;
    const found = await pngText(c.type, data, allowance);
    if (found === UNREADABLE) out.unreadable = true;
    if (!found || found === UNREADABLE) continue;
    const [name, value] = found;
    if (name === "XML:com.adobe.xmp") {
      out.xmp.push(value);
      continue;
    }
    const raw = /^Raw profile type (\w+)$/i.exec(name)?.[1]?.toLowerCase();
    if (raw) {
      const profile = rawProfile(latin1(value));
      if (!profile) continue;
      if (startsWith(profile, 0, EXIF)) out.tiff.push(profile.subarray(6));
      else if (startsWith(profile, 0, XMP)) {
        out.xmp.push(profile.subarray(XMP.length));
      } else if (raw === "exif") out.tiff.push(profile);
      else if (raw === "xmp") out.xmp.push(profile);
      else if (raw === "8bim") out.irb.push(profile);
      else if (raw === "iptc") {
        out.irb.push(
          startsWith(profile, 0, "8BIM") ? profile : iptcResource(profile),
        );
      }
      continue;
    }
    out.text.push([name, c.type === "tEXt" ? latin1(value) : utf8(value)]);
  }
  return out;
}

/** A WebP's EXIF and XMP chunks, to the file's real end: past the size it
 * declares too, and inside animation frames. */
function webpBlocks(b: Uint8Array): Blocks {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = empty();
  const walk = (from: number, to: number) => {
    for (let i = from; i + 8 <= to;) {
      const type = latin1(b.subarray(i, i + 4));
      const size = view.getUint32(i + 4, true);
      let body = b.subarray(i + 8, Math.min(to, i + 8 + size));
      if (type === "EXIF") {
        // Some writers keep JPEG's "Exif\0\0" prefix in the chunk.
        if (startsWith(body, 0, EXIF)) body = body.subarray(6);
        out.tiff.push(body);
      } else if (type === "XMP ") out.xmp.push(body);
      else if (type === "ANMF") walk(i + 8 + 16, i + 8 + body.length);
      i += 8 + size + (size % 2);
    }
  };
  walk(12, b.length);
  return out;
}

/** A HEIC's Exif and its own XMP items. */
function heicBlocks(b: Uint8Array): Blocks {
  const { exif, xmp } = heifMeta(b);
  const out = empty();
  for (const item of exif) {
    const tiff = exifTiff(itemBytes(b, item));
    if (tiff) out.tiff.push(tiff);
  }
  for (const item of xmp) {
    const packet = itemBytes(b, item);
    // A packet blanked by a clean copy holds only spaces.
    if (packet.some((c) => c > 0x20)) out.xmp.push(packet);
  }
  return out;
}

const asBytes = (value: unknown) =>
  value instanceof Uint8Array
    ? value
    : Array.isArray(value) && value.every((n) => Number.isInteger(n))
      ? Uint8Array.from(value as number[])
      : null;

/** Exif fields that hold text as bytes, as text: Windows' XP fields
 * (UTF-16), and UserComment, whose first 8 bytes name its encoding. */
function textFields(meta: Meta) {
  for (const [key, value] of Object.entries(meta)) {
    const bytes = asBytes(value);
    if (!bytes) continue;
    let text: string | undefined;
    if (key.startsWith("XP")) text = new TextDecoder("utf-16le").decode(bytes);
    else if (key === "UserComment") {
      const rest = bytes.subarray(8);
      text = startsWith(bytes, 0, "UNICODE")
        ? new TextDecoder("utf-16le").decode(rest)
        : startsWith(bytes, 0, "ASCII")
          ? latin1(rest)
          : new TextDecoder().decode(rest);
    }
    if (text !== undefined) meta[key] = text.replace(/\0+/g, "").trim();
  }
}

const isObject = (v: unknown): v is Meta =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Each block read on its own, kept by where it came from, and put
 * together for the summary: the first value of a name wins. */
async function readBlocks(
  blocks: Blocks,
  run: Runner,
): Promise<Read | undefined> {
  const { tiff, xmp, irb, text } = blocks;
  const groups = new Map<Block, Meta>(BLOCKS.map((g) => [g, {}]));
  const add = (block: Block, fields: Meta) => {
    const group = groups.get(block) ?? {};
    for (const [key, value] of Object.entries(fields)) {
      if (!(key in group)) group[key] = value;
    }
  };
  let failed = blocks.unreadable === true;
  const jobs: Job[] = tiff.map((bytes) => ({ kind: "tiff", bytes }));
  for (const block of irb) {
    // Read as the JPEG segment it would be in.
    const head = new TextEncoder().encode(PHOTOSHOP);
    const length = head.length + block.length + 2;
    if (length > 0xffff) continue;
    const jpeg = join([
      new Uint8Array([0xff, 0xd8, 0xff, 0xed, length >> 8, length & 0xff]),
      head,
      block,
      new Uint8Array([0xff, 0xd9]),
    ]);
    jobs.push({ kind: "iptc", bytes: jpeg });
  }
  for (const bytes of xmp) jobs.push({ kind: "xmp", bytes });
  const answers = jobs.length ? await run(jobs) : [];
  for (const [i, { kind }] of jobs.entries()) {
    const answer = answers[i];
    if (!answer) failed = true;
    const out = answer ?? {};
    if (kind === "xmp") {
      // XMP alone comes back grouped by namespace: one group here.
      for (const [ns, fields] of Object.entries(out)) {
        if (ns !== "xmlns" && isObject(fields)) add("xmp", fields);
      }
      continue;
    }
    if (Array.isArray(out["errors"]) && out["errors"].length) failed = true;
    if (kind === "iptc") {
      if (isObject(out["iptc"])) add("iptc", out["iptc"]);
      continue;
    }
    for (const part of ["ifd0", "exif"]) {
      const fields = out[part];
      if (isObject(fields)) {
        textFields(fields);
        add("exif", fields);
      }
    }
    // exifr hands the comment over on its own, as bytes.
    if (out["userComment"] !== undefined) {
      const comment = { UserComment: out["userComment"] };
      textFields(comment);
      add("exif", comment);
    }
    if (isObject(out["gps"])) add("gps", out["gps"]);
  }
  // Text can repeat a name (a JPEG's comments): each value is kept.
  const plain = groups.get("text") ?? {};
  for (const [name, value] of text) {
    if (!value.trim()) continue;
    const before = plain[name];
    plain[name] =
      before === undefined ? value.trim() : [before, value.trim()].flat();
  }

  const meta: Meta = {};
  const found: [Block, Meta][] = [];
  for (const [block, fields] of groups) {
    if (!Object.keys(fields).length) continue;
    found.push([block, fields]);
    for (const [key, value] of Object.entries(fields)) {
      if (!(key in meta)) meta[key] = value;
    }
  }
  if (failed && !found.length) {
    throw new Error("The photo's details can't be read.");
  }
  return found.length ? { meta, groups: found } : undefined;
}

/** The photo's metadata, by block (undefined when it has none). Throws
 * when the file claims to hold details that can't be read. */
export async function readImage(
  bytes: Uint8Array,
  type: ImageType,
  run: Runner = inProcessRunner(),
): Promise<Read | undefined> {
  if (type === "jpeg") return readBlocks(jpegBlocks(bytes), run);
  if (type === "png") return readBlocks(await pngBlocks(bytes), run);
  if (type === "webp") return readBlocks(webpBlocks(bytes), run);
  return readBlocks(heicBlocks(bytes), run);
}

/** The photo's metadata, every block together. */
export async function readMeta(
  bytes: Uint8Array,
  type: ImageType,
): Promise<Meta | undefined> {
  return (await readImage(bytes, type))?.meta;
}
