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
  tellall <file|dir|-> ...            plain-sentence report; "-" reads text from stdin
          --json                      machine-readable reports
          --all                       also print raw fields
          --fail-on private|label|any exit 1 if any input has that kind of finding
  tellall clean <file|dir> ...        write clean copies, never touching originals
          -o, --out <dir>             where to write (default: next to each file, name.clean.ext)
          --remove-labels             also remove AI labels (C2PA, AI-source tags); files you own
          --force                     overwrite existing .clean files
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

  /** A flag's value: `--flag value` or `--flag=value`. */
  const valueOf = (flag: string, inline: string | undefined) => {
    const value = inline ?? rest.shift();
    if (value === undefined || value === "") {
      throw new UsageError(`${flag} needs a value.`);
    }
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
    const eq = arg.indexOf("=");
    const flag = arg.startsWith("--") && eq > 0 ? arg.slice(0, eq) : arg;
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
