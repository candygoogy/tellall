// Spike (plan Task 1): can c2pa-ts read the AI labels in our fixtures?
// The mapping lives in src/c2pa/spike-map.ts so the browser worker (Task 2)
// runs the same code; readActive() only reads the fixture file.
import "reflect-metadata"; // @peculiar/x509 (used by c2pa-ts) needs a Reflect polyfill
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { readActiveBytes, type SpikeLabel } from "../src/c2pa/spike-map.ts";

const ROOT = new URL("../../../", import.meta.url);

async function readActive(path: string): Promise<SpikeLabel | null> {
  return readActiveBytes(new Uint8Array(await readFile(new URL(path, ROOT))));
}

test("chatgpt label", async () => {
  const m = await readActive("fixtures/ai/chatgpt-image.png");
  expect(m.signerOrg).toBe("OpenAI OpCo, LLC");
  expect(m.signatureMatches).toBe(true);           // ignore trust-list/chain codes only
  expect(m.actions).toContainEqual(expect.objectContaining({
    action: "c2pa.created", when: "2026-10-25T14:46:19.830385961Z",
    agent: "ChatGPT gpt-image",
    sourceType: "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia" }));
  expect(m.actions.map(a => a.action)).toEqual(expect.arrayContaining(["c2pa.converted", "c2pa.watermarked.unbound"]));
});
test("gemini label", async () => {
  const m = await readActive("fixtures/ai/gemini-image.jpg");
  expect(m.signerOrg).toBe("Google LLC");
  expect(m.signatureMatches).toBe(true);
  expect(m.actions.map(a => [a.action, a.description])).toEqual(expect.arrayContaining([
    // The file's descriptions end with a full stop; imagecheck/FINDINGS.md dropped it.
    ["c2pa.created", "Created by Google Generative AI."],
    ["c2pa.edited", "Applied imperceptible SynthID watermark."],
    ["c2pa.opened", "Opened by Google Generative AI."],
    ["c2pa.resized", "Resized by Google Generative AI."]]));
});
test("paint drawing has no label", async () => {
  expect(await readActive("fixtures/ai/paint-drawing.png")).toBeNull();
});
