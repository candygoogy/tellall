// From Photo check (candygoogy/experiments, photo/src/heic-picture.ts), MIT,
// same author. Its HEIF reader is the engine's port of Photo check's heif.ts.

// Where a HEIC's picture is, for drawing a preview. A HEIC holds its
// photo as HEVC video frames: one frame, or (on an iPhone) a grid of
// tiles, each its own frame, that together make the picture. Each frame
// needs its decoder settings (the hvcC property), and the picture may be
// turned (irot) or flipped (imir) after it's put together. Phones also
// store a small thumbnail of the same photo, quick to decode.
//
// Like heif.ts, every read stays inside its own box and every count is
// checked against the bytes its box has left.
import {
  find,
  itemBytes,
  itemTypes,
  locate,
  properties,
  Reader,
  type Box,
  type Item,
  type Property,
} from "../../packages/engine/src/image/heif.ts";

/** A turn (anticlockwise, in degrees) or a flip, applied in order. */
export type Step = { turn: 90 | 180 | 270 } | { flip: "across" | "down" };

export interface Settings {
  /** The WebCodecs codec string, from the hvcC. */
  codec: string;
  /** The hvcC record itself, as WebCodecs takes it. */
  description: Uint8Array;
}

export interface Tile {
  /** The tile's frame, as length-prefixed NAL units. */
  data: Uint8Array;
  settings: Settings;
}

export interface Picture {
  /** The picture's size before it's turned. */
  width: number;
  height: number;
  /** Tiles left to right, top to bottom; a single frame is one tile. */
  columns: number;
  tileWidth: number;
  tileHeight: number;
  tiles: Tile[];
  steps: Step[];
}

export interface Pictures {
  primary: Picture;
  /** The largest thumbnail of the primary picture, if there is one. */
  thumbnail?: Picture;
}

// Past these, a "photo" is a crafted file: no preview is drawn.
const MAX_TILES = 1024;
const MAX_SIDE = 65_535;

/** Every reference of one kind: from an item to a list of items. */
function references(r: Reader, iref: Box | undefined, type: string) {
  const out = new Map<number, number[]>();
  if (!iref) return out;
  const idSize = r.uint(iref.body, 1, iref.end) === 1 ? 4 : 2;
  for (const ref of r.boxes(iref.body + 4, iref.end)) {
    if (ref.type !== type) continue;
    const from = r.uint(ref.body, idSize, ref.end);
    const count = r.uint(ref.body + idSize, 2, ref.end);
    const first = ref.body + idSize + 2;
    if (count * idSize > ref.end - first) {
      throw new Error("A HEIC reference runs past its box.");
    }
    const to: number[] = [];
    for (let i = 0; i < count; i++) {
      to.push(r.uint(first + i * idSize, idSize, ref.end));
    }
    out.set(from, [...(out.get(from) ?? []), ...to]);
  }
  return out;
}

const hex = (n: number) => n.toString(16).toUpperCase();

/** The codec string WebCodecs expects for an hvcC record (ISO/IEC
 * 14496-15, annex E): "hvc1.1.6.L93.B0" for most phones' Main profile. */
export function codecString(hvcC: Uint8Array): string {
  if (hvcC.length < 23) throw new Error("An hvcC record ends early.");
  const [, head = 0, f0 = 0, f1 = 0, f2 = 0, f3 = 0] = hvcC;
  const space = ["", "A", "B", "C"][head >> 6] ?? "";
  const tier = head & 0x20 ? "H" : "L";
  const profile = head & 0x1f;
  // The compatibility flags are written with their bits in reverse order.
  let flags = ((f0 << 24) | (f1 << 16) | (f2 << 8) | f3) >>> 0;
  let reversed = 0;
  for (let i = 0; i < 32; i++) {
    reversed = ((reversed << 1) | (flags & 1)) >>> 0;
    flags >>>= 1;
  }
  const constraints = [...hvcC.subarray(6, 12)];
  while (constraints.length && constraints[constraints.length - 1] === 0) {
    constraints.pop();
  }
  return [
    "hvc1",
    `${space}${profile}`,
    hex(reversed),
    `${tier}${hvcC[12] ?? 0}`,
    ...constraints.map(hex),
  ].join(".");
}

