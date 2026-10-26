// The built command (dist/tellall.js) run as users run it, in a Node
// process of its own, on the fixtures and on copies in a temp folder.
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const CLI_DIR = fileURLToPath(new URL("..", import.meta.url));
const ROOT = join(CLI_DIR, "../..");
const BIN = join(CLI_DIR, "dist/tellall.js");
const CHATGPT = join(ROOT, "fixtures/ai/chatgpt-image.png");
const NOTICE =
  "AI labels removed. The invisible watermark in the pixels (if any) stays; this tool can't remove it.";

let tmp: string;

beforeAll(() => {
  execFileSync(process.execPath, [join(CLI_DIR, "build.mjs")]);
  tmp = mkdtempSync(join(tmpdir(), "tellall-cli-"));
});

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

function tellall(args: string[], opts: { input?: string; cwd?: string } = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd: opts.cwd ?? ROOT,
    input: opts.input ?? "",
    encoding: "utf8",
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** A new folder in the temp folder, with copies of the given files. */
function folder(name: string, files: Record<string, string | Buffer>) {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, from] of Object.entries(files)) {
    const to = join(dir, file);
    if (typeof from === "string") copyFileSync(from, to);
    else writeFileSync(to, from);
  }
  return dir;
}

describe("tellall <file>", () => {
  test("says the ChatGPT image's label in sentences", () => {
    const r = tellall([CHATGPT]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("This image says it was made by AI.");
    expect(r.out).toContain("OpenAI OpCo, LLC");
  });

  test("prints the spec's example (§5.2) as it stands", () => {
    const r = tellall(["chatgpt-image.png"], {
      cwd: join(ROOT, "fixtures/ai"),
    });
    expect(r.out).toBe(
      [
        "chatgpt-image.png",
        "  This image says it was made by AI.",
        "  · Signed with a certificate issued to OpenAI OpCo, LLC. The signature matches this file.",
        "  · Made with ChatGPT (gpt-image) on 25 Oct 2026 at 14:46:19 UTC.",
        "  · The label says OpenAI also put an invisible watermark in the pixels. A clean copy can't remove it.",
        "  · No location, camera or other personal data.",
        "",
      ].join("\n"),
    );
  });

  test("--all adds the raw fields under their sentence", () => {
    const r = tellall(["--all", CHATGPT]);
    expect(r.out).toContain(
      "      Signer: OpenAI OpCo, LLC (C2PA signature)\n",
    );
  });

  test("--json prints the reports and nothing else", () => {
    const r = tellall(["--json", CHATGPT]);
    expect(r.code).toBe(0);
    const reports = JSON.parse(r.out);
    expect(reports).toHaveLength(1);
    expect(reports[0].findings[0].group).toBe("ai-label");
  });

  test("--fail-on matches the kind of finding asked for", () => {
    expect(tellall(["--fail-on", "label", CHATGPT]).code).toBe(1);
    expect(tellall(["--fail-on", "any", CHATGPT]).code).toBe(1);
    expect(tellall(["--fail-on", "private", CHATGPT]).code).toBe(0);
  });

  test('"-" reads a text from stdin', () => {
    const r = tellall(["-"], { input: "a\u200Bb\n" });
    expect(r.code).toBe(0);
    expect(r.out).toContain("This text has 1 hidden character.");
  });

  test("a folder lists what it can't read and carries on", () => {
    const gif = Buffer.from(
      "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
      "base64",
    );
    const dir = folder("scan", { "a.gif": gif, "b.png": CHATGPT });
    const r = tellall([dir]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(
      "a.gif\n  tellall can't read this kind of file yet.",
    );
    expect(r.out).toContain("b.png\n  This image says it was made by AI.");
  });

  test("a usage error exits 2 with the usage on stderr", () => {
    const r = tellall([]);
    expect(r.code).toBe(2);
    expect(r.out).toBe("");
    expect(r.err).toContain("Usage");
    expect(tellall(["--fail-on", "maybe", CHATGPT]).code).toBe(2);
  });

  test("a file that isn't there exits 2", () => {
    const r = tellall([join(tmp, "nothing-here.png")]);
    expect(r.code).toBe(2);
  });
});

describe("tellall clean", () => {
  test("--remove-labels writes a copy without the label, once", () => {
    const dir = folder("clean", { "chatgpt-image.png": CHATGPT });
    const original = readFileSync(join(dir, "chatgpt-image.png"));
    const r = tellall([
      "clean",
      "--remove-labels",
      join(dir, "chatgpt-image.png"),
    ]);
    expect(r.code).toBe(0);
    const copy = readFileSync(join(dir, "chatgpt-image.clean.png"));
    expect(copy.includes("caBX")).toBe(false);
    expect(r.out.split(NOTICE)).toHaveLength(2);
    expect(readFileSync(join(dir, "chatgpt-image.png"))).toEqual(original);

    // Again: the copy is there, so it stays as it is without --force.
    const before = statSync(join(dir, "chatgpt-image.clean.png")).mtimeMs;
    const again = tellall([
      "clean",
      "--remove-labels",
      join(dir, "chatgpt-image.png"),
    ]);
    expect(again.code).toBe(2);
    expect(readFileSync(join(dir, "chatgpt-image.clean.png"))).toEqual(copy);
    expect(statSync(join(dir, "chatgpt-image.clean.png")).mtimeMs).toBe(before);

    // --force writes it again.
    const forced = tellall([
      "clean",
      "--force",
      join(dir, "chatgpt-image.png"),
    ]);
    expect(forced.code).toBe(0);
    expect(
      readFileSync(join(dir, "chatgpt-image.clean.png")).includes("caBX"),
    ).toBe(true);
    expect(forced.out).not.toContain(NOTICE);
  });

  test("-o keeps a folder's structure and skips clean copies", () => {
    const dir = folder("tree", { "a.png": CHATGPT });
    folder("tree/sub", { "b.png": CHATGPT, "b.clean.png": CHATGPT });
    const out = join(tmp, "tree-out");
    const r = tellall(["clean", "-o", out, dir]);
    expect(r.code).toBe(0);
    expect(statSync(join(out, "a.clean.png")).isFile()).toBe(true);
    expect(statSync(join(out, "sub/b.clean.png")).isFile()).toBe(true);
    expect(() => statSync(join(out, "sub/b.clean.clean.png"))).toThrow();
  });

  test("stdin can't be cleaned", () => {
    expect(tellall(["clean", "-"]).code).toBe(2);
  });
});
