// Reading inputs and writing clean copies: a file's first bytes before
// the rest, and a copy that appears whole or not at all.
import { randomBytes } from "node:crypto";
import {
  closeSync,
  fstatSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

/** Enough of a file to tell its kind. */
const HEAD = 64 * 1024;
/** As much as Node reads into one buffer with readFile. */
const MAX = 2 ** 31 - 1;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const HEVC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);
const HEIF_BRANDS = new Set(["mif1", "msf1"]);

const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.subarray(from, to));

/** Whether the engine may read a file that starts with these bytes. The
 * engine's own check (packages/engine/src/image/detect.ts) isn't exported,
 * so this is a copy of it: keep the two in step. If they drift, nothing
 * goes wrong but time: a file this calls unknown and the engine doesn't is
 * read again in full (see `Input.whole`). */
export function mayRead(b: Uint8Array): boolean {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return true;
  }
  if (b.length >= 8 && PNG.every((v, i) => b[i] === v)) return true;
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP")
    return true;
  if (b.length >= 16 && ascii(b, 4, 8) === "ftyp") {
    const major = ascii(b, 8, 12);
    if (AVIF_BRANDS.has(major)) return false;
    const end = Math.min(
      b.length,
      new DataView(b.buffer, b.byteOffset).getUint32(0),
    );
    const brands = [major];
    for (let o = 16; o + 4 <= end; o += 4) brands.push(ascii(b, o, o + 4));
    const any = (set: Set<string>) => brands.some((brand) => set.has(brand));
    if (any(HEVC_BRANDS)) return true;
    if (any(AVIF_BRANDS)) return false;
    if (any(HEIF_BRANDS)) return true;
  }
  return false;
}

/** An error whose message is already a sentence for the user. */
export class Said extends Error {}

/** Reads the file into `into`, from byte `from` on, until `into` is full
 * or the file ends. The bytes read in all. */
function readUpTo(fd: number, into: Uint8Array, from: number): number {
  let got = from;
  while (got < into.length) {
    const n = readSync(fd, into, got, into.length - got, got);
    if (n === 0) break;
    got += n;
  }
  return got;
}

export interface Input {
  bytes: Uint8Array;
  /** False when `bytes` is only the start of a file of a kind tellall
   * can't read: the rest wasn't read. */
  whole: boolean;
}

/** A file's bytes: all of them, or only the first ones when they show a
 * kind of file tellall can't read, whatever its size. With `whole`, all
 * of them in any case. */
export function readInput(path: string, whole = false): Input {
  const fd = openSync(path, "r");
  try {
    const stat = fstatSync(fd);
    // A pipe or a device has no size to go by: read it to its end.
    if (!stat.isFile()) {
      return { bytes: new Uint8Array(readFileSync(fd)), whole: true };
    }
    if (!whole && stat.size > HEAD) {
      const head = new Uint8Array(HEAD);
      const got = readUpTo(fd, head, 0);
      if (!mayRead(head.subarray(0, got))) {
        return { bytes: head.subarray(0, got), whole: false };
      }
    }
    if (stat.size > MAX) {
      throw new Said("it's larger than 2 GiB, more than tellall can read");
    }
    // One buffer of the file's size, read straight into: no copy.
    const all = new Uint8Array(Buffer.allocUnsafeSlow(stat.size).buffer);
    const got = readUpTo(fd, all, 0);
    return {
      bytes: got < all.length ? all.subarray(0, got) : all,
      whole: true,
    };
  } finally {
    closeSync(fd);
  }
}

/** A file's identity, to tell when two names are the same file. */
export function idOf(path: string): string | null {
  try {
    const s = lstatSync(path, { bigint: true });
    // Some file systems (FAT) have no file numbers.
    return s.ino ? `${s.dev}:${s.ino}` : null;
  } catch {
    return null;
  }
}

const exists = (path: string) => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

const eexist = () =>
  Object.assign(new Error("already there"), { code: "EEXIST" });

/** Writes `data` to `target` whole or not at all: into a new temp file
 * beside it, then moved into place. With `replace`, a file already at
 * `target` is replaced (the name is pointed at the new file, so a link
 * to it elsewhere keeps its content); without, it fails with EEXIST and
 * leaves it be. The temp file goes in any case. */
export function writeCopy(
  target: string,
  data: Uint8Array,
  replace: boolean,
): void {
  const temp = join(
    dirname(target),
    `.${basename(target)}.${randomBytes(6).toString("hex")}.tmp`,
  );
  // "wx": a file of that name already there is never written through.
  const fd = openSync(temp, "wx");
  try {
    try {
      let at = 0;
      while (at < data.length) at += writeSync(fd, data, at);
    } finally {
      closeSync(fd);
    }
    if (replace) {
      renameSync(temp, target);
      return;
    }
    try {
      // A new name for the temp file, only if the name is free.
      linkSync(temp, target);
    } catch (e) {
      const code = e instanceof Error && "code" in e ? e.code : undefined;
      if (code === "EEXIST") throw e;
      // No links on this file system: check, then move.
      if (exists(target)) throw eexist();
      renameSync(temp, target);
    }
  } finally {
    rmSync(temp, { force: true });
  }
}

const UTF16 = [
  [0xff, 0xfe, "utf-16le"],
  [0xfe, 0xff, "utf-16be"],
] as const;

/** A text's characters, from UTF-8 or (by its byte-order mark) UTF-16.
 * A byte-order mark is kept, for the scan to see. `invalid` names the
 * encoding when some bytes didn't fit it; they come out as U+FFFD. */
export function decodeText(b: Uint8Array): {
  text: string;
  invalid: string | null;
} {
  const [, , encoding] = UTF16.find(([x, y]) => b[0] === x && b[1] === y) ?? [
    0,
    0,
    "utf-8",
  ];
  const name = encoding === "utf-8" ? "UTF-8" : "UTF-16";
  try {
    const decoder = new TextDecoder(encoding, { fatal: true, ignoreBOM: true });
    return { text: decoder.decode(b), invalid: null };
  } catch {
    const decoder = new TextDecoder(encoding, { ignoreBOM: true });
    return { text: decoder.decode(b), invalid: name };
  }
}
