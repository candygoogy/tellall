// CRC-32, from Photo check's zip.ts (the engine needs only the checksum).

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
