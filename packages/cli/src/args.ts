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
    }
  | {
      command: "clean";
      paths: string[];
      out: string | null;
      removeLabels: boolean;
      force: boolean;
    };

export const USAGE = `Usage:
  tellall [options] [--] <file|dir|-> ...
    Plain-sentence report; "-" reads text from stdin.
    --json                       machine-readable reports
    --all                        also print raw fields
    --fail-on private|label|any  exit 1 if any input has that kind of finding
  tellall clean [options] [--] <file|dir> ...
    Write clean copies, never touching originals.
    -o, --out <dir>              where to write (default: next to each file, name.clean.ext)
    --remove-labels              also remove AI labels (C2PA, AI-source tags); files you own
    --force                      replace .clean copies already there
  tellall -h, --help             this text
  tellall -v, --version          the version number

Put -- before the paths so a name starting with "-" isn't read as an option.
Folders are read all the way down, except links, node_modules and folders
whose names start with a dot; tellall says how many it skipped.

Exit codes: 0 done; 1 --fail-on matched; 2 usage, read or write error, also
when clean can't make a copy (a damaged file, or a copy already there without
--force). A file of a kind tellall can't read is listed and doesn't change
the exit code.
`;

export class UsageError extends Error {}

const FAIL_ON: readonly string[] = ["private", "label", "any"];
const INSPECT_FLAGS: readonly string[] = ["--json", "--all", "--fail-on"];
const CLEAN_FLAGS: readonly string[] = [
  "-o",
  "--out",
  "--remove-labels",
  "--force",
];

/** The arguments after `node tellall.js`. Throws UsageError. */
export function parseArgs(argv: string[]): Args {
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
      const other = cleaning ? INSPECT_FLAGS : CLEAN_FLAGS;
      throw new UsageError(
        other.includes(flag)
          ? `${flag} goes with "tellall${cleaning ? "" : " clean"}".`
          : `Unknown option: ${flag}`,
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
        ? "Name a file or folder to clean."
        : "Name a file, folder or -.",
    );
  }
  if (cleaning) {
    if (paths.includes("-")) {
      throw new UsageError("clean takes files and folders, not stdin.");
    }
    return {
      command: "clean",
      paths,
      out,
      removeLabels: flags.has("--remove-labels"),
      force: flags.has("--force"),
    };
  }
  if (paths.filter((p) => p === "-").length > 1) {
    throw new UsageError('"-" can be given once.');
  }
  return {
    command: "inspect",
    paths,
    json: flags.has("--json"),
    all: flags.has("--all"),
    failOn,
  };
}
