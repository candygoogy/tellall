// A small made-up picture for the tests: a gradient, so a changed pixel
// shows, written by sharp in each format.
import sharp from "sharp";

export const WIDTH = 64;
export const HEIGHT = 48;

function gradient(): Buffer {
  const out = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 3;
      out[i] = x * 4;
      out[i + 1] = y * 5;
      out[i + 2] = (x * y) & 0xff;
    }
  }
  return out;
}

export const image = () =>
  sharp(gradient(), { raw: { width: WIDTH, height: HEIGHT, channels: 3 } });

/** The pixels as sharp draws them, colour profile applied. */
export const pixels = (b: Uint8Array) => sharp(b).raw().toBuffer();

/** The turn sharp (libvips) reads; no turn is upright, 1. */
export const sharpTurn = async (b: Uint8Array) =>
  (await sharp(b).metadata()).orientation ?? 1;

export const jpeg = async () =>
  new Uint8Array(await image().jpeg({ quality: 90 }).toBuffer());
export const png = async () => new Uint8Array(await image().png().toBuffer());
export const webp = async () =>
  new Uint8Array(await image().webp({ quality: 90 }).toBuffer());
