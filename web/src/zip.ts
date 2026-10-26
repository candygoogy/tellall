// From Photo check (candygoogy/experiments, photo/src/zip.ts), MIT, same author.

// Several clean copies as one .zip, each stored as it is: the photos are
// compressed already. The archive is put together from the copies
// themselves, so it never holds a second copy of them all: each is read
// once, for its checksum, and only one is in memory at a time.

/** A file to put in the archive. */
export interface Entry {
  name: string;
  blob: Blob;
}

// A checksum's work is cut into pieces this big, with a pause between
// them, so a big photo never holds the page.
const PIECE = 1 << 20;

let table: Uint32Array | undefined;

/** CRC-32 (the checksum zip files keep for each file, and PNG for each
 * chunk), carried on from `crc` for a file read in pieces. */
export function crc32(bytes: Uint8Array, crc = 0): number {
  table ??= Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let c = ~crc;
  for (let i = 0; i < bytes.length; i++) {
    c = (table[(c ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return ~c >>> 0;
}

/** Each name once: a second "a.jpg" becomes "a (2).jpg". Names that differ
 * only in case count as the same, as they do on Windows and macOS, where
 * one would overwrite the other when unzipped; each keeps its own case. */
export function uniqueNames(names: string[]): string[] {
  const taken = new Set<string>();
  return names.map((wanted) => {
    let name = wanted;
    const dot = wanted.lastIndexOf(".");
    for (let n = 2; taken.has(name.toLowerCase()); n++) {
      name =
        dot > 0
          ? `${wanted.slice(0, dot)} (${n})${wanted.slice(dot)}`
          : `${wanted} (${n})`;
    }
    taken.add(name.toLowerCase());
    return name;
  });
}

/** The time and date as zip files keep them (local time, to 2 seconds). */
function dosTime(d: Date): [number, number] {
  return [
    (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  ];
}

/** Lets the page draw and answer, between photos or pieces of one. */
export const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));

// A 4-byte size or offset, or a 2-byte count of files, that doesn't fit
// says so with all its bits set, and the real number goes in a zip64
// record (APPNOTE 4.5.3, 4.3.14): an archive past 4 GiB, or of more than
// 65,534 files. Only then, so an archive that fits is written as it
// always was, for readers that know nothing of zip64.
const FULL = 0xffffffff;
const FULL_COUNT = 0xffff;

/** The archive, made of the files' own blobs and the zip records between
 * them (APPNOTE 4.3: a local header before each file, then the central
 * directory and its end). `limit` is the first size or offset a 4-byte
 * field can't hold; a test passes a smaller one to see the zip64 records
 * without a 4 GiB archive. */
export async function zip(
  entries: Entry[],
  now = new Date(),
  limit = FULL,
): Promise<Blob> {
  const encoder = new TextEncoder();
  const [time, date] = dosTime(now);
  const names = uniqueNames(entries.map((e) => e.name));
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const [i, entry] of entries.entries()) {
    const bytes = new Uint8Array(await entry.blob.arrayBuffer());
    let crc = 0;
    for (let at = 0; at < bytes.length; at += PIECE) {
      crc = crc32(bytes.subarray(at, at + PIECE), crc);
      if (at + PIECE < bytes.length) await breathe();
    }
    const name = encoder.encode(names[i] ?? entry.name);
    // Bit 11: the name is UTF-8, said only when it isn't plain ASCII.
    const flags = name.length !== (names[i] ?? entry.name).length ? 0x800 : 0;
    const size = bytes.length;
    // Too big for their fields: the file's size (twice, stored and as it
    // is), and where its local header starts.
    const big = size >= limit;
    const far = offset >= limit;
    // Version needed: 2.0, or 4.5 for zip64.
    const version = big || far ? 45 : 20;

    // The local header's zip64 field holds both sizes, or isn't there.
    const localExtra = big ? 20 : 0;
    const local = new Uint8Array(30 + name.length + localExtra);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, version, true);
    l.setUint16(6, flags, true);
    l.setUint16(8, 0, true); // stored, not compressed
    l.setUint16(10, time, true);
    l.setUint16(12, date, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, big ? FULL : size, true);
    l.setUint32(22, big ? FULL : size, true);
    l.setUint16(26, name.length, true);
    l.setUint16(28, localExtra, true);
    local.set(name, 30);
    if (big) {
      const at = 30 + name.length;
      l.setUint16(at, 1, true); // zip64
      l.setUint16(at + 2, 16, true);
      l.setBigUint64(at + 4, BigInt(size), true);
      l.setBigUint64(at + 12, BigInt(size), true);
    }

    // The central record's holds only what its own fields can't, in
    // order: the size as it is, the stored size, the offset.
    const wide = [...(big ? [size, size] : []), ...(far ? [offset] : [])];
    const extra = wide.length ? 4 + 8 * wide.length : 0;
    const record = new Uint8Array(46 + name.length + extra);
    const r = new DataView(record.buffer);
    r.setUint32(0, 0x02014b50, true);
    r.setUint16(4, version, true); // made by: the same
    r.setUint16(6, version, true);
    r.setUint16(8, flags, true);
    r.setUint16(10, 0, true);
    r.setUint16(12, time, true);
    r.setUint16(14, date, true);
    r.setUint32(16, crc, true);
    r.setUint32(20, big ? FULL : size, true);
    r.setUint32(24, big ? FULL : size, true);
    r.setUint16(28, name.length, true);
    r.setUint16(30, extra, true);
    r.setUint32(42, far ? FULL : offset, true);
    record.set(name, 46);
    if (extra) {
      const at = 46 + name.length;
      r.setUint16(at, 1, true); // zip64
      r.setUint16(at + 2, 8 * wide.length, true);
      wide.forEach((n, k) => r.setBigUint64(at + 4 + 8 * k, BigInt(n), true));
    }

    parts.push(local, entry.blob);
    central.push(record);
    offset += local.length + size;
  }
  const count = entries.length;
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const many = count >= FULL_COUNT;
  const bigCentral = centralSize >= limit;
  const farCentral = offset >= limit;

  // The zip64 end record and where it is (APPNOTE 4.3.14, 4.3.15), just
  // before the end record, when the end record can't say it all.
  const tail: Uint8Array<ArrayBuffer>[] = [];
  if (many || bigCentral || farCentral) {
    const end64 = new Uint8Array(56 + 20);
    const z = new DataView(end64.buffer);
    z.setUint32(0, 0x06064b50, true);
    z.setBigUint64(4, 44n, true); // the size of the rest of it
    z.setUint16(12, 45, true); // made by: 4.5
    z.setUint16(14, 45, true); // version needed: 4.5
    z.setBigUint64(24, BigInt(count), true); // files on this disk
    z.setBigUint64(32, BigInt(count), true); // and in all
    z.setBigUint64(40, BigInt(centralSize), true);
    z.setBigUint64(48, BigInt(offset), true);
    z.setUint32(56, 0x07064b50, true);
    z.setBigUint64(64, BigInt(offset + centralSize), true);
    z.setUint32(72, 1, true); // one disk
    tail.push(end64);
  }
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, many ? FULL_COUNT : count, true);
  e.setUint16(10, many ? FULL_COUNT : count, true);
  e.setUint32(12, bigCentral ? FULL : centralSize, true);
  e.setUint32(16, farCentral ? FULL : offset, true);
  tail.push(end);
  return new Blob([...parts, ...central, ...tail], {
    type: "application/zip",
  });
}
