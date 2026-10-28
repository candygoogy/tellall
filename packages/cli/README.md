# tellall

Shows in plain sentences what an image or a text tells about you (AI labels, location, camera, dates, IDs, hidden characters), and writes clean copies without it. It runs on your machine and makes no network requests.

Needs Node 20.19 or later. Run it with `npx`, or install it once:

```
npm install -g tellall
```

## Examples

What an image says about itself:

```
$ npx tellall -- chatgpt-image.png
chatgpt-image.png
  This image says it was made by AI.
  · Signed with a certificate issued to OpenAI OpCo, LLC. The signature matches this file.
  · Made with ChatGPT (gpt-image) on 25 Oct 2026 at 14:46:19 UTC.
  · The label says OpenAI also put an invisible watermark in the pixels. A clean copy can't remove it.
  · No location, camera or other personal data.
```

Clean copies, next to the originals:

```
$ npx tellall clean -- chatgpt-image.png gps.jpg
chatgpt-image.png
  No copy written.
  · Nothing private to remove.

gps.jpg
  Wrote gps.clean.jpg
  Removed location, camera and device details, dates and times, software names and other details: 951 bytes.

Wrote 1 clean copy; 1 had nothing to remove.
```

After two files or more, a report ends with a count line too, such as `3 files: 1 with an AI label, 1 with personal data and 1 with nothing found.`

Text on stdin, or in a `.txt` or `.md` file (`npx tellall -- notes.txt`):

```
$ printf 'hi\xe2\x80\x8bthere' | npx tellall -
stdin
  This text has 1 hidden character.
  · 1 hidden character: ZERO WIDTH SPACE (U+200B). They don't show, but they travel with the text.
```

The same text without its hidden characters, on stdout; what was removed goes to stderr:

```
$ printf 'hi\xe2\x80\x8bthere' | npx tellall clean - > clean.txt
tellall: removed hidden characters: 3 bytes.
```

`npx tellall clean -- notes.txt` writes `notes.clean.txt` next to it, by the same rules as an image's copy.

To stop a build that would publish photos with personal data in them:

```
npx tellall --fail-on private -- public/images
```

## Options

```
npx tellall [options] [--] <file|dir|-> ...
    Plain-sentence report; "-" reads text from stdin.
    --json                       machine-readable reports
    --all                        also print raw fields
    --fail-on private|label|any  exit 1 if any input has that kind of finding (CI use)
    --no-color                   no colours (also when NO_COLOR is set)
npx tellall clean [options] [--] <file|dir|-> ...
    Write clean copies, never touching originals; "-" cleans text from
    stdin and writes it to stdout.
    -o, --out <dir>              where to write (default: next to each file, name.clean.ext)
    --remove-labels              also remove AI labels (C2PA, AI-source tags); files you own
    --force                      replace .clean copies already there
    --always                     also write a copy when nothing is removed
    --no-color                   no colours (also when NO_COLOR is set)
npx tellall -h, --help           this text
npx tellall -v, --version        the version number
```

tellall reads JPEG, PNG, WebP and HEIC images, and texts: `.txt` and `.md` files, and stdin. A `.txt` that is really an image is read as the image.

Put `--` before the paths so a name starting with `-` isn't read as an option.

Folders are read all the way down, except links, `node_modules` and folders whose names start with a dot; tellall says on stderr how many it skipped.

Text can be UTF-8, or UTF-16 with a byte order mark; tellall says so if it isn't valid UTF-8. Clean text is written as UTF-8.

Reports go to stdout. Errors and skip notes go to stderr. With `clean -`, stdout is the clean text alone and everything else goes to stderr.

On a terminal, file names are bold and each headline and bullet takes the colour of its kind: magenta for an AI label, red for personal data and hidden characters, yellow for a file tellall can't read; nothing found stays uncoloured, as it proves nothing. There's no colour when stdout isn't a terminal, with `--json`, with `--no-color` or when `NO_COLOR` is set; `FORCE_COLOR=1` turns it on where stdout isn't a terminal.

## Clean copies

- `clean` never changes the original. Each copy is written next to its file as `name.clean.ext`, or into the folder given with `-o`. With `-o` and several input folders, each copy goes in a folder named after its input folder.
- A file with nothing to remove gets no copy, because the copy would be the original byte for byte. `--always` writes one anyway.
- A copy that's already there is left as it is, with a note on stderr. `--force` replaces it. Neither case is an error.
- `clean` doesn't clean its own earlier copies again: a `photo.clean.jpg` is skipped when `photo.jpg` sits beside it.
- AI labels stay in the copy unless you add `--remove-labels`, for files you own. That removes the label, not the invisible watermark some generators put in the pixels; no tool here can remove that.

What a copy keeps and removes, field by field: [Clean copies](https://github.com/candygoogy/tellall#clean-copies).

## Exit codes

| Code | Meaning                                                                              |
| ---- | ------------------------------------------------------------------------------------ |
| 0    | Done.                                                                                |
| 1    | `--fail-on` matched.                                                                 |
| 2    | A usage, read or write error, also when `clean` can't make a copy of a damaged file. |

A file of a kind tellall can't read is listed and doesn't change the exit code.

## Links

- Web page, same engine in your browser: https://tellall.candygoogy.dev
- Source, limits and the agent skill: https://github.com/candygoogy/tellall
- Issues: https://github.com/candygoogy/tellall/issues

MIT. Copyright (c) 2026 candygoogy.
