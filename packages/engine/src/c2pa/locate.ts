// Where an image keeps its AI label (C2PA manifest store), found by walking
// the file's own structure: PNG caBX chunk, JPEG APP11 segments (JPEG XT
// boxes holding the JUMBF), WebP C2PA chunk, HEIC uuid box. It needs no
// C2PA parsing, so it also finds a label too damaged to read, and the
// label in a WebP, which c2pa-ts can't read. Never throws.

import { ascii, startsWith } from "../bytes.ts";
import type { ImageType } from "../image/detect.ts";

export interface Range {
  offset: number;
  length: number;
}

/** The label's bytes, header included; a label cut short by the end of the
 * file runs to the end. Null when there's none. */
export function locate(b: Uint8Array, type: ImageType): Range | null {
  try {
    if (type === "png") return png(b);
    if (type === "jpeg") return jpeg(b);
    if (type === "webp") return webp(b);
    return heic(b);
  } catch {
    return null;
  }
}

const view = (b: Uint8Array) =>
  new DataView(b.buffer, b.byteOffset, b.byteLength);
const upTo = (b: Uint8Array, offset: number, end: number): Range => ({
  offset,
  length: Math.min(end, b.length) - offset,
});

function png(b: Uint8Array): Range | null {
  for (let i = 8; i + 8 <= b.length;) {
    const end = i + 12 + view(b).getUint32(i);
    const type = ascii(b, i + 4, i + 8);
    if (type === "caBX") return upTo(b, i, end);
    if (type === "IEND") break;
    i = end;
  }
  return null;
}

const APP11 = 0xeb;
const SOS = 0xda;
const EOI = 0xd9;

/** A JPEG XT segment's box instance (En), when it's the first one of a
 * C2PA manifest store: "JP", En, the sequence number, then a jumb box
 * whose jumd says "c2pa". */
export function c2paInstance(b: Uint8Array, body: number): number | null {
  if (!startsWith(b, body, "JP") || !startsWith(b, body + 12, "jumb")) {
    return null;
  }
  if (!startsWith(b, body + 20, "jumd") || !startsWith(b, body + 24, "c2pa")) {
    return null;
  }
  return view(b).getUint16(body + 2);
}

function jpeg(b: Uint8Array): Range | null {
  let instance: number | null = null;
  let first = -1;
  let last = -1;
  for (let i = 2; i + 4 <= b.length;) {
    if (b[i] !== 0xff) break;
    const marker = b[i + 1] ?? 0;
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === SOS || marker === EOI) break;
    if ((marker >= 0xd0 && marker <= 0xd8) || marker === 0x01) {
      i += 2;
      continue;
    }
    const length = view(b).getUint16(i + 2);
    if (length < 2) break;
    const end = i + 2 + length;
    const body = i + 4;
    if (marker === APP11) {
      instance ??= c2paInstance(b, body);
      const ours =
        instance !== null &&
        startsWith(b, body, "JP") &&
        body + 4 <= b.length &&
        view(b).getUint16(body + 2) === instance;
      if (ours) {
        if (first < 0) first = i;
        last = end;
      }
    }
    if (end > b.length) break;
    i = end;
  }
  return first < 0 ? null : upTo(b, first, last);
}

function webp(b: Uint8Array): Range | null {
  const to = Math.min(b.length, 8 + view(b).getUint32(4, true));
  for (let i = 12; i + 8 <= to;) {
    const size = view(b).getUint32(i + 4, true);
    const next = i + 8 + size + (size % 2);
    if (ascii(b, i, i + 4) === "C2PA") return upTo(b, i, next);
    i = next;
  }
  return null;
}

/** The C2PA uuid box's user type, d8fec3d6-1b0e-483c-9297-5828877ec481. */
const C2PA_UUID = [
  0xd8, 0xfe, 0xc3, 0xd6, 0x1b, 0x0e, 0x48, 0x3c, 0x92, 0x97, 0x58, 0x28, 0x87,
  0x7e, 0xc4, 0x81,
];

function heic(b: Uint8Array): Range | null {
  for (let i = 0; i + 8 <= b.length;) {
    let size = view(b).getUint32(i);
    let header = 8;
    if (size === 1) {
      if (i + 16 > b.length) break;
      size = Number(view(b).getBigUint64(i + 8));
      header = 16;
    } else if (size === 0) {
      size = b.length - i;
    }
    if (size < header) break;
    const user = i + header;
    if (
      ascii(b, i + 4, i + 8) === "uuid" &&
      C2PA_UUID.every((v, k) => b[user + k] === v)
    ) {
      return upTo(b, i, i + size);
    }
    i += size;
  }
  return null;
}
