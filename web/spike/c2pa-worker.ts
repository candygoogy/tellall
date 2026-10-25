// Spike (plan Task 2): the Node spike's mapping, run in a module worker.
// Receives the file bytes, posts the result as JSON text.
import "reflect-metadata"; // must load before c2pa-ts (@peculiar/x509 needs Reflect)
import { readActiveBytes } from "../../packages/engine/src/c2pa/spike-map.ts";

self.onmessage = async (e: MessageEvent<Uint8Array>) => {
  try {
    const label = await readActiveBytes(e.data);
    self.postMessage(JSON.stringify(label, null, 2));
  } catch (err) {
    self.postMessage(JSON.stringify({ error: String(err) }, null, 2));
  }
};
