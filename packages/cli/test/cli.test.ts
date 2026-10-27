// The built command (dist/tellall.js) run as users run it, in a Node
// process of its own, on the fixtures and on copies in a temp folder.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
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
const GPS = join(ROOT, "fixtures/photo/gps.jpg");
const DAMAGED = join(ROOT, "fixtures/photo/damaged.jpg");
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

function tellall(
  args: string[],
  opts: { input?: string | Buffer; cwd?: string } = {},
) {
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
    expect(r.err).toContain("Usage: tellall");
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

/** The temp files a write left in a folder: none, if all went well. */
const leftovers = (dir: string) =>
  readdirSync(dir).filter((n) => n.endsWith(".tmp"));

describe("clean: which files are inputs", () => {
  test("a name.clean.ext is a copy only with name.ext beside it", () => {
    const dir = folder("own", {
      "holiday.clean.jpg": GPS,
      "b.jpg": GPS,
      "b.clean.jpg": GPS,
    });
    const r = tellall(["clean", "--force", dir]);
    expect(r.code).toBe(0);
    // The user's own holiday.clean.jpg is cleaned like any other file.
    expect(statSync(join(dir, "holiday.clean.clean.jpg")).isFile()).toBe(true);
    // b.clean.jpg is tellall's: replaced, not cleaned again.
    expect(readFileSync(join(dir, "b.clean.jpg"))).not.toEqual(
      readFileSync(GPS),
    );
    expect(() => statSync(join(dir, "b.clean.clean.jpg"))).toThrow();
    expect(r.err).toBe("\ntellall: skipped 1 clean copy made earlier.\n");
  });

  test("several folders keep their names under -o; a file named twice is cleaned once", () => {
    folder("col/d1", { "gps.jpg": GPS });
    folder("col/d2", { "gps.jpg": GPS });
    const out = join(tmp, "col-out");
    const r = tellall([
      "clean",
      "-o",
      out,
      join(tmp, "col/d1"),
      join(tmp, "col/d2"),
      join(tmp, "col/d1/gps.jpg"),
    ]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out.split("Wrote ")).toHaveLength(3);
    expect(statSync(join(out, "d1/gps.clean.jpg")).isFile()).toBe(true);
    expect(statSync(join(out, "d2/gps.clean.jpg")).isFile()).toBe(true);
  });
});

describe("clean: writing copies", () => {
  test("--force replaces the copy, not a file linked to it", () => {
    const dir = folder("links", { "gps.jpg": GPS, "keep.jpg": CHATGPT });
    linkSync(join(dir, "keep.jpg"), join(dir, "gps.clean.jpg"));
    const r = tellall(["clean", "--force", join(dir, "gps.jpg")]);
    expect(r.code).toBe(0);
    expect(readFileSync(join(dir, "keep.jpg"))).toEqual(readFileSync(CHATGPT));
    expect(readFileSync(join(dir, "gps.clean.jpg"))).not.toEqual(
      readFileSync(CHATGPT),
    );
    expect(leftovers(dir)).toEqual([]);
  });

  test("a copy already there is an error on stderr, and nothing is left behind", () => {
    const dir = folder("again", { "gps.jpg": GPS });
    expect(tellall(["clean", join(dir, "gps.jpg")]).code).toBe(0);
    const before = readFileSync(join(dir, "gps.clean.jpg"));
    const r = tellall(["clean", join(dir, "gps.jpg")]);
    expect(r.code).toBe(2);
    expect(r.out).toBe("");
    expect(r.err).toMatch(/gps\.clean\.jpg is already there; add --force/);
    expect(readFileSync(join(dir, "gps.clean.jpg"))).toEqual(before);
    expect(leftovers(dir)).toEqual([]);
  });

  test("-o naming a file says so", () => {
    const dir = folder("ofile", { "gps.jpg": GPS, afile: CHATGPT });
    const r = tellall([
      "clean",
      "--force",
      "-o",
      join(dir, "afile"),
      join(dir, "gps.jpg"),
    ]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/afile is a file, not a folder\.\n$/);
    expect(r.err).not.toContain("--force");
  });

  test("a damaged file: inspect exits 0, clean exits 2 and says why on stderr", () => {
    expect(tellall([DAMAGED]).code).toBe(0);
    const dir = folder("damaged", { "damaged.jpg": DAMAGED });
    const r = tellall(["clean", join(dir, "damaged.jpg")]);
    expect(r.code).toBe(2);
    expect(r.out).toBe("");
    expect(r.err).toContain("damaged, so it can't make a clean copy");
  });
});

describe("folders", () => {
  test("links inside a folder are skipped and counted; a link named by itself is read", () => {
    const dir = folder("loop/sub", { "gps.jpg": GPS });
    const loop = join(tmp, "loop");
    // A junction on Windows, a folder link elsewhere: back up to loop/.
    symlinkSync(loop, join(dir, "back"), "junction");
    const r = tellall([loop]);
    expect(r.code).toBe(0);
    expect(r.out.match(/gps\.jpg\n/g)).toHaveLength(1);
    expect(r.err).toContain("skipped 1 link inside folders");
    const named = tellall([join(dir, "back")]);
    expect(named.code).toBe(0);
    expect(named.out).toMatch(/back\/sub\/gps\.jpg\n/);
  });

  test("dot-folders and node_modules are skipped and counted", () => {
    folder("pub/.assets", { "gps.jpg": GPS });
    folder("pub/node_modules/x", { "gps.jpg": GPS });
    folder("pub/ok", { "b.png": CHATGPT });
    const r = tellall(["--fail-on", "private", join(tmp, "pub")]);
    expect(r.code).toBe(0);
    expect(r.err).toBe(
      "\ntellall: skipped 2 folders named node_modules or starting with a dot.\n",
    );
  });
});

describe("reading", () => {
  /** A file over 2 GiB, more than Node reads into one buffer, that starts
   * with an ISO media header: reading it all fails. */
  function huge(name: string, ftyp: string) {
    const file = join(folder("huge", {}), name);
    const head = Buffer.alloc(32);
    head.writeUInt32BE(32, 0);
    head.write(ftyp, 4);
    writeFileSync(file, head);
    truncateSync(file, 2 ** 31 + 2 ** 20);
    return file;
  }

  test.each([
    ["long.mp4", "ftypisomisomiso2mp41"],
    // An AVIF lists plain HEIF's brand too.
    ["photo.avif", "ftypmif1\0\0\0\0avifmiaf"],
  ])(
    "a file of another kind is listed without being read, whatever its size (%s)",
    (name, ftyp) => {
      const file = huge(name, ftyp);
      try {
        const r = tellall(["--fail-on", "any", file]);
        expect(r.err).toBe("");
        expect(r.code).toBe(0);
        expect(r.out).toContain("tellall can't read this kind of file yet.");
        expect(tellall(["clean", file]).code).toBe(0);
      } finally {
        rmSync(file);
      }
    },
  );

  test("a file of a kind the engine reads is read in full", () => {
    const file = huge("photo.heic", "ftypheic\0\0\0\0mif1heic");
    try {
      const r = tellall([file]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("it's larger than 2 GiB");
    } finally {
      rmSync(file);
    }
  });

  test("stops quietly when the reader of its output goes away", async () => {
    const child = spawn(
      process.execPath,
      [BIN, join(ROOT, "fixtures/photo"), join(ROOT, "fixtures/ai")],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stdout.destroy();
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    const code = await new Promise((done) => child.on("close", done));
    expect(err).toBe("");
    expect(code).toBe(0);
  });

  test.runIf(process.platform === "win32")(
    "error messages show paths with one kind of slash",
    () => {
      const r = tellall([join(tmp, "nothing-here.png")]);
      expect(r.err).toMatch(
        /^tellall: can't read [^\\]+: no such file or folder\n$/,
      );
    },
  );
});

describe("stdin", () => {
  test("a byte-order mark is kept for the scan", () => {
    const r = tellall(["--json", "-"], {
      input: Buffer.from("﻿hello\n"),
    });
    expect(r.out).toContain("U+FEFF");
  });

  test("UTF-16 is read by its byte-order mark", () => {
    const r = tellall(["-"], {
      input: Buffer.from("﻿a​b\n", "utf16le"),
    });
    expect(r.out).toContain("This text has 1 hidden character.");
    expect(r.out).toContain("U+200B");
  });

  test("bytes that aren't UTF-8 are said, not silently replaced", () => {
    const r = tellall(["-"], { input: Buffer.from("caf\xe9\n", "latin1") });
    expect(r.code).toBe(0);
    expect(r.out).toContain("isn't valid UTF-8");
  });
});

describe("arguments", () => {
  test("-o doesn't take the next option as its folder; -o=dir works", () => {
    const dir = folder("oflag", { "gps.jpg": GPS });
    const r = tellall(["clean", join(dir, "gps.jpg"), "-o", "--force"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("-o needs a value; --force looks like an option.");
    const ok = tellall(["clean", join(dir, "gps.jpg"), `-o=${join(dir, "o")}`]);
    expect(ok.code).toBe(0);
    expect(statSync(join(dir, "o/gps.clean.jpg")).isFile()).toBe(true);
  });

  test("--help lists -h, -v and the exit codes", () => {
    const r = tellall(["--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("tellall -h, --help");
    expect(r.out).toContain("tellall -v, --version");
    expect(r.out).toContain(
      "Exit codes: 0 done; 1 --fail-on matched; 2 usage, read or write error",
    );
  });
});

describe("usage errors and help", () => {
  test("a usage error is short: message, one usage line, where to look", () => {
    const r = tellall(["--fail-on", "maybe", CHATGPT]);
    expect(r.code).toBe(2);
    expect(r.out).toBe("");
    const lines = r.err.trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("tellall: --fail-on takes private, label or any.");
    expect(lines[1]).toMatch(/^Usage: tellall /);
    expect(lines[2]).toBe("Run tellall --help for all options.");
    expect(r.err).not.toContain("Exit codes");
    const c = tellall(["clean"]);
    expect(c.err).toContain("tellall: name a file or folder to clean.");
    expect(c.err).toContain("Usage: tellall clean [options]");
  });

  test("an unknown flag suggests the nearest one within 2 edits", () => {
    expect(tellall(["--jsn", CHATGPT]).err).toContain(
      "tellall: unknown option --jsn; did you mean --json?",
    );
    expect(tellall(["clean", "--forse", GPS]).err).toContain(
      "did you mean --force?",
    );
    const far = tellall(["--banana", CHATGPT]);
    expect(far.code).toBe(2);
    expect(far.err).toContain("tellall: unknown option --banana.\n");
    expect(far.err).not.toContain("did you mean");
  });

  test("--help opens with a description and ends with three examples", () => {
    const r = tellall(["--help"]);
    expect(r.code).toBe(0);
    expect(r.out.split("\n")[0]).toMatch(
      /^Shows what an image or a text tells/,
    );
    const examples = r.out.slice(r.out.indexOf("Examples:")).split("\n");
    const shown = examples.filter((l) => /^ {2}tellall /.test(l));
    expect(shown).toHaveLength(3);
    expect(shown[0]).toContain("tellall -- ");
    expect(shown[1]).toContain("tellall clean -- ");
    expect(shown[2]).toContain("tellall --fail-on private -- ");
  });
});

describe("clean: what was removed", () => {
  test("a copy lists what was removed, with the byte count", () => {
    const dir = folder("removed", {
      "gps.jpg": GPS,
      "chatgpt-image.png": CHATGPT,
    });
    const r = tellall([
      "clean",
      join(dir, "gps.jpg"),
      join(dir, "chatgpt-image.png"),
    ]);
    expect(r.code).toBe(0);
    const bytes =
      readFileSync(GPS).length -
      readFileSync(join(dir, "gps.clean.jpg")).length;
    const m = /gps\.clean\.jpg\n {2}Removed (.+): ([\d,]+) bytes\.\n/.exec(
      r.out,
    );
    expect(m?.[1]).toContain("location");
    expect(Number(m?.[2]?.replaceAll(",", ""))).toBe(bytes);
    // Nothing removed: no Removed line, the note says so.
    expect(r.out).toMatch(
      /chatgpt-image\.png\n {2}Wrote .*\n {2}· Nothing private/,
    );
  });

  test("a re-run says copies are already there in one line", () => {
    const dir = folder("rerun", { "a.jpg": GPS, "b.jpg": GPS, "c.jpg": GPS });
    const files = ["a.jpg", "b.jpg", "c.jpg"].map((f) => join(dir, f));
    expect(tellall(["clean", ...files]).code).toBe(0);
    const r = tellall(["clean", ...files]);
    expect(r.code).toBe(2);
    expect(r.out).toBe("");
    expect(r.err).toBe(
      "tellall: 3 clean copies already there; add --force to replace them.\n",
    );
  });

  test("an error after a block has a blank line before it and says tellall once", () => {
    const dir = folder("between", {
      "a.jpg": GPS,
      "damaged.jpg": DAMAGED,
      "z.png": CHATGPT,
    });
    const r = tellall(["clean", dir]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(
      /^\ntellall: \S+damaged\.jpg: this file is damaged, so it can't make a clean copy of it\.\n$/,
    );
    expect(r.err.match(/tellall: /g)).toHaveLength(1);
  });
});
