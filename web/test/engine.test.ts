// The page's engine client (src/engine.ts) with a stand-in worker: a pass
// that takes too long is given up on, the worker is replaced, and the next
// reading still works; the clean pass gets its own time.
import { expect, test } from "vitest";
import { engineClient, GaveUp, type EngineWorker } from "../src/engine.ts";
import { READY } from "../src/protocol.ts";

/** A worker that says it's ready, then answers each ask as `answer` says. */
function fake(answer: (id: number, w: EngineWorker) => void) {
  const made: EngineWorker[] = [];
  const start = () => {
    const w: EngineWorker = {
      onmessage: null,
      onmessageerror: null,
      onerror: null,
      postMessage: (m) => answer((m as { id: number }).id, w),
      terminate: () => {
        w.onmessage = null;
      },
    };
    made.push(w);
    setTimeout(() => w.onmessage?.({ data: READY } as MessageEvent));
    return w;
  };
  return { start, made };
}

const said = (w: EngineWorker, data: unknown, ms = 0) =>
  setTimeout(() => w.onmessage?.({ data } as MessageEvent), ms);
const done = (id: number) => ({
  id,
  ok: true,
  report: {},
  ms: 1,
  cleaned: {},
  hint: null,
  command: null,
});

test("a reading that takes too long is given up on; the next one runs", async () => {
  let n = 0;
  const { start, made } = fake((id, w) => {
    if (++n === 2) said(w, done(id));
    // the first never answers
  });
  const client = engineClient({ start, limit: 50 });
  const text = { kind: "text" as const, plain: "x" };
  await expect(client.read(text)).rejects.toBeInstanceOf(GaveUp);
  await expect(client.read(text)).resolves.toMatchObject({ ok: true });
  expect(made).toHaveLength(2);
});

test("each pass gets its own time", async () => {
  const { start } = fake((id, w) => {
    said(w, { id, phase: "inspected" }, 40);
    said(w, done(id), 80);
  });
  const client = engineClient({ start, limit: 60 });
  await expect(
    client.read({ kind: "text", plain: "x" }),
  ).resolves.toMatchObject({ ok: true });
});
