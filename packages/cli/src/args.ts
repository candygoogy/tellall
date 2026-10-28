// The command line, read by hand (spec §5.2): no dependency for it.

export type FailOn = "private" | "label" | "any";

export type Args =
  | { command: "help" }
  | { command: "version" }
  | {
      command: "inspect";
      paths: string[];
      json: boolean;
      all: boolean;
      failOn: FailOn | null;
      /** False with --no-color. */
      color: boolean;
    }
  | {
      command: "clean";
      paths: string[];
      out: string | null;
      removeLabels: boolean;
      force: boolean;
      always: boolean;
      /** False with --no-color. */
      color: boolean;
    };

export const SUMMARY =
  "Shows what an image or a text tells about you, and writes clean copies without it.";

/** The one line shown after a usage error. */
export const USAGE_LINE =
  "Usage: tellall [options] [--] <file|dir|-> ...   or   tellall clean [options] [--] <file|dir|-> ...";
export const USAGE_LINE_CLEAN =
  "Usage: tellall clean [options] [--] <file|dir|-> ...";

export const USAGE = `${SUMMARY}

Usage:
  tellall [options] [--] <file|dir|-> ...
    Plain-sentence report; "-" reads text from stdin.
    --json                       machine-readable reports
    --all                        also print raw fields
    --fail-on private|label|any  exit 1 if any input has that kind of finding
    --no-color                   no colours (also when NO_COLOR is set)
  tellall clean [options] [--] <file|dir|-> ...
    Write clean copies, never touching originals; "-" cleans text from
    stdin and writes it to stdout.
    -o, --out <dir>              where to write (default: next to each file, name.clean.ext)
    --remove-labels              also remove AI labels (C2PA, AI-source tags); files you own
    --force                      replace .clean copies already there
    --always                     also write a copy when nothing is removed
    --no-color                   no colours (also when NO_COLOR is set)
  tellall -h, --help             this text
  tellall -v, --version          the version number

Examples:
  tellall -- photo.jpg                   what does this file tell about you?
  tellall clean -- holiday-photos        write clean copies of a folder's images
  tellall --fail-on private -- public   in CI: exit 1 if an image has personal data

tellall reads JPEG, PNG, WebP and HEIC images, and texts: .txt and .md
files, and stdin. A .txt that is really an image is read as the image.

Put -- before the paths so a name starting with "-" isn't read as an option.
Folders are read all the way down, except links, node_modules and folders
whose names start with a dot; tellall says how many it skipped.

A file with nothing to remove gets no copy unless --always; a copy already
there is left as it is unless --force.

Exit codes: 0 done; 1 --fail-on matched; 2 usage, read or write error, also
when clean can't make a copy of a damaged file. A file of a kind tellall
can't read is listed and doesn't change the exit code.
`;

export class UsageError extends Error {
  /** Whether the slip was in a `clean` command. */
  cleaning = false;
}

/** Edit distance between two short strings. */
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        (next[j - 1] as number) + 1,
        (row[j] as number) + 1,
        (row[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    row = next;
  }
  return row[b.length] as number;
}

/** The known flag nearest to `flag`, if it is within 2 edits. */
function nearest(flag: string, known: readonly string[]): string | null {
  if (flag.length < 3) return null;
  let best: string | null = null;
  let bestDistance = 3;
  for (const k of known) {
    if (k.length < 3) continue;
    const d = distance(flag, k);
    if (d < bestDistance) {
      best = k;
      bestDistance = d;
    }
  }
  return best;
}

const FAIL_ON: readonly string[] = ["private", "label", "any"];
const INSPECT_FLAGS: readonly string[] = [
  "--json",
  "--all",
  "--fail-on",
  "--no-color",
];
const CLEAN_FLAGS: readonly string[] = [
  "-o",
  "--out",
  "--remove-labels",
  "--force",
  "--always",
  "--no-color",
];

/** The arguments after `node tellall.js`. Throws UsageError. */
export function parseArgs(argv: string[]): Args {
  const cleaning = argv[0] === "clean";
  try {
    return parse(argv);
  } catch (e) {
    if (e instanceof UsageError) e.cleaning = cleaning;
    throw e;
  }
}

function parse(argv: string[]): Args {
  const rest = [...argv];
  const cleaning = rest[0] === "clean";
  if (cleaning) rest.shift();

  const paths: string[] = [];
  const flags = new Set<string>();
  let failOn: FailOn | null = null;
  let out: string | null = null;
  let onlyPaths = false;

  /** A flag's value: `--flag value` or `--flag=value`. A next argument
   * that starts with "-" is another flag, not the value. */
  const valueOf = (flag: string, inline: string | undefined) => {
    if (inline !== undefined) {
      if (inline === "") throw new UsageError(`${flag} needs a value.`);
      return inline;
    }
    const value = rest[0];
    if (value === undefined || value === "") {
      throw new UsageError(`${flag} needs a value.`);
    }
    if (value.startsWith("-")) {
      throw new UsageError(
        `${flag} needs a value; ${value} looks like an option. For a value that starts with "-", write ${flag}=${value}.`,
      );
    }
    rest.shift();
    return value;
  };

  while (rest.length) {
    const arg = rest.shift() as string;
    if (onlyPaths || arg === "-" || !arg.startsWith("-")) {
      paths.push(arg);
      continue;
    }
    if (arg === "--") {
      onlyPaths = true;
      continue;
    }
    // `--out=dir`, and `-o=dir` too.
    const eq = arg.indexOf("=");
    const flag = eq > 1 ? arg.slice(0, eq) : arg;
    const inline = flag === arg ? undefined : arg.slice(eq + 1);
    if (flag === "-h" || flag === "--help") return { command: "help" };
    if (flag === "-v" || flag === "--version") return { command: "version" };
    if (!(cleaning ? CLEAN_FLAGS : INSPECT_FLAGS).includes(flag)) {
      const other = (cleaning ? INSPECT_FLAGS : CLEAN_FLAGS).filter(
        (f) => f !== "--no-color",
      );
      const near = nearest(flag, [
        ...(cleaning ? CLEAN_FLAGS : INSPECT_FLAGS),
        "--help",
        "--version",
      ]);
      throw new UsageError(
        other.includes(flag)
          ? cleaning
            ? `${flag} is for reports, not for clean.`
            : `${flag} is only for tellall clean.`
          : `unknown option ${flag}${near ? `; did you mean ${near}?` : "."}`,
      );
    }
    if (flag === "--fail-on") {
      const value = valueOf(flag, inline);
      if (!FAIL_ON.includes(value)) {
        throw new UsageError(`--fail-on takes private, label or any.`);
      }
      failOn = value as FailOn;
    } else if (flag === "-o" || flag === "--out") {
      out = valueOf(flag, inline);
    } else {
      if (inline !== undefined) throw new UsageError(`${flag} takes no value.`);
      flags.add(flag);
    }
  }

  if (!paths.length) {
    throw new UsageError(
      cleaning
        ? "name a file, folder or - to clean."
        : "name a file, folder or -.",
    );
  }
  if (paths.filter((p) => p === "-").length > 1) {
    throw new UsageError('"-" can be given once.');
  }
  if (cleaning) {
    return {
      command: "clean",
      paths,
      out,
      removeLabels: flags.has("--remove-labels"),
      force: flags.has("--force"),
      always: flags.has("--always"),
      color: !flags.has("--no-color"),
    };
  }
  return {
    command: "inspect",
    paths,
    json: flags.has("--json"),
    all: flags.has("--all"),
    failOn,
    color: !flags.has("--no-color"),
  };
}
