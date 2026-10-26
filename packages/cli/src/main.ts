// tellall on the command line (spec §5.2): reports on files, folders and
// stdin, or clean copies of files. Exit 0 done, 1 --fail-on matched, 2 a
// usage, read or write error.
import { clean, inspect, words, type Report } from "@tellall/engine";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  parseArgs,
  USAGE,
  UsageError,
  type Args,
  type FailOn,
} from "./args.ts";
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

const out = (s: string) => process.stdout.write(s);

function problem(message: string) {
  failed = true;
  process.stderr.write(`tellall: ${safe(message)}\n`);
}

const codeOf = (e: unknown) =>
  e instanceof Error && "code" in e ? e.code : undefined;

const why = (e: unknown) =>
  codeOf(e) === "ENOENT"
    ? "no such file or folder"
    : e instanceof Error
      ? e.message
      : String(e);

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A folder's files in name order, all the way down; dot-folders and
 * node_modules are left out. */
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
      stat = statSync(join(root, r));
    } catch (e) {
      problem(`can't read ${shownRoot}${r}: ${why(e)}`);
      continue;
    }
    if (stat.isDirectory()) {
      if (!name.startsWith(".") && name !== "node_modules") {
        walk(root, r, shownRoot, into);
      }
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

/** The file a path names, or the files in the folder it names. */
function entries(path: string): Entry[] {
  let stat;
  try {
    stat = statSync(path);
  } catch (e) {
    problem(`can't read ${path}: ${why(e)}`);
    return [];
  }
  if (!stat.isDirectory()) {
    return [{ path, shown: path, rel: basename(path), named: true }];
  }
  const trimmed = path.replace(/[\\/]+$/, "") || path;
  const list: Entry[] = [];
  walk(path, "", trimmed === "." ? "" : `${trimmed}/`, list);
  return list;
}

function read(entry: Entry): Uint8Array | null {
  try {
    return new Uint8Array(readFileSync(entry.path));
  } catch (e) {
    problem(`can't read ${entry.shown}: ${why(e)}`);
    return null;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return new TextDecoder().decode(Buffer.concat(chunks));
}

const matches = (reports: Report[], on: FailOn) =>
  reports.some((r) =>
    r.findings.some((f) =>
      on === "any" ? f.kind === "private" || f.kind === "label" : f.kind === on,
    ),
  );

/** Reports; true when --fail-on matched. */
async function runInspect(args: Extract<Args, { command: "inspect" }>) {
  const reports: Report[] = [];
  const show = (report: Report) => {
    reports.push(report);
    if (!args.json) {
      out((reports.length > 1 ? "\n" : "") + formatReport(report, args.all));
    }
  };
  for (const path of args.paths) {
    if (path === "-") {
      let plain;
      try {
        plain = await readStdin();
      } catch (e) {
        problem(`can't read stdin: ${why(e)}`);
        continue;
      }
      show({ ...(await inspect({ kind: "text", plain })), name: "stdin" });
      continue;
    }
    for (const entry of entries(path)) {
      const bytes = read(entry);
      if (!bytes) continue;
      try {
        show(await inspect({ kind: "file", name: entry.shown, bytes }));
      } catch (e) {
        problem(`can't read ${entry.shown}: ${why(e)}`);
      }
    }
  }
  if (args.json) out(JSON.stringify(reports, null, 2) + "\n");
  return args.failOn !== null && matches(reports, args.failOn);
}

/** photo.jpg → photo.clean.jpg */
function cleanName(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? `${name.slice(0, dot)}.clean${name.slice(dot)}`
    : `${name}.clean`;
}

const isCleanCopy = (name: string) => /\.clean(\.[^.]*)?$/i.test(name);

/** Clean copies, never over an original, over an earlier copy only with
 * --force. */
async function runClean(args: Extract<Args, { command: "clean" }>) {
  let labelsRemoved = false;
  let blocks = 0;
  const print = (name: string, under: string[]) =>
    out((blocks++ ? "\n" : "") + block(name, under));
  /** This run's copies, so two inputs can't write the same one. */
  const written = new Set<string>();

  for (const entry of args.paths.flatMap(entries)) {
    const name = basename(entry.path);
    if (isCleanCopy(name)) {
      // A folder's own clean copies are passed over without a word.
      if (entry.named)
        print(entry.shown, ["Already a clean copy, so left as it is."]);
      continue;
    }
    const bytes = read(entry);
    if (!bytes) continue;
    let result;
    try {
      result = await clean(
        { kind: "file", name, bytes },
        { removeLabels: args.removeLabels },
      );
    } catch (e) {
      problem(`can't clean ${entry.shown}: ${why(e)}`);
      continue;
    }
    if (!result.cleaned) {
      // A kind of file tellall can't read is listed, not an error.
      if (result.notes[0] !== words.clean.unknown) failed = true;
      print(entry.shown, result.notes);
      continue;
    }

    const target = args.out
      ? join(args.out, dirname(entry.rel), cleanName(name))
      : join(dirname(entry.path), cleanName(name));
    const shownTarget = args.out
      ? relative(".", target).split("\\").join("/")
      : entry.shown.slice(0, -name.length) + cleanName(name);
    const key = resolve(target).toLowerCase();
    if (written.has(key)) {
      failed = true;
      print(entry.shown, [
        `${shownTarget} was already written from another file, so it's left as it is.`,
      ]);
      continue;
    }
    try {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, result.output, { flag: args.force ? "w" : "wx" });
    } catch (e) {
      failed = true;
      print(entry.shown, [
        codeOf(e) === "EEXIST"
          ? `${shownTarget} is already there. Add --force to replace it.`
          : `Couldn't write ${shownTarget}: ${why(e)}`,
      ]);
      continue;
    }
    written.add(key);
    // The notice about labels comes once, at the end.
    const notes = result.notes.filter((n) => n !== words.clean.labelsRemoved);
    if (notes.length < result.notes.length) labelsRemoved = true;
    print(entry.shown, [`Wrote ${shownTarget}`, ...notes.map((n) => `· ${n}`)]);
  }
  if (labelsRemoved) {
    out(`${blocks ? "\n" : ""}${words.clean.labelsRemoved}\n`);
  }
}

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    process.stderr.write(`tellall: ${e.message}\n\n${USAGE}`);
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
