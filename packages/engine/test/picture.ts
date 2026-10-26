// HEIC files laid out like a phone's, for the preview: a grid of HEVC
// tiles as the main picture, a turn or a flip on it, and a thumbnail. The
// tiles hold made-up bytes, not real HEVC: the parser only finds them, and
// the browser tests stand in for the decoder.
import { box, bytes, FTYP, full, u16, u32 } from "./craft.ts";

const u8 = (n: number) => [n & 0xff];

/** An hvcC header with no parameter sets: profile 3 (Main Still Picture,
 * compatible with Main), level 93 unless given, 4-byte NAL lengths. */
export const hvcC = (level = 93) =>
  box(
    "hvcC",
    [1, 0x03, 0x70, 0, 0, 0, 0xb0, 0, 0, 0, 0, 0, level],
    [0xf0, 0x00, 0xfc, 0xfd, 0xf8, 0xf8, 0x00, 0x00, 0x0f, 0x00],
  );

export interface PictureSpec {
  rows: number;
  columns: number;
  tile: [number, number];
  /** The grid's finished size; defaults to the tiles' full size. */
  size?: [number, number];
  /** irot, in quarter turns anticlockwise. */
  turn?: number;
  /** imir's axis. */
  flip?: number;
  /** A thumbnail's size, or none. */
  thumbnail?: [number, number];
}

const GRID = 1000;
const THUMB = 2000;

/** The tile ids, left to right, top to bottom, start at 1; each tile's
 * data is a 4-byte length and then its own number, repeated. */
export function picture(spec: PictureSpec): Uint8Array {
  const n = spec.rows * spec.columns;
  const [tw, th] = spec.tile;
  const [w, h] = spec.size ?? [tw * spec.columns, th * spec.rows];
  const tileIds = Array.from({ length: n }, (_, i) => i + 1);
  const frames = new Map<number, number[]>();
  for (const id of tileIds) frames.set(id, [...u32(4), id, id, id, id]);
  if (spec.thumbnail) frames.set(THUMB, [...u32(4), 0xee, 0xee, 0xee, 0xee]);

  const infe = (id: number, type: string) =>
    full("infe", 2, u16(id), u16(0), bytes(type), [0]);
  const ids = [...tileIds, GRID, ...(spec.thumbnail ? [THUMB] : [])];
  const iinf = full(
    "iinf",
    0,
    u16(ids.length),
    ...ids.map((id) => infe(id, id === GRID ? "grid" : "hvc1")),
  );
  const iref = full(
    "iref",
    0,
    box("dimg", u16(GRID), u16(n), ...tileIds.map(u16)),
    ...(spec.thumbnail ? [box("thmb", u16(THUMB), u16(1), u16(GRID))] : []),
  );
  const ispe = (a: number, b: number) => full("ispe", 0, u32(a), u32(b));
  // Properties from 1: the tiles' hvcC and size, the grid's size, then
  // the turn, the flip, the thumbnail's hvcC and size.
  const props = [hvcC(), ispe(tw, th), ispe(w, h)];
  const turnAt = spec.turn ? props.push(box("irot", u8(spec.turn))) : 0;
  const flipAt =
    spec.flip !== undefined ? props.push(box("imir", u8(spec.flip))) : 0;
  const thumbAt = spec.thumbnail
    ? props.push(hvcC(90), ispe(...spec.thumbnail)) - 1
    : 0;
  const steps = [
    ...(turnAt ? [0x80 | turnAt] : []),
    ...(flipAt ? [0x80 | flipAt] : []),
  ];
  const entries: number[][] = [
    ...tileIds.map((id) => [...u16(id), 2, 0x81, 0x82]),
    [...u16(GRID), 1 + steps.length, 0x83, ...steps],
    ...(spec.thumbnail
      ? [
          [
            ...u16(THUMB),
            2 + steps.length,
            0x80 | thumbAt,
            thumbAt + 1,
            ...steps,
          ],
        ]
      : []),
  ];
  const ipma = full("ipma", 0, u32(entries.length), ...entries);
  const iprp = box("iprp", box("ipco", ...props), ipma);
  const grid = [0, 0, spec.rows - 1, spec.columns - 1, ...u16(w), ...u16(h)];
  const idat = box("idat", grid);
  const pitm = full("pitm", 0, u16(GRID));
  const hdlr = full(
    "hdlr",
    0,
    u32(0),
    bytes("pict"),
    u32(0),
    u32(0),
    u32(0),
    [0],
  );

  // The frames go in mdat, in id order; the grid's description in idat.
  const stored = [...frames.keys()];
  const iloc = (mdat: number) => {
    let at = mdat + 8;
    const rows = stored.map((id) => {
      const length = frames.get(id)?.length ?? 0;
      const row = [
        ...u16(id),
        ...u16(0),
        ...u16(0),
        ...u16(1),
        ...u32(at),
        ...u32(length),
      ];
      at += length;
      return row;
    });
    rows.push([
      ...u16(GRID),
      ...u16(1),
      ...u16(0),
      ...u16(1),
      ...u32(0),
      ...u32(grid.length),
    ]);
    return full("iloc", 1, [0x44, 0x00], u16(rows.length), ...rows);
  };
  const metaOf = (mdat: number) =>
    full("meta", 0, hdlr, pitm, iinf, iref, iprp, idat, iloc(mdat));
  const metaSize = metaOf(0).length;
  const meta = metaOf(FTYP.length + metaSize);
  const mdat = box("mdat", ...stored.map((id) => frames.get(id) ?? []));
  return new Uint8Array([...FTYP, ...meta, ...mdat]);
}
