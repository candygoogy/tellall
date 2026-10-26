// A big image is read within the time the engine is allowed (plan, Review
// Focus 5): a 40 MB PNG, made here rather than kept in the repo, read in
// Node with exifr on this thread (inProcessRunner) in under 10 seconds.
// Photo check's version of this file tested its exifr worker, which moves
// to the web page (plan Task 10).
import { crc32, deflateSync } from "node:zlib";
import { expect, test } from "vitest";
import { inProcessRunner, readImage } from "../src/image/read.ts";
import { ascii, exifTiff, pngChunk, xmp } from "./forge.ts";

const SIZE = 40 << 20;
const BUDGET = 10_000;

/** A PNG chunk, with its checksum, for data too big to spread. */
function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(data, crc32(head.subarray(4))));
  return Buffer.concat([head, data, crc]);
}

/** An RGB picture of noise, stored uncompressed so it stays at least
 * `size` bytes, in 64 KB IDAT chunks as encoders write them, with Exif
 * (a place), XMP and a text chunk after its header. */
function bigPng(size: number): Uint8Array {
  const width = 4096;
  const row = 1 + width * 3;
  const height = Math.ceil(size / row);
  const raw = Buffer.alloc(row * height);
  let seed = 1;
  for (let i = 0; i < raw.length; i++) {
    if (i % row === 0) continue; // filter: none
    seed = (seed * 1103515245 + 12345) >>> 0;
    raw[i] = seed >>> 24;
  }
  const zlib = deflateSync(raw, { level: 0 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB
  const idat: Buffer[] = [];
  for (let at = 0; at < zlib.length; at += 1 << 16) {
    idat.push(chunk("IDAT", zlib.subarray(at, at + (1 << 16))));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    Buffer.from(pngChunk("eXIf", exifTiff())),
    Buffer.from(
      pngChunk("iTXt", [...ascii("XML:com.adobe.xmp\0\0\0\0\0"), ...xmp()]),
    ),
    Buffer.from(pngChunk("tEXt", ascii("Comment\0LEAK-COMMENT"))),
    ...idat,
    chunk("IEND", new Uint8Array()),
  ]);
}

test(
  "a 40 MB PNG is read in Node in under 10 seconds",
  { timeout: 60_000 },
  async () => {
    const file = bigPng(SIZE);
    expect(file.length).toBeGreaterThanOrEqual(SIZE);

    const start = performance.now();
    const read = await readImage(file, "png", inProcessRunner());
    const took = performance.now() - start;

    expect(read?.groups.map(([block]) => block)).toEqual([
      "exif",
      "gps",
      "xmp",
      "text",
    ]);
    expect(read?.meta["Comment"]).toBe("LEAK-COMMENT");
    expect(took).toBeLessThan(BUDGET);
  },
);
