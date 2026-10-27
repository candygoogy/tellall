// tellall on the command line (spec §5.2): reports on files, folders and
// stdin, or clean copies of files. Exit 0 done, 1 --fail-on matched, 2 a
// usage, read or write error (clean that can't make a copy included). A
// file of a kind tellall can't read is listed and leaves the code alone.
import {
  clean,
  inspect,
  words,
  type Cleaned,
  type Group,
  type Report,
} from "@tellall/engine";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  parseArgs,
  USAGE,
  USAGE_LINE,
  USAGE_LINE_CLEAN,
  UsageError,
  type Args,
  type FailOn,
} from "./args.ts";
import { decodeText, idOf, readInput, Said, writeCopy } from "./io.ts";
import { block, formatReport, safe } from "./print.ts";

declare const TELLALL_VERSION: string;

/** A file to read: where it is, how to show it, and where it sits under
 * the folder it was found in (its own name when named by itself). */
interface Entry {
  path: string;
  shown: string;
  rel: string;
  /** Named on the command line, not found in a folder. */
  named: boolean;
}

/** A read or write error happened: exit 2 at the end. */
let failed = false;

/** What the folder walks and clean passed over, said once at the end. */
const skipped = { folders: 0, links: 0, copies: 0 };

/** Whether anything has been printed: the next block of output, on
 * stdout or stderr, starts after a blank line. */
let started = false;
const lead = () => {
  const gap = started ? "\n" : "";
  started = true;
  return gap;
};

/** The engine's notes say "tellall can't"; after "tellall:" that's "it
 * can't", and a sentence starts in lower case. */
const plainer = (message: string) =>
  message
    .replace(/\btellall (can't|couldn't)/g, "it $1")
    .replace(/^[A-Z](?![A-Z])/, (c) => c.toLowerCase());

const lowerFirst = (s: string) =>
  s.replace(/^[A-Z](?![A-Z])/, (c) => c.toLowerCase());

const say = (message: string) =>
  process.stderr.write(`${lead()}tellall: ${safe(plainer(message))}\n`);

function problem(message: string) {
  failed = true;
  say(message);
}

const codeOf = (e: unknown) =>
  e instanceof Error && "code" in e ? e.code : undefined;

/** Short words for what usually goes wrong; else Node's message without
 * the call and the path it names (the message says which file). */
const WHY: Record<string, string> = {
  ENOENT: "no such file or folder",
  EACCES: "permission denied",
  EPERM: "not allowed: no permission, or the file is in use",
  EBUSY: "the file is in use by another program",
  EISDIR: "it's a folder",
  ENOTDIR: "a part of the path is a file, not a folder",
  ELOOP: "too many links in a row",
  ENAMETOOLONG: "the name is too long",
  ENOSPC: "the disk is full",
  EDQUOT: "the disk quota is used up",
  EROFS: "the disk is read-only",
  EIO: "the disk couldn't be read or written",
  EMFILE: "too many files open",
  ERR_FS_FILE_TOO_LARGE: "it's larger than 2 GiB, more than can be read",
};

