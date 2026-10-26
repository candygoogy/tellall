// The engine, off the page's thread: reads one file or text at a time and
// answers with its report and its clean copy (spec §7.4). The same engine
// as the CLI's, so the page says the same sentences. exifr runs in here
// too (the engine's in-process runner); engine.ts stops this worker when a
// pass takes too long.
import {
  clean,
  inspect,
  ReaderMissing,
  words,
  type Input,
} from "@tellall/engine";
import { READY, type Answer, type Ask } from "./protocol.ts";

const reply = (answer: Answer, transfer: Transferable[] = []) =>
  postMessage(answer, { transfer });

addEventListener("message", async (event: MessageEvent<Ask>) => {
  const { id, input } = event.data;
  const t0 = performance.now();
  try {
    const report = await inspect(input as Input);
    reply({ id, phase: "inspected" });
    const c = await clean(input as Input);
    // Both passes: what the visitor waited for.
    const ms = performance.now() - t0;
    const output = c.output;
    const labelled =
      input.kind === "file" &&
      report.findings.some((f) => f.group === "ai-label");
    reply(
      {
        id,
        ok: true,
        report,
        ms,
        cleaned: {
          cleaned: c.cleaned,
          output,
          removed: c.removed,
          notes: c.notes,
        },
        hint: labelled ? words.webHint(input.name) : null,
        command: labelled ? words.removeLabels(input.name) : null,
      },
      output instanceof Uint8Array && output.byteLength ? [output.buffer] : [],
    );
  } catch (error) {
    reply({
      id,
      ok: false,
      error: String((error as Error)?.message ?? error),
      missing: error instanceof ReaderMissing,
    });
  }
});

// exifr is loaded now, before the page is told the engine is here, so a
// page that goes offline after loading still reads photos ("turn Wi-Fi
// off"). If it can't load, a reading says so (ReaderMissing), never that
// the file is damaged.
try {
  await import("exifr");
} catch {
  // Said per reading.
}
// Here, and the engine with it: the page's clock for a file starts now.
postMessage(READY);
