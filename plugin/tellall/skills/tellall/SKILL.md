---
name: tellall
description: Use when the user asks what an image or a piece of copied text gives away about them (location, camera, dates, tracking IDs, hidden characters, the page address in a copy), whether an image says it was made by AI or carries a C2PA or Content Credentials label, or asks to clean, strip or scrub metadata from JPEG, PNG, WebP or HEIC files, or hidden characters from a text, before publishing or sharing them.
---

# tellall

tellall reads a file's metadata and AI labels and says in plain sentences what the file gives away. It runs on the user's machine and sends nothing anywhere. It needs Node 20.19 or later.

## Quote every path

Put each path in single quotes, write a quote inside one as `'\''`, and put `--` before the paths so none can read as an option:

```
npx -y tellall --json -- 'Holiday photos/beach 1.jpg' 'ann'\''s.png'
```

## See what files give away

```
npx -y tellall --json -- <paths>
```

Folders are read all the way down, except links, `node_modules` and folders whose names start with a dot; tellall says on stderr how many it skipped. The output is a JSON array of reports: `name`, `format` (`unknown` means tellall can't read that kind of file), `headline`, and `findings`, each with a `kind` (`label`, `private`, `info`, `harmless`), a `sentence` and the raw `fields`. Exit codes: 0 done; 1 `--fail-on` matched; 2 usage, read or write error, also when `clean` can't make a copy of a damaged file. A file of a kind tellall can't read is listed and doesn't change the exit code. The reports for the files it could read are still printed.

For text the user pasted, save it to a `.txt` file and pass that, or pass it on stdin: `npx -y tellall --json -- 'pasted.txt'` or `npx -y tellall --json - < 'pasted.txt'`. `.txt` and `.md` files are read as text, also inside folders, unless their bytes show an image.

## Explain the result

- Start with the headline, then the sentences. Quote tellall's sentences instead of paraphrasing them.
- Say what the file says, not what it is: "This image says it was made by AI", never "this image is AI" or "this is not AI".
- Never call a file real, fake, verified, trusted or authentic. "The signature matches this file" means the file hasn't changed since it was signed. tellall doesn't check who stands behind the certificate.
- An empty result means no marks were found. It says nothing about who or what made the file: many apps and sites strip marks.
- Pixel watermarks (SynthID and others): report only what the label states. tellall names the watermark only when the label does; don't add a name it didn't say. tellall can't see them or remove them, and a clean copy keeps them. To check for one, the user can upload the file to the maker's own checker: Google's SynthID Detector at https://synthid.com/ (needs sign-in) or OpenAI's at https://openai.com/verify. Suggest it only when asked; that upload leaves the device.
- `harmless` findings (emoji joiners and keycaps, flags, variation selectors, the joiners Persian or Hindi need) aren't a problem; don't present them as one.
- Mention C2PA, XMP, IPTC or the raw `fields` only when the user asks for detail.

## Make clean copies

```
npx -y tellall clean -- <paths>
```

This writes `name.clean.ext` next to each file and never changes the original. `-o <dir>` writes the copies elsewhere. A `name.clean.ext` is skipped only when `name.ext` sits beside it. A file with nothing to remove gets no copy (`--always` writes one anyway). A second run leaves existing `.clean` files as they are and says so; add `--force` only when the user agrees to replace them.

A clean copy removes location, camera, dates, software, IDs, text and any other metadata tellall can't name, and keeps the AI label (with any data inside it). A HEIC whose XMP holds the AI-source tag keeps that whole XMP item; tellall names what else is in it. If a labelled image also had private data, tell the user what tellall prints: the label was kept but no longer matches the file.

For text, `clean` removes the hidden characters and keeps the harmless ones and unusual spaces. A `.txt` or `.md` file gets a `name.clean.txt` copy by the same rules. `npx -y tellall clean - < 'pasted.txt'` writes the clean text to stdout and what was removed to stderr.

## Removing AI labels

Add `--remove-labels` to `clean` only when both are true:

1. The user asked for the AI labels (C2PA, Content Credentials, the AI-source tag) to be removed. "Remove the metadata" or "strip everything" isn't that request: a plain `clean` already removes the private data.
2. The files are the user's own. If you can't tell, ask before running it.

Then pass on the notice tellall prints: the invisible watermark in the pixels, if any, stays.
