// Helpers for the tools that read files byte by byte.

/** Whether the bytes at `at` spell `text`, a character a byte (a file's
 * magic, a block's name). False where the bytes run out first. */
export const startsWith = (b: Uint8Array, at: number, text: string) => {
  for (let i = 0; i < text.length; i++) {
    if (b[at + i] !== text.charCodeAt(i)) return false;
  }
  return true;
};

/** The bytes from `from` to `to`, a character a byte (Latin-1), a piece
 * at a time: one call with every byte as an argument overflows the stack
 * past about 120,000 of them. */
export function ascii(b: Uint8Array, from = 0, to = b.length): string {
  let out = "";
  const end = Math.min(to, b.length);
  for (let at = from; at < end; at += 8192) {
    out += String.fromCharCode(...b.subarray(at, Math.min(end, at + 8192)));
  }
  return out;
}
