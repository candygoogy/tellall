// The reader's pure helpers: a pasted text's name, and what the sidebar's
// dot says for each kind of result.
import { describe, expect, test } from "vitest";
import { inspect } from "@tellall/engine";
import { dotFor, statusHTML, textName } from "../src/view/reader-html.ts";

describe("textName", () => {
  test("the first words, cut at a word, and the whole first line", () => {
    const t = textName(
      "The fall of the Roman Empire had many causes.\nSecond line.",
    );
    expect(t.name).toBe("The fall of the Roman…");
    expect(t.title).toBe("The fall of the Roman Empire had many causes.");
  });

  test("short text as it is, hidden characters left out", () => {
    expect(textName("\n  Send it​ today.\u{E0041}\n").name).toBe(
      "Send it today.",
    );
  });

  test("the site, when the copy carries the page's address", async () => {
    const plain = "Here is the summary you asked for.";
    const html = `Version:0.9\r\nSourceURL:https://chatgpt.com/c/abc123\r\n<!--StartFragment--><p>${plain}</p><!--EndFragment-->`;
    const r = await inspect({ kind: "text", plain, html });
    const t = textName(plain, r);
    expect(t.name).toBe("Here is the summary you… · chatgpt.com");
    expect(t.title).toBe(`${plain} · chatgpt.com`);
  });

  test("an empty text is a new text", () => {
    expect(textName("").name).toBe("New text");
    expect(textName("​").name).toBe("Pasted text");
  });
});

describe("dotFor", () => {
  const file = (name: string, bytes: Uint8Array) =>
    inspect({ kind: "file", name, bytes });

  test("a file of a kind tellall doesn't read: couldn't read", async () => {
    const r = await file("anim.gif", new TextEncoder().encode("GIF89a…"));
    expect(dotFor({ kind: "file", report: r })).toEqual([
      "dot-error",
      "Couldn't read",
    ]);
  });

  test("a reading that failed: couldn't read", () => {
    expect(dotFor({ kind: "file", state: "error" })).toEqual([
      "dot-error",
      "Couldn't read",
    ]);
  });

  test("a text by what it carries", async () => {
    const hidden = await inspect({ kind: "text", plain: "a​b" });
    expect(dotFor({ kind: "text", report: hidden })[1]).toBe(
      "Hidden characters",
    );
    const extras = await inspect({
      kind: "text",
      plain: "hello",
      html: `Version:0.9\r\nSourceURL:https://chatgpt.com/c/1\r\n<p>hello</p>`,
    });
    expect(dotFor({ kind: "text", report: extras })).toEqual([
      "dot-private",
      "Page extras",
    ]);
  });
});

test("the short status says it was read", () => {
  expect(statusHTML("Read on this device in 139 ms")).toContain(
    '<span class="st-short">Read · 139 ms</span>',
  );
});
