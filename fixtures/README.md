# Fixtures

Captured on 2026-10-25.

## `ai/`

Copied unchanged from the image research samples:

- `chatgpt-image.png`: image generated in ChatGPT, downloaded from chatgpt.com
- `gemini-image.jpg`: image generated in Gemini, downloaded from gemini.google.com
- `paint-drawing.png`, `paint-drawing.jpg`: drawing saved from Microsoft Paint

## `text/`

Copied from the text research samples, captured with `xcheck.py capture <label>` from the Windows clipboard. Same prompt in each app, new chat, default model, Chromium on Windows. ChatGPT, Claude and Gemini web apps, each copied two ways: the copy button (`*-button`) and select + Ctrl+C (`*-select`).

- `*.txt`: the `CF_UNICODETEXT` clipboard text, UTF-8
- `*.html`: the raw Windows `HTML Format` clipboard blob (header with `StartHTML`/`EndHTML`/`StartFragment`/`EndFragment` byte offsets and, for the copy button, `SourceURL`)
- `*.formats.txt`: the clipboard format names that were present

### Scrubbed

The copy-button HTML carried the private chat link and, for Gemini, a response ID. These were replaced by zeros of the same length, on the raw bytes (encoding and line endings unchanged):

- `SourceURL` `https://chatgpt.com/c/<uuid>` and `https://claude.ai/chat/<uuid>` → `00000000-0000-0000-0000-000000000000`
- `SourceURL` `https://gemini.google.com/u/0/app/<id>` → `0000000000000000`
- `id="model-response-message-contentr_<id>"` → `contentr_0000000000000000`

Nothing else changed. Because every replacement keeps its length, the header offsets are unchanged; they were checked to still land on `<html>`, the end of `<!--StartFragment-->`, `<!--EndFragment-->` and the end of the file. The `.txt` and `.formats.txt` files contained no links or IDs.

Left as is: `_ngcontent-ng-c<digits>` in the Gemini HTML is an Angular style-scope name from Gemini's build, not tied to the account.

## `expected/`

Golden reports checked by `packages/engine/test/inspect.test.ts` (rewritten with `UPDATE=1`, then checked by hand). Each is named after the fixture file it checks, with the dot replaced by a hyphen: `chatgpt-image.png` → `chatgpt-image-png.json`, `gps.jpg` → `gps-jpg.json`. A text fixture is a pair; its report is built from the formatted copy, so it is named after the `.html` file: `chatgpt-web-button.html` → `chatgpt-web-button-html.json`.
