// Spike (plan Task 2): the engine's C2PA reader, run in a module worker.
// Receives the file bytes, posts the label as JSON text. read.ts loads the
// Reflect polyfill c2pa-ts needs, so nothing else is imported first.
import { readLabel } from "../../packages/engine/src/c2pa/read.ts";
import { detect } from "../../packages/engine/src/image/detect.ts";

self.onmessage = async (e: MessageEvent<Uint8Array>) => {
  try {
    const type = detect(e.data);
    const label = type ? await readLabel(e.data, type) : null;
    self.postMessage(JSON.stringify({ type, label }, null, 2));
  } catch (err) {
    self.postMessage(JSON.stringify({ error: String(err) }, null, 2));
  }
};
