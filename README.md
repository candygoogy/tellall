# tellall

Your ChatGPT image is a tell-all: who made it, the exact time, and an admission that it's watermarked. tellall shows in plain sentences what an image or a copied text tells about you besides its content, and gives you a clean copy. It runs on your own device, as a web page, a command-line tool and an agent skill.

Not released yet: the npm package and the web page go live with version 0.1.0.

![Dropping a ChatGPT image on the tellall page: the sentences appear, then a map of the file's parts](docs/media/tellall-demo.gif)

```
$ npx tellall chatgpt-image.png
chatgpt-image.png
  This image says it was made by AI.
  · Signed with a certificate issued to OpenAI OpCo, LLC. The signature matches this file.
  · Made with ChatGPT (gpt-image) on 25 Oct 2026 at 14:46:19 UTC.
  · The label says OpenAI also put an invisible watermark in the pixels. A clean copy can't remove it.
  · No location, camera or other personal data.
```

That is an image downloaded from ChatGPT on 25 October 2026, as it came. An image from Gemini gets the same headline, with a label signed by Google LLC that also states a watermark.

## What it reads

Images: JPEG, PNG, WebP and HEIC.

- AI labels (C2PA, also called Content Credentials): who signed the label, which tool made the image and when, whether the label says the maker added an invisible watermark, and whether the signature still matches the file. For WebP, tellall can only tell that a label is there.
- An AI-source tag outside a label (the IPTC DigitalSourceType field).
- Location (GPS and place names), camera and lens, serial numbers, when the picture was taken and last saved, the software that saved it, IDs that link copies of the same file, and names, captions and comments. Data inside an AI label (GPS or camera details in its assertions) is reported too, as held by the label.
- Metadata it can't name. tellall says "This file holds details tellall doesn't name." and a clean copy removes them. Technical Exif such as resolution isn't reported, and a file that holds only that is left as it is.

Text, pasted into the page or piped to the command line:

- Hidden characters: zero-width characters, Unicode tag characters and variation-selector runs (decoded when they spell something out), direction controls and other invisible formatting characters. Emoji joiners, emoji keycaps, variation selectors after symbols such as ©️, ®️ and ™️, the England, Scotland and Wales flags, variation selectors after CJK characters, and the joiners that scripts such as Persian need, are listed as usually harmless and don't count.
- What a formatted copy carries besides the words (on the page, which reads the copy as HTML): element IDs that look like response IDs, the site's class names and inline styles, and parts styled to be invisible. A formatted copy can also carry the page's address. Your browser adds it, not the chat app, and a web page can't see it, so the page shows a general note about it.

A test photo from this repo's fixtures, with made-up camera data planted in it:

```
$ npx tellall gps.jpg
gps.jpg
  This file gives away 5 kinds of personal data.
  · It records the exact place it was taken: 51.4769° N, 0.0005° W.
  · It names the camera: Example Cam 1. It names the lens: Example 35mm.
  · It records when it was taken: 1 Oct 2026 at 12:00:00.
  · It names the software that saved it: Example Editor 2.
  · It names a person: Test Person. It carries a comment: Made for a test.
```

## Use it

### Web page

The page will be at https://tellall.candygoogy.dev. Drop images on it or paste text. Each image gets its sentences and a map of the file's parts drawn to scale, and a _Download clean copy_ button; several files can be saved at once with _Download all clean_, as a zip. For text, _Copy clean text_ copies the plain text without the hidden characters. The page never removes AI labels; under a label it shows the command that does.

### Command line

Needs Node 20.19 or later.

```
npx tellall [options] [--] <file|dir|-> ...
    Plain-sentence report; "-" reads text from stdin.
    --json                       machine-readable reports
    --all                        also print raw fields
    --fail-on private|label|any  exit 1 if any input has that kind of finding (CI use)
npx tellall clean [options] [--] <file|dir> ...
    Write clean copies, never touching originals.
    -o, --out <dir>              where to write (default: next to each file, name.clean.ext)
    --remove-labels              also remove AI labels (C2PA, AI-source tags); files you own
    --force                      replace .clean copies already there
```

Put `--` before the paths so a name starting with `-` isn't read as an option. Folders are read all the way down, except links, `node_modules` and folders whose names start with a dot; tellall says on stderr how many it skipped. Text on stdin can be UTF-8 or UTF-16 (by its byte order mark); tellall says so if it isn't valid UTF-8. Errors and skip notes go to stderr, reports to stdout.

Exit codes: 0 done; 1 `--fail-on` matched; 2 usage, read or write error, also when `clean` can't make a copy (a damaged file, or a copy already there without `--force`). A file of a kind tellall can't read is listed and doesn't change the exit code. To stop a build that would publish photos with personal data in them: `npx tellall --fail-on private -- public/images`.

`clean` writes a copy next to each file and leaves the original alone. It doesn't clean its own earlier copies again: a `photo.clean.jpg` is skipped only when `photo.jpg` sits beside it. With `-o` and several input folders, each copy goes in a folder named after its input folder. An AI image with nothing private in it comes back unchanged, byte for byte:

```
$ npx tellall clean chatgpt-image.png gps.jpg
chatgpt-image.png
  Wrote chatgpt-image.clean.png
  · Nothing private to remove.

gps.jpg
  Wrote gps.clean.jpg
```

On files you own, `--remove-labels` also takes the AI label out:

```
$ npx tellall clean --remove-labels chatgpt-image.png
chatgpt-image.png
  Wrote chatgpt-image.clean.png

AI labels removed. The invisible watermark in the pixels (if any) stays; this tool can't remove it.
```

### Agent skill

In Claude Code:

```
/plugin install tellall --marketplace candygoogy/tellall
```

Then ask things like "what does this image give away?" or "clean these photos before I publish them". The skill runs `npx -y tellall` and explains the result in the same plain words. It removes AI labels only when you ask for that and the files are yours.

For Codex and Cursor, copy the folder [`plugin/tellall/skills/tellall`](plugin/tellall/skills/tellall) into `~/.agents/skills/`, or into a project's `.agents/skills/`. Both read skills from there.

## What a clean copy removes

|                                                                     | `clean` and the web page     | `clean --remove-labels` |
| ------------------------------------------------------------------- | ---------------------------- | ----------------------- |
| GPS, camera, serial numbers, dates, software, comments, text chunks | removed                      | removed                 |
| XMP and Exif, except the orientation                                | removed                      | removed                 |
| Any other metadata tellall can't name                               | removed                      | removed                 |
| Tracking IDs (DocumentID, InstanceID, GUIDs)                        | removed                      | removed                 |
| Colour profile, HDR gain map (Ultra HDR)                            | kept, the picture needs them | kept                    |
| AI label (C2PA), with any GPS or camera data inside it              | kept, data included          | removed                 |
| AI-source tag (DigitalSourceType)                                   | kept (see below for HEIC)    | removed                 |
| Pixels                                                              | untouched, byte for byte     | untouched               |

A HEIC whose XMP holds the AI-source tag keeps that whole XMP item, and any creator, software or GPS fields inside it stay too; the result names them. The Ultra HDR gain map is cleaned along with the main picture. A file with no private data and nothing else to remove comes back unchanged, byte for byte.

A C2PA label signs a hash of the rest of the file. When a labelled image also has private data, the clean copy drops that data and keeps the label, and tellall tells you the label no longer matches the file. For text, _Copy clean text_ on the page drops the hidden characters and the formatted-copy extras; the usually harmless characters stay.

## Privacy

Files never leave your device. The page reads them in a Web Worker in your browser. Its Content Security Policy sets `connect-src 'none'`, so the browser blocks any upload or connection the page's code tries. The page loads only from its own address, with no third-party scripts, fonts or images. Load it once, turn Wi-Fi off, and it still reads your files. The command-line tool reads and writes files on your machine and makes no network requests; only `npx` itself downloads the package.

## Limits

- tellall can't see or remove watermarks hidden in the pixels, such as Google's SynthID, or statistical watermarks in text. It reports what an AI label says about a watermark, and a clean copy keeps the watermark.
- No marks found doesn't mean a person made the file. Many apps and sites strip labels and metadata when you upload.
- It checks that a label's signature matches the file. It doesn't check who stands behind the certificate.
- WebP labels can be found but not read yet.
- No GIF, AVIF, TIFF, SVG, PDF, Office files, audio or video yet.
- English only.

## Development

npm workspaces: `packages/engine` (reading, cleaning and sentences), `packages/cli` and `web`. Development needs Node 22.12 or later (the command-line tool itself needs 20.19).

```
npm install
npx vitest run
```

Every example above is checked against the fixtures in `fixtures/` by `packages/engine/test/readme-claims.test.ts`.

## License

MIT. Copyright (c) 2026 candygoogy. Image reading and cleaning come from [Photo check](https://photo.candygoogy.dev), by the same author.