function why(e: unknown): string {
  if (e instanceof Said) return e.message;
  const code = codeOf(e);
  if (typeof code === "string" && WHY[code]) return WHY[code];
  const message = e instanceof Error ? e.message : String(e);
  return message.replace(/^[A-Z]+: /, "").replace(/, \w+ '.*$/, "");
}

/** Set when whoever reads stdout stops (`tellall … | head -1`). */
let stdoutGone = false;
process.stdout.on("error", (e) => {
  stdoutGone = true;
  if (codeOf(e) !== "EPIPE") problem(`can't write the output: ${why(e)}`);
});

const out = (s: string) => {
  if (!stdoutGone) process.stdout.write(s);
};

/** Paths as the user sees them: one kind of slash on Windows. */
const slashed = (p: string) =>
  process.platform === "win32" ? p.replaceAll("\\", "/") : p;

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** A folder's files in name order, all the way down. Dot-folders and
 * node_modules are left out, and links: a link to a folder above would
 * never end. Each is counted, to be said at the end. */
function walk(root: string, rel: string, shownRoot: string, into: Entry[]) {
  let names: string[];
  try {
    names = readdirSync(join(root, rel)).sort(byName);
  } catch (e) {
    problem(`can't read ${shownRoot}${rel}: ${why(e)}`);
    return;
  }
  for (const name of names) {
    const r = rel ? `${rel}/${name}` : name;
    let stat;
    try {
      stat = lstatSync(join(root, r));
    } catch (e) {
      problem(`can't read ${shownRoot}${r}: ${why(e)}`);
      continue;
    }
    if (stat.isSymbolicLink()) {
      skipped.links++;
    } else if (stat.isDirectory()) {
      if (name.startsWith(".") || name === "node_modules") skipped.folders++;
      else walk(root, r, shownRoot, into);
    } else if (stat.isFile()) {
      into.push({
        path: join(root, r),
        shown: shownRoot + r,
        rel: r,
        named: false,
      });
    }
  }
}

/** The file a path names, or the files in the folder it names (a link
 * named here is followed). With `keepName`, a folder's files sit under
 * its name. */
function entries(path: string, keepName = false): Entry[] {
  const shown = slashed(path);
  let stat;
  try {
    stat = statSync(path);
  } catch (e) {
    problem(`can't read ${shown}: ${why(e)}`);
    return [];
  }
  if (!stat.isDirectory()) {
    return [{ path, shown, rel: basename(path), named: true }];
  }
  const trimmed = shown.replace(/\/+$/, "");
  const list: Entry[] = [];
  walk(path, "", trimmed === "." ? "" : `${trimmed}/`, list);
  const name = basename(resolve(path));
  if (keepName && name) {
    for (const entry of list) entry.rel = `${name}/${entry.rel}`;
  }
  return list;
}

/** Runs `use` on a file's bytes. A file whose first bytes show a kind
 * tellall can't read isn't read further, unless the engine thinks
 * otherwise. Null after an error, said as can't read or can't `doing`. */
async function withBytes<T>(
  entry: Entry,
  doing: string,
  use: (bytes: Uint8Array) => Promise<T>,
  unknown: (result: T) => boolean,
): Promise<T | null> {
  for (const whole of [false, true]) {
    let input;
    try {
      input = readInput(entry.path, whole);
    } catch (e) {
      problem(`can't read ${entry.shown}: ${why(e)}`);
      return null;
    }
    try {
      const result = await use(input.bytes);
      if (input.whole || unknown(result)) return result;
    } catch (e) {
      if (input.whole) {
        problem(`can't ${doing} ${entry.shown}: ${why(e)}`);
        return null;
      }
    }
  }
  return null;
}

async function readStdin(): Promise<Uint8Array> {
  if (process.stdin.isTTY) {
    process.stderr.write(
      "tellall: reading text from the keyboard; end it with Ctrl+D on a line of its own (Ctrl+Z, then Enter, on Windows).\n",
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

const matches = (reports: Report[], on: FailOn) =>
  reports.some((r) =>
    r.findings.some((f) =>
      on === "any" ? f.kind === "private" || f.kind === "label" : f.kind === on,
    ),
  );

/** What the walks passed over, on stderr: not part of the output. */
function saySkipped() {
  const lines: string[] = [];
  if (skipped.copies) {
    lines.push(
      `skipped ${plural(skipped.copies, "clean copy", "clean copies")} made earlier.`,
    );
  }
  if (skipped.folders) {
    lines.push(
      `skipped ${plural(skipped.folders, "folder", "folders")} named node_modules or starting with a dot.`,
    );
  }
  if (skipped.links) {
    lines.push(
      `skipped ${plural(skipped.links, "link", "links")} inside folders; name a link by itself to read it.`,
    );
  }
  if (lines.length) {
    process.stderr.write(lead() + lines.map((l) => `tellall: ${l}\n`).join(""));
  }
}

/** Reports; true when --fail-on matched. */
async function runInspect(args: Extract<Args, { command: "inspect" }>) {
  const reports: Report[] = [];
  const show = (report: Report) => {
    reports.push(report);
    if (!args.json) {
      out(lead() + formatReport(report, args.all));
    }
  };
  for (const path of args.paths) {
    if (path === "-") {
      let bytes;
      try {
        bytes = await readStdin();
      } catch (e) {
        problem(`can't read stdin: ${why(e)}`);
        continue;
      }
      const { text, invalid } = decodeText(bytes);
      const report = await inspect({ kind: "text", plain: text });
      if (invalid) {
        report.findings.unshift({
          group: "other-text",
          kind: "info",
          sentence: `Some of this text isn't valid ${invalid}, so tellall read those bytes as �. Save it as ${invalid} and check it again to be sure nothing is hidden there.`,
          fields: [],
          cleanedBy: "nothing",
        });
      }
      show({ ...report, name: "stdin" });
      continue;
    }
    for (const entry of entries(path)) {
      const report = await withBytes(
        entry,
        "read",
        (bytes) => inspect({ kind: "file", name: entry.shown, bytes }),
        (r) => r.format === "unknown",
      );
      if (report) show(report);
    }
  }
  if (args.json) out(JSON.stringify(reports, null, 2) + "\n");
  saySkipped();
  return args.failOn !== null && matches(reports, args.failOn);
}

/** What a copy no longer carries, in plain words. */
const GONE: Record<Group, string> = {
  "ai-label": "the AI label",
  "ai-source": "the AI-source tag",
  location: "location",
  device: "camera and device details",
  dates: "dates and times",
  software: "software names",
  ids: "ID numbers",
  "other-text": "other details",
  "hidden-chars": "hidden characters",
  "copy-extras": "formatted-copy extras",
};

/** "Removed location and dates: 1,234 bytes." */
function removedLine(removed: Group[], bytes: number): string | null {
  if (!removed.length) return null;
  const names = removed.map((g) => GONE[g]);
  const list =
    names.length > 1
      ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
      : names[0];
  const size =
    bytes > 0
      ? `: ${bytes.toLocaleString("en-US")} ${bytes === 1 ? "byte" : "bytes"}`
      : "";
  return `Removed ${list}${size}.`;
}

/** photo.jpg → photo.clean.jpg */
function cleanName(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? `${name.slice(0, dot)}.clean${name.slice(dot)}`
    : `${name}.clean`;
}

const isFile = (path: string) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** A copy tellall made: named X.clean.ext with X.ext beside it. A file
 * named so without one is someone's own file, read like any other. */
function isOurCopy(path: string) {
  const name = basename(path);
  const m = /^(.+)\.clean(\.[^.]*)?$/.exec(name);
  if (!m) return false;
  const original = m[1] + (m[2] ?? "");
  return cleanName(original) === name && isFile(join(dirname(path), original));
}

/** The real file a path names, to read each file once. */
const realOf = (path: string) => {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
};

/** Makes the folder, saying which file is in its way if one is. */
function makeFolder(dir: string) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    if (codeOf(e) !== "EEXIST" && codeOf(e) !== "ENOTDIR") throw e;
    for (let d = dir; dirname(d) !== d; d = dirname(d)) {
      if (isFile(d)) throw new Said(`${slashed(d)} is a file, not a folder`);
    }
    throw e;
  }
}

/** Clean copies, never over an original, over an earlier copy only with
 * --force. */
async function runClean(args: Extract<Args, { command: "clean" }>) {
  if (args.out) {
    let outStat;
    try {
      outStat = statSync(args.out);
    } catch {
      // Not there yet: made when the first copy is written.
    }
    if (outStat && !outStat.isDirectory()) {
      problem(`${slashed(args.out)} is a file, not a folder.`);
      return;
    }
  }
  let labelsRemoved = false;
  /** Copies that were already there, said once at the end. */
  const there: string[] = [];
  const print = (name: string, under: string[]) =>
    out(lead() + block(name, under));
  /** The files read, so a file named twice is cleaned once. */
  const seen = new Set<string>();
  /** This run's copies, by path and by file, so two inputs can't write
   * the same one (also when the file system ignores case). */
  const written = new Set<string>();
  const writtenIds = new Set<string>();
  // With -o and several inputs, each folder's files keep its name, so
  // two folders' photo.jpg don't meet.
  const keepNames = args.out !== null && args.paths.length > 1;

  for (const path of args.paths) {
    for (const entry of entries(path, keepNames)) {
      const real = realOf(entry.path);
      if (seen.has(real)) continue;
      seen.add(real);
      const name = basename(entry.path);
      if (isOurCopy(entry.path)) {
        if (entry.named) {
          print(entry.shown, ["Already a clean copy, so left as it is."]);
        } else {
          skipped.copies++;
        }
        continue;
      }
      let size = 0;
      const result = await withBytes<Cleaned>(
        entry,
        "clean",
        (bytes) => {
          size = bytes.length;
          return clean(
            { kind: "file", name, bytes },
            { removeLabels: args.removeLabels },
          );
        },
        (r) => !r.cleaned && r.notes[0] === words.clean.unknown,
      );
      if (!result) continue;
      if (!result.cleaned) {
        // A kind of file tellall can't read is listed, not an error.
        if (result.notes[0] === words.clean.unknown) {
          print(entry.shown, result.notes);
        } else {
          problem(`${entry.shown}: ${lowerFirst(result.notes.join(" "))}`);
        }
        continue;
      }

      const target = args.out
        ? join(args.out, dirname(entry.rel), cleanName(name))
        : join(dirname(entry.path), cleanName(name));
      const shownTarget = args.out
        ? slashed(target)
        : entry.shown.slice(0, -name.length) + cleanName(name);
      const key = resolve(target);
      const id = idOf(target);
      if (written.has(key) || (id !== null && writtenIds.has(id))) {
        problem(
          `${shownTarget} was already written from another file, so ${entry.shown} wasn't cleaned.`,
        );
        continue;
      }
      try {
        makeFolder(dirname(target));
        if (statSync(target, { throwIfNoEntry: false })?.isDirectory()) {
          throw new Said("a folder of that name is in the way");
        }
        writeCopy(target, result.output as Uint8Array, args.force);
      } catch (e) {
        if (codeOf(e) === "EEXIST") {
          failed = true;
          there.push(shownTarget);
        } else {
          problem(`couldn't write ${shownTarget}: ${why(e)}`);
        }
        continue;
      }
      written.add(key);
      const newId = idOf(target);
      if (newId !== null) writtenIds.add(newId);
      // The notice about labels comes once, at the end.
      const notes = result.notes.filter((n) => n !== words.clean.labelsRemoved);
      if (notes.length < result.notes.length) labelsRemoved = true;
      const gone = removedLine(
        result.removed,
        size - (result.output as Uint8Array).length,
      );
      print(entry.shown, [
        `Wrote ${shownTarget}`,
        ...(gone ? [gone] : []),
        ...notes.map((n) => `· ${n}`),
      ]);
    }
  }
  if (labelsRemoved) out(`${lead()}${words.clean.labelsRemoved}\n`);
  if (there.length === 1) {
    say(`${there[0]} is already there; add --force to replace it.`);
  } else if (there.length) {
    say(
      `${there.length} clean copies already there; add --force to replace them.`,
    );
  }
  saySkipped();
}

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    process.stderr.write(
      `tellall: ${e.message}\n${e.cleaning ? USAGE_LINE_CLEAN : USAGE_LINE}\nRun tellall --help for all options.\n`,
    );
    return 2;
  }
  if (args.command === "help") {
    out(USAGE);
    return 0;
  }
  if (args.command === "version") {
    out(`${TELLALL_VERSION}\n`);
    return 0;
  }
  let matched = false;
  if (args.command === "inspect") matched = await runInspect(args);
  else await runClean(args);
  return failed ? 2 : matched ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    const message = e instanceof Error ? (e.stack ?? e.message) : String(e);
    process.stderr.write(`tellall: ${message}\n`);
    process.exitCode = 2;
  },
);