/** The same settings described as plain Main profile, for decoders that
 * only list Main: a Main Still Picture stream (an iPhone's) is a Main
 * stream with one frame, and says so in its compatibility flags. */
export function asMain(codec: string, hvcC: Uint8Array): string | null {
  const head = hvcC[1] ?? 0;
  const mainToo = ((hvcC[2] ?? 0) & 0x40) !== 0;
  if ((head & 0x1f) !== 3 || !mainToo) return null;
  return codec.replace(/^hvc1\.[ABC]?3\.[0-9A-F]+\./, "hvc1.1.6.");
}

class NoPicture extends Error {}

/** One picture item (a frame, or a grid of frames) and its tiles. */
function picture(
  r: Reader,
  items: Map<number, Item>,
  props: Map<number, Property[]>,
  tilesOf: Map<number, number[]>,
  id: number,
): Picture {
  const item = items.get(id);
  if (!item) throw new NoPicture();
  const own = props.get(id) ?? [];
  // Tiles that share their decoder settings share one object, so the
  // decoder is set up once for all of them.
  const shared = new Map<number, Settings>();
  const size = (list: Property[]) => {
    const ispe = list.find((p) => p.type === "ispe")?.box;
    if (!ispe) return null;
    return {
      width: r.uint(ispe.body + 4, 4, ispe.end),
      height: r.uint(ispe.body + 8, 4, ispe.end),
    };
  };
  const frame = (frameId: number): Tile & { width: number; height: number } => {
    const tile = items.get(frameId);
    const list = props.get(frameId) ?? [];
    const hvcC = list.find((p) => p.type === "hvcC")?.box;
    const dims = size(list);
    if (tile?.type !== "hvc1" || !hvcC || !dims || !tile.extents.length) {
      throw new NoPicture();
    }
    let settings = shared.get(hvcC.start);
    if (!settings) {
      const description = r.b.subarray(hvcC.body, hvcC.end);
      settings = { codec: codecString(description), description };
      shared.set(hvcC.start, settings);
    }
    const data =
      tile.extents.length === 1 && tile.extents[0]
        ? r.b.subarray(
            tile.extents[0].offset,
            tile.extents[0].offset + tile.extents[0].length,
          )
        : itemBytes(r.b, tile);
    return { ...dims, data, settings };
  };

  const steps: Step[] = [];
  for (const p of own) {
    const at = p.box.body;
    if (p.type === "irot") {
      const turn = (r.uint(at, 1, p.box.end) & 3) * 90;
      if (turn) steps.push({ turn: turn as 90 | 180 | 270 });
    } else if (p.type === "imir") {
      const axis = r.uint(at, 1, p.box.end) & 1;
      // Axis 0 is a vertical axis: the picture flips left to right.
      steps.push({ flip: axis ? "down" : "across" });
    }
  }

  if (item.type === "hvc1") {
    const { width, height, ...tile } = frame(id);
    const dims = size(own) ?? { width, height };
    return {
      ...dims,
      columns: 1,
      tileWidth: width,
      tileHeight: height,
      tiles: [tile],
      steps,
    };
  }
  if (item.type !== "grid" || !item.extents.length) throw new NoPicture();
  // The grid's own description: its rows, columns and finished size.
  const g = itemBytes(r.b, item);
  const gr = new Reader(g);
  const wide = (gr.uint(1, 1) & 1) === 1;
  const rows = gr.uint(2, 1) + 1;
  const columns = gr.uint(3, 1) + 1;
  const width = gr.uint(4, wide ? 4 : 2);
  const height = gr.uint(wide ? 8 : 6, wide ? 4 : 2);
  const ids = tilesOf.get(id) ?? [];
  if (
    rows * columns > MAX_TILES ||
    ids.length !== rows * columns ||
    !width ||
    !height ||
    width > MAX_SIDE ||
    height > MAX_SIDE
  ) {
    throw new NoPicture();
  }
  const frames = ids.map(frame);
  const first = frames[0];
  if (!first) throw new NoPicture();
  // Every tile is the same size, and together they cover the picture.
  if (
    frames.some((f) => f.width !== first.width || f.height !== first.height) ||
    first.width * columns < width ||
    first.height * rows < height
  ) {
    throw new NoPicture();
  }
  return {
    width,
    height,
    columns,
    tileWidth: first.width,
    tileHeight: first.height,
    tiles: frames.map(({ data, settings }) => ({ data, settings })),
    steps,
  };
}

