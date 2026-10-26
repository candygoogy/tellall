// From Photo check (candygoogy/experiments, photo/src/heic-preview.ts), MIT,
// same author.

// Draws a HEIC's preview with the browser's own video decoder (WebCodecs),
// for browsers that can't show HEIC in an <img>. A HEIC's picture is HEVC,
// the video format; where the browser can decode HEVC (usually with the
// graphics chip's help), each frame is decoded and drawn onto a canvas,
// turned the way the photo says. Loaded only when such a photo arrives.
//
// The phone's small thumbnail is drawn first: it's quick, and tells
// whether the decoder works at all. If the canvas shows more pixels than
// the thumbnail has, the full picture is drawn next, off screen, and
// replaces it in one go.
import {
  asMain,
  heicPictures,
  stepsMatrix,
  turnedSize,
  type Picture,
  type Settings,
} from "./heic-picture.ts";

export interface Preview {
  canvas: HTMLCanvasElement;
  /** Draws the full picture over the thumbnail, when it's worth it. */
  sharpen: () => Promise<void>;
}

// The canvas's longest side at most, in pixels: sharp at the preview's
// largest size on a 2× screen, without holding a 48-megapixel photo.
const LONGEST = 1600;

/** The settings the decoder takes, or null when it can't decode them. */
async function usable(
  settings: Settings,
  width: number,
  height: number,
): Promise<VideoDecoderConfig | null> {
  const main = asMain(settings.codec, settings.description);
  for (const codec of main ? [settings.codec, main] : [settings.codec]) {
    const config: VideoDecoderConfig = {
      codec,
      description: settings.description,
      codedWidth: width,
      codedHeight: height,
      optimizeForLatency: true,
    };
    try {
      const { supported } = await VideoDecoder.isConfigSupported(config);
      if (supported) return config;
    } catch {
      // A codec string this browser can't parse: the same as unsupported.
    }
  }
  return null;
}

/** Decodes a picture's tiles onto a canvas `width` × `height` (the size
 * after its steps). Resolves true when every tile was drawn. */
async function draw(
  picture: Picture,
  canvas: HTMLCanvasElement,
): Promise<boolean> {
  const g = canvas.getContext("2d", { colorSpace: "display-p3" });
  if (!g) return false;
  const { width: tw, height: th } = picture.steps.length
    ? turnedSize(canvas.width, canvas.height, picture.steps)
    : { width: canvas.width, height: canvas.height };
  // The picture, unturned, at the canvas's scale; the steps turn it.
  g.setTransform(...stepsMatrix(tw, th, picture.steps));
  const sx = tw / picture.width;
  const sy = th / picture.height;
  const { columns, tileWidth, tileHeight, tiles } = picture;
  let drawn = 0;
  let failed = false;
  const decoder = new VideoDecoder({
    output: (frame) => {
      const i = frame.timestamp;
      const col = i % columns;
      const row = Math.floor(i / columns);
      // Whole-pixel edges, so no seam shows between tiles.
      const x = Math.round(col * tileWidth * sx);
      const y = Math.round(row * tileHeight * sy);
      const w = Math.round((col + 1) * tileWidth * sx) - x;
      const h = Math.round((row + 1) * tileHeight * sy) - y;
      try {
        g.drawImage(frame, x, y, w, h);
        drawn++;
      } finally {
        frame.close();
      }
    },
    error: () => {
      failed = true;
    },
  });
  try {
    let current: Settings | null = null;
    for (const [i, tile] of tiles.entries()) {
      if (failed) return false;
      if (tile.settings !== current) {
        if (current) await decoder.flush();
        const config = await usable(tile.settings, tileWidth, tileHeight);
        if (!config) return false;
        decoder.configure(config);
        current = tile.settings;
      }
      // A few frames in flight at a time, so memory stays low.
      while (decoder.decodeQueueSize > 4) {
        await new Promise((go) =>
          decoder.addEventListener("dequeue", go, { once: true }),
        );
      }
      decoder.decode(
        new EncodedVideoChunk({ type: "key", timestamp: i, data: tile.data }),
      );
    }
    await decoder.flush();
    return !failed && drawn === tiles.length;
  } catch {
    return false;
  } finally {
    if (decoder.state !== "closed") decoder.close();
    // Back to plain drawing, for whatever is drawn on this canvas next.
    g.resetTransform();
  }
}

/** The preview, or null when this browser can't decode the photo. */
export async function heicPreview(bytes: Uint8Array): Promise<Preview | null> {
  if (typeof VideoDecoder === "undefined") return null;
  let pictures;
  try {
    pictures = heicPictures(bytes);
  } catch {
    return null;
  }
  if (!pictures) return null;
  const { primary } = pictures;
  const full = turnedSize(primary.width, primary.height, primary.steps);
  const scale = Math.min(1, LONGEST / Math.max(full.width, full.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(full.width * scale));
  canvas.height = Math.max(1, Math.round(full.height * scale));

  // The thumbnail is used when it's the same photo, the same way up.
  let { thumbnail } = pictures;
  if (thumbnail) {
    const small = turnedSize(
      thumbnail.width,
      thumbnail.height,
      thumbnail.steps,
    );
    const ratio = small.width / small.height / (full.width / full.height);
    if (Math.abs(ratio - 1) > 0.02) thumbnail = undefined;
  }
  if (thumbnail && (await draw(thumbnail, canvas))) {
    const longest = Math.max(thumbnail.width, thumbnail.height);
    return {
      canvas,
      sharpen: async () => {
        if (!canvas.isConnected) return;
        // The pixels the canvas covers on screen, once: no point drawing
        // the full picture where the thumbnail is already sharp.
        const box = canvas.getBoundingClientRect();
        const shown = Math.max(box.width, box.height) * devicePixelRatio;
        if (shown <= longest * 1.1) return;
        const sharp = document.createElement("canvas");
        sharp.width = canvas.width;
        sharp.height = canvas.height;
        if (!(await draw(primary, sharp))) return;
        const g = canvas.getContext("2d", { colorSpace: "display-p3" });
        g?.drawImage(sharp, 0, 0);
        sharp.width = sharp.height = 0;
      },
    };
  }
  if (!(await draw(primary, canvas))) return null;
  return { canvas, sharpen: async () => {} };
}
