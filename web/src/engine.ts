// The page's side of the engine's worker (worker.ts), after Photo check's
// exifWorker(): one reading at a time, the same worker for each. Each of
// a reading's two passes (inspect, then clean) may take LIMIT ms; a worker
// still busy after that is stopped and the reading fails with a sentence
// saying tellall gave up on it; the next reading starts a new worker, so
// one bad file never holds up the rest (Review Focus 5). The clock starts
// once the worker is ready: one that isn't within START_LIMIT ms is
// stopped the same way. One whose file is gone (a newer version of the
// page took its place) reloads the page once (stale.ts), but only when
// nothing the visitor read would be lost; otherwise it says so.
import { READY, type Answer, type AskInput, type Reading } from "./protocol.ts";
import { reloadOnce, settle } from "./stale.ts";

/** How long each pass of the engine may take over one file or text. */
export const LIMIT = 30_000;
/** How long a new worker may take to arrive and start, on a slow line. */
const START_LIMIT = 30_000;

export class GaveUp extends Error {}

/** Part of the page's code couldn't load: offline, or replaced since the
 * page opened. */
export const STALE =
  "Part of tellall couldn't load: this page may have changed since you opened it, or the device is offline. Reload the page to read this; your other results stay until then.";

/** The parts of a Worker the client uses. */
export interface EngineWorker {
  onmessage: ((event: MessageEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
}

/** An error event's message; a bare event has none. */
const messageOf = (event: Event) =>
  "message" in event ? String((event as ErrorEvent).message ?? "") : "";

export interface ClientOptions {
  start: () => EngineWorker;
  limit?: number;
  startLimit?: number;
  /** Whether reloading the page would lose nothing the visitor read. */
  mayReload?: () => boolean;
}

export function engineClient({
  start,
  limit = LIMIT,
  startLimit = START_LIMIT,
  mayReload = () => true,
}: ClientOptions) {
  let worker: EngineWorker | null = null;
  let ready: Promise<EngineWorker> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let seq = 0;

  const stop = (w: EngineWorker) => {
    w.terminate();
    if (worker === w) {
      worker = null;
      ready = null;
    }
  };

  /** The worker, started and ready. */
  const started = (): Promise<EngineWorker> => {
    if (ready) return ready;
    const mine = (worker = start());
    ready = new Promise<EngineWorker>((resolve, reject) => {
      const timer = setTimeout(() => {
        stop(mine);
        reject(new GaveUp("The engine took too long to start."));
      }, startLimit);
      mine.onmessage = (event) => {
        if (event.data !== READY) return;
        clearTimeout(timer);
        mine.onmessage = mine.onerror = null;
        // A worker that started has its file: a later deploy's may
        // reload the page again.
        settle();
        resolve(mine);
      };
      mine.onerror = (event) => {
        clearTimeout(timer);
        stop(mine);
        // A worker that never started gives a bare event: its file is
        // most likely gone. The page reloads once for the current files
        // when that loses nothing; else it says what happened.
        const bare = !messageOf(event);
        if (bare && mayReload() && reloadOnce()) return;
        reject(new Error(bare ? STALE : "The engine couldn't start."));
      };
    });
    return ready;
  };

  const ask = async (
    input: AskInput,
    transfer: Transferable[],
  ): Promise<Reading> => {
    const w = await started();
    const id = ++seq;
    return new Promise<Reading>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const time = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          done();
          stop(w);
          reject(
            new GaveUp(
              `tellall gave up on it after ${limit / 1000} seconds. The file may be very large or built in a way the engine can't follow.`,
            ),
          );
        }, limit);
      };
      const done = () => {
        clearTimeout(timer);
        w.onmessage = w.onerror = w.onmessageerror = null;
      };
      w.onmessage = (event: MessageEvent<Answer>) => {
        const a = event.data;
        if (a.id !== id) return;
        // Inspected: the clean pass gets its own time.
        if ("phase" in a) return time();
        done();
        if (a.ok) resolve(a);
        else reject(new Error(a.missing ? STALE : a.error));
      };
      w.onmessageerror = () => {
        done();
        reject(new Error("The engine's answer couldn't be read."));
      };
      w.onerror = (event) => {
        done();
        stop(w);
        reject(new Error(messageOf(event) || "The engine stopped."));
      };
      time();
      w.postMessage({ id, input }, transfer);
    });
  };

  return {
    /** Reads a file or a text in the worker, after any reading before it. */
    read(input: AskInput, transfer: Transferable[] = []): Promise<Reading> {
      const answer = queue.then(() => ask(input, transfer));
      queue = answer.catch(() => undefined);
      return answer;
    },
    /** Starts the worker ahead of the first reading, so it's quick. */
    warm(): void {
      started().catch(() => undefined);
    },
  };
}

let guard: () => boolean = () => true;
/** Tells the client whether a reload would lose nothing (main.ts). */
export const setMayReload = (check: () => boolean) => {
  guard = check;
};

const client = engineClient({
  start: () =>
    new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
  mayReload: () => guard(),
});

export const read = client.read;
export const warm = client.warm;
