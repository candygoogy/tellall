// The README's examples are real output (spec §9: every claim reproduced
// from fixtures). Each ```-block in README.md that starts with
// `$ npx tellall` is checked:
// - a report (`$ npx tellall <files>`): each file's headline and bullets
//   must be its golden report's, fixtures/expected/<name>-<ext>.json, in
//   order, harmless findings left out as the CLI does;
// - `$ npx tellall clean [--remove-labels] <files>`: each file's lines
//   must be what clean() says for that fixture, the label notice must
//   appear exactly when labels were removed, and after two files or more
//   the count line must add up.
import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { clean, words, type Report } from "../src/index.ts";

const REPO = new URL("../../../", import.meta.url);
const README = readFileSync(new URL("README.md", REPO), "utf8").replace(
  /\r\n/g,
  "\n",
);

interface Example {
  args: string[];
  /** Output lines, by the file each block is about. */
  files: { name: string; lines: string[] }[];
  /** Unindented lines after the files (clean's label notice). */
  after: string[];
}

/** The ```-blocks that show a tellall command and what it printed. */
function examples(): Example[] {
  const list: Example[] = [];
  for (const [, body] of README.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)) {
    const [first, ...rest] = (body ?? "").trimEnd().split("\n");
    const command = first?.match(/^\$ npx tellall (.+)$/);
    if (!command?.[1]) continue;
    const args = command[1].split(/\s+/);
    const example: Example = { args, files: [], after: [] };
    for (const line of rest) {
      if (line === "") continue;
      if (line.startsWith("  ")) {
        const file = example.files.at(-1);
        if (!file) throw new Error(`An indented line before a file: ${line}`);
        file.lines.push(line.slice(2));
      } else if (example.files.length && line.endsWith(".")) {
        // A sentence, not a file name.
        example.after.push(line);
      } else {
        example.files.push({ name: line, lines: [] });
      }
    }
    list.push(example);
  }
  return list;
}

/** fixtures/<group>/<name>, by name. */
const FIXTURES = new Map<string, URL>();
for (const group of ["ai", "photo"]) {
  for (const name of readdirSync(new URL(`fixtures/${group}/`, REPO))) {
    FIXTURES.set(name, new URL(`fixtures/${group}/${name}`, REPO));
  }
}

/** chatgpt-image.png → fixtures/expected/chatgpt-image-png.json */
function golden(name: string): Report {
  const file = name.replace(/\.([^.]+)$/, "-$1");
  return JSON.parse(
    readFileSync(new URL(`fixtures/expected/${file}.json`, REPO), "utf8"),
  ) as Report;
}

const paths = (args: string[]) => args.filter((a) => !a.startsWith("-"));

const all = examples();
const reports = all.filter((e) => e.args[0] !== "clean");
const cleans = all.filter((e) => e.args[0] === "clean");

test("the README shows a report and a clean", () => {
  expect(reports.length).toBeGreaterThan(0);
  expect(cleans.length).toBeGreaterThan(0);
});

test.each(reports.map((e) => [e.args.join(" "), e] as const))(
  "report example `npx tellall %s` matches the golden reports",
  (_, example) => {
    expect(example.files.map((f) => f.name)).toEqual(paths(example.args));
    expect(example.after).toEqual([]);
    for (const file of example.files) {
      const report = golden(file.name);
      const bullets = report.findings
        .filter((f) => f.kind !== "harmless")
        .map((f) => `· ${f.sentence}`);
      expect(file.lines, file.name).toEqual([report.headline, ...bullets]);
    }
  },
);

test.each(cleans.map((e) => [e.args.join(" "), e] as const))(
  "clean example `npx tellall %s` matches clean()",
  async (_, example) => {
    const removeLabels = example.args.includes("--remove-labels");
    const names = paths(example.args.slice(1));
    expect(example.files.map((f) => f.name)).toEqual(names);
    let removed = false;
    for (const file of example.files) {
      const url = FIXTURES.get(file.name);
      if (!url) throw new Error(`No fixture named ${file.name}`);
      const result = await clean(
        {
          kind: "file",
          name: file.name,
          bytes: new Uint8Array(readFileSync(url)),
        },
        { removeLabels },
      );
      expect(result.cleaned, file.name).toBe(true);
      const notes = result.notes.filter((n) => n !== words.clean.labelsRemoved);
      if (notes.length < result.notes.length) removed = true;
      const copy = file.name.replace(/(\.[^.]+)$/, ".clean$1");
      // The CLI's "Removed …: N bytes." line, when something was removed:
      // its size is the original's minus the copy's.
      const original = readFileSync(url);
      const size = original.length - result.output.length;
      const gone = file.lines.filter((l) => l.startsWith("Removed "));
      expect(gone.length, file.name).toBe(result.removed.length ? 1 : 0);
      if (gone[0]) {
        expect(gone[0], file.name).toMatch(
          new RegExp(`^Removed .+: ${size.toLocaleString("en-US")} bytes\\.$`),
        );
      }
      expect(
        file.lines.filter((l) => !l.startsWith("Removed ")),
        file.name,
      ).toEqual([
        // A copy that would be the original, byte for byte, isn't written.
        Buffer.compare(result.output as Uint8Array, original) === 0
          ? "No copy written."
          : `Wrote ${copy}`,
        ...notes.map((n) => `· ${n}`),
      ]);
    }
    // After two files or more, the CLI's count line.
    const wrote = example.files.filter((f) =>
      f.lines[0]?.startsWith("Wrote "),
    ).length;
    const nothing = example.files.length - wrote;
    const copies = wrote === 1 ? "1 clean copy" : `${wrote} clean copies`;
    const count =
      example.files.length > 1
        ? [
            `Wrote ${wrote ? copies : "no clean copies"}${nothing ? `; ${nothing} had nothing to remove` : ""}.`,
          ]
        : [];
    expect(example.after).toEqual([
      ...(removed ? [words.clean.labelsRemoved] : []),
      ...count,
    ]);
  },
);
