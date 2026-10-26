// A colour profile made up for the tests: sharp's own P3 colours, with
// words, a date, a creator, private tags, bytes between tags and padding
// inside one, each marked LEAK.
import sharp from "sharp";
import { u32 } from "./craft.ts";
import { ascii } from "./forge.ts";
import { image } from "./gradient.ts";

/** Whether the text is there, as bytes or as UTF-16 either way round. */
export function has(b: Uint8Array, s: string) {
  const buf = Buffer.from(b);
  const be = Buffer.from(s, "utf16le").swap16();
  return (
    buf.toString("latin1").includes(s) ||
    buf.includes(Buffer.from(s, "utf16le")) ||
    buf.includes(be)
  );
}
export const LEAKS = (b: Uint8Array) => has(b, "LEAK");

/** sharp's own P3 profile, as bytes. */
export async function p3Profile(): Promise<Uint8Array> {
  const tagged = await image().png().withIccProfile("p3").toBuffer();
  const meta = await sharp(tagged).metadata();
  if (!meta.icc) throw new Error("no profile");
  return new Uint8Array(meta.icc);
}

/** UTF-16 text as a multiLocalizedUnicode tag. */
function mluc(text: string): number[] {
  const utf16 = [...Buffer.from(text, "utf16le").swap16()];
  return [
    ...ascii("mluc"),
    ...u32(0),
    ...u32(1),
    ...u32(12),
    ...ascii("enUS"),
    ...u32(utf16.length),
    ...u32(28),
    ...utf16,
  ];
}
/** A version 2 description: ASCII, then empty Unicode and ScriptCode. */
const desc = (text: string) => [
  ...ascii("desc"),
  ...u32(0),
  ...u32(text.length + 1),
  ...ascii(text),
  0,
  ...new Array<number>(4 + 4 + 2 + 1 + 67).fill(0),
];

/**
 * A profile built from P3's colours, carrying words, a date, a creator,
 * private tags, bytes between tags and padding inside one, all marked.
 * Big adds a large private tag, so it needs more than one JPEG segment.
 */
export async function crafted(big = false): Promise<Uint8Array> {
  const p3 = await p3Profile();
  const view = new DataView(p3.buffer, p3.byteOffset, p3.byteLength);
  const tags = new Map<string, number[]>();
  for (let i = 0; i < view.getUint32(128); i++) {
    const at = 132 + i * 12;
    const sig = Buffer.from(p3.subarray(at, at + 4)).toString("latin1");
    const offset = view.getUint32(at + 4);
    const size = view.getUint32(at + 8);
    tags.set(sig, [...p3.subarray(offset, offset + size)]);
  }
  // The curve, with marked padding after its parameters.
  const curve = [...(tags.get("rTRC") ?? []), ...ascii("LEAK-CURVE-PAD")];
  const list: [string, number[]][] = [
    ["desc", mluc("LEAK-DESC Jane's MacBook")],
    ["cprt", mluc("LEAK-CPRT Jane Doe")],
    ["dmnd", desc("LEAK-DMND Maker")],
    ["dmdd", [...ascii("text"), ...u32(0), ...ascii("LEAK-DMDD Model\0")]],
    ["mmod", [...ascii("mmod"), ...u32(0), ...ascii("LEAK-MMOD-SERIAL")]],
    ["calt", [...ascii("dtim"), ...u32(0), ...ascii("LEAK-DATE!!!")]],
    ["wtpt", tags.get("wtpt") ?? []],
    ["chad", tags.get("chad") ?? []],
    ["rXYZ", tags.get("rXYZ") ?? []],
    ["gXYZ", tags.get("gXYZ") ?? []],
    ["bXYZ", tags.get("bXYZ") ?? []],
    ["rTRC", curve],
    ...(big
      ? [
          [
            "zzzz",
            [...ascii("zzzz"), ...u32(0), ...ascii("LEAK".repeat(20_000))],
          ] as [string, number[]],
        ]
      : []),
  ];
  // Tags after the table, each on a 4-byte boundary, a marked gap between
  // two of them; the green and blue curves share the red one's bytes.
  const count = list.length + 2;
  let at = 132 + count * 12;
  const table: number[] = [];
  const data: number[] = [];
  const offsets = new Map<string, [number, number]>();
  for (const [sig, body] of list) {
    if (sig === "chad") {
      const gap = ascii("LEAK-GAP");
      data.push(...gap);
      at += gap.length;
    }
    offsets.set(sig, [at, body.length]);
    table.push(...ascii(sig), ...u32(at), ...u32(body.length));
    data.push(...body);
    const pad = (4 - (body.length % 4)) % 4;
    data.push(...new Array<number>(pad).fill(0));
    at += body.length + pad;
  }
  const [curveAt] = offsets.get("rTRC") ?? [0];
  // The shared curves point at the real parameters, not the padding.
  const curveSize = (tags.get("rTRC") ?? []).length;
  for (const sig of ["gTRC", "bTRC"]) {
    table.push(...ascii(sig), ...u32(curveAt), ...u32(curveSize));
  }
  const header = [...p3.subarray(0, 128)];
  header.splice(24, 12, ...ascii("LEAK-DATE..."));
  header.splice(48, 4, ...ascii("LEAK"));
  header.splice(52, 4, ...ascii("LEAK"));
  header.splice(80, 4, ...ascii("LEAK"));
  header.splice(84, 16, ...ascii("LEAK-PROFILE-ID!"));
  header.splice(100, 28, ...ascii("LEAK-RESERVED".padEnd(28, ".")));
  const out = [...header, ...u32(count), ...table, ...data];
  out.splice(0, 4, ...u32(out.length));
  return new Uint8Array(out);
}
