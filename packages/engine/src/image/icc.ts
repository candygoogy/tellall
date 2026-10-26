// A colour profile (ICC), cleaned. The picture's colours are drawn with
// it, so it stays, but a profile is more than its colours: a display's
// own profile names the display (its maker, its model, a calibration's
// name and date), and any tag can carry anything. So a profile is written
// anew, the same length, from its parts:
// - the header, with its date, its creator, the device's maker and model,
//   its profile ID (which may be left as zeros) and its reserved bytes
//   zeroed;
// - the tag table, as it was;
// - the tags colours are drawn with (colorants, curves, white and black
//   points, chromatic adaptation, the conversion tables, primaries,
//   luminance, cicp), each only as long as its type needs;
// - every other tag kept as an empty value of its type: a description or
//   a text with no words, any other kind with zeros after its type;
// - zeros everywhere else, between the tags and after them.
// Readers that draw colours (skcms in Chromium, lcms, qcms, ColorSync)
// read only the kept tags, so colours come out exactly as before.

/** Tags colours are drawn with: kept as they are. */
const DRAWN = new Set([
  "rXYZ",
  "gXYZ",
  "bXYZ",
  "rTRC",
  "gTRC",
  "bTRC",
  "kTRC",
  "wtpt",
  "bkpt",
  "chad",
  "chrm",
  "lumi",
  "cicp",
  "gamt",
  "A2B0",
  "A2B1",
  "A2B2",
  "B2A0",
  "B2A1",
  "B2A2",
  "D2B0",
  "D2B1",
  "D2B2",
  "D2B3",
  "B2D0",
  "B2D1",
  "B2D2",
  "B2D3",
  "pre0",
  "pre1",
  "pre2",
]);

const HEADER = 128;
// Header fields that say nothing about colours: [start, end).
const BLANKED_HEADER: [number, number][] = [
  [24, 36], // the date it was made
  [48, 56], // the device's maker and model
  [80, 100], // its creator, and its ID (a checksum, zeros allowed)
  [100, 128], // reserved, always zeros
];
// How many parameters each kind of parametric curve has.
const PARAMETERS = [1, 3, 4, 5, 7];

const fourcc = (b: Uint8Array, at: number) =>
  String.fromCharCode(
    b[at] ?? 0,
    b[at + 1] ?? 0,
    b[at + 2] ?? 0,
    b[at + 3] ?? 0,
  );

/** How many of a drawn tag's bytes its type uses; the rest is padding. */
function used(view: DataView, at: number, size: number): number {
  const type = fourcc(new Uint8Array(view.buffer, view.byteOffset), at);
  const u16 = (n: number) => (n + 2 <= size ? view.getUint16(at + n) : 0);
  const u32 = (n: number) => (n + 4 <= size ? view.getUint32(at + n) : 0);
  let needed = size;
  if (type === "XYZ ")
    needed = 20; // one XYZ value
  else if (type === "curv") needed = 12 + 2 * u32(8);
  else if (type === "para") {
    const n = PARAMETERS[u16(8)];
    if (n !== undefined) needed = 12 + 4 * n;
  } else if (type === "sf32")
    needed = 8 + 9 * 4; // a 3 × 3 matrix
  else if (type === "cicp") needed = 12;
  else if (type === "chrm") needed = 12 + 8 * u16(8);
  return Math.min(size, needed);
}

/** A tag colours aren't drawn with, emptied: its type, then no words. */
function emptied(
  out: Uint8Array,
  original: Uint8Array,
  at: number,
  size: number,
) {
  if (size < 4) return;
  const type = fourcc(original, at);
  out.set(original.subarray(at, at + 4), at);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  if (type === "desc" && size >= 12) {
    // An ASCII description one byte long: its ending zero.
    view.setUint32(at + 8, 1);
  } else if (type === "mluc" && size >= 28) {
    // One record, en-US, of no characters.
    view.setUint32(at + 8, 1);
    view.setUint32(at + 12, 12);
    out.set([0x65, 0x6e, 0x55, 0x53], at + 16); // "enUS"
    view.setUint32(at + 20, 0);
    view.setUint32(at + 24, 28);
  } else if (type === "mluc" && size >= 16) {
    view.setUint32(at + 12, 12); // no records
  }
}

/** The profile cleaned, as long as it says it is; null when it isn't a
 * profile a reader would use (so no reader draws with it anyway). */
export function cleanIcc(profile: Uint8Array): Uint8Array | null {
  if (profile.length < HEADER + 4) return null;
  const view = new DataView(
    profile.buffer,
    profile.byteOffset,
    profile.byteLength,
  );
  const size = view.getUint32(0);
  if (size < HEADER + 4 || size > profile.length) return null;
  if (fourcc(profile, 36) !== "acsp") return null;
  const count = view.getUint32(HEADER);
  const tableEnd = HEADER + 4 + count * 12;
  if (count > (size - HEADER - 4) / 12) return null;
  const tags: { sig: string; offset: number; size: number }[] = [];
  for (let n = 0; n < count; n++) {
    const at = HEADER + 4 + n * 12;
    const offset = view.getUint32(at + 4);
    const length = view.getUint32(at + 8);
    if (offset < tableEnd || offset > size || length > size - offset) {
      return null;
    }
    tags.push({ sig: fourcc(profile, at), offset, size: length });
  }

  const out = new Uint8Array(size);
  out.set(profile.subarray(0, tableEnd));
  for (const [from, to] of BLANKED_HEADER) out.fill(0, from, to);
  // Emptied tags first, then the drawn ones over them, so a drawn tag
  // sharing bytes with an emptied one keeps every byte it's drawn with.
  for (const tag of tags) {
    if (!DRAWN.has(tag.sig)) emptied(out, profile, tag.offset, tag.size);
  }
  for (const tag of tags) {
    if (!DRAWN.has(tag.sig)) continue;
    const n = used(view, tag.offset, tag.size);
    out.set(profile.subarray(tag.offset, tag.offset + n), tag.offset);
  }
  return out;
}