/** The HEIC's main picture and its thumbnail, or null when the main
 * picture is stored in a way this page can't put together. */
export function heicPictures(b: Uint8Array): Pictures | null {
  const r = new Reader(b);
  const meta = find(r.boxes(0, b.length), "meta");
  if (!meta) return null;
  const inside = r.boxes(meta.body + 4, meta.end);
  const iinf = find(inside, "iinf");
  const iloc = find(inside, "iloc");
  const pitm = find(inside, "pitm");
  const iprp = find(inside, "iprp");
  if (!iinf || !iloc || !pitm || !iprp) return null;
  const items = itemTypes(r, iinf);
  locate(r, iloc, find(inside, "idat"), items);
  const props = properties(r, iprp);
  const iref = find(inside, "iref");
  const tilesOf = references(r, iref, "dimg");
  const main =
    r.uint(pitm.body, 1, pitm.end) === 0
      ? r.uint(pitm.body + 4, 2, pitm.end)
      : r.uint(pitm.body + 4, 4, pitm.end);
  const read = (id: number) => {
    try {
      return picture(r, items, props, tilesOf, id);
    } catch (error) {
      if (error instanceof NoPicture) return null;
      throw error;
    }
  };
  const primary = read(main);
  if (!primary) return null;
  let thumbnail: Picture | undefined;
  for (const [id, to] of references(r, iref, "thmb")) {
    if (!to.includes(main)) continue;
    const small = read(id);
    if (
      small &&
      (!thumbnail ||
        small.width * small.height > thumbnail.width * thumbnail.height)
    ) {
      thumbnail = small;
    }
  }
  return thumbnail ? { primary, thumbnail } : { primary };
}

/** A picture's size once its steps are applied. */
export function turnedSize(
  width: number,
  height: number,
  steps: Step[],
): { width: number; height: number } {
  const sideways =
    steps.filter((s) => "turn" in s && s.turn !== 180).length % 2 === 1;
  return sideways ? { width: height, height: width } : { width, height };
}

/** The canvas transform [a, b, c, d, e, f] that draws a width × height
 * picture with its steps applied, (x, y) → (ax + cy + e, bx + dy + f). */
export function stepsMatrix(
  width: number,
  height: number,
  steps: Step[],
): [number, number, number, number, number, number] {
  let m: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
  let w = width;
  let h = height;
  for (const step of steps) {
    // The step, as a matrix over the picture as it is so far.
    let s: [number, number, number, number, number, number];
    if ("turn" in step) {
      if (step.turn === 90) s = [0, -1, 1, 0, 0, w];
      else if (step.turn === 180) s = [-1, 0, 0, -1, w, h];
      else s = [0, 1, -1, 0, h, 0];
      if (step.turn !== 180) [w, h] = [h, w];
    } else {
      s = step.flip === "across" ? [-1, 0, 0, 1, w, 0] : [1, 0, 0, -1, 0, h];
    }
    // The step comes after what's done so far: s × m.
    const [a, b, c, d, e, f] = m;
    m = [
      s[0] * a + s[2] * b,
      s[1] * a + s[3] * b,
      s[0] * c + s[2] * d,
      s[1] * c + s[3] * d,
      s[0] * e + s[2] * f + s[4],
      s[1] * e + s[3] * f + s[5],
    ];
  }
  return m;
}
