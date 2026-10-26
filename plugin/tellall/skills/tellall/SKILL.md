---
name: tellall
description: Use when the user asks what an image or a piece of copied text gives away about them (location, camera, dates, tracking IDs, hidden characters, the page address in a copy), whether an image says it was made by AI or carries a C2PA or Content Credentials label, or asks to clean, strip or scrub metadata from JPEG, PNG, WebP or HEIC files before publishing or sharing them.
---

# tellall

tellall reads a file's metadata and AI labels and says in plain sentences what the file gives away. It runs on the user's machine and sends nothing anywhere. It needs Node 20 or later.

## Quote every path

Put each path in single quotes, write a quote inside one as `'\''`, and put `--` before the paths so none can read as an option:

```
npx -y tellall --json -- 'Holiday photos/beach 1.jpg' 'ann'\''s.png'
```

## See what files give away

```
npx -y tellall --json -- <paths>
```

Folders are read all the way down. The output is a JSON array of reports: `name`, `format` (`unknown` means tellall can't read that kind of file), `headline`, and `findings`, each with a `kind` (`label`, `private`, `info`, `harmless`), a `sentence` and the raw `fields`. Exit code 2 means a usage or read error; the reports for the files it could read are still printed.

For text the user pasted, save it to a file and pass it on stdin: `npx -y tellall --json - < 'pasted.txt'`.

## Explain the result

- Start with the headline, then the sentences. Quote tellall's sentences instead of paraphrasing them.
- Say what the file says, not what it is: "This image says it was made by AI", never "this image is AI" or "this is not AI".
- Never call a file real, fake, verified, trusted or authentic. "The signature matches this file" means the file hasn't changed since it was signed. tellall doesn't check who stands behind the certificate.
- An empty result means no marks were found. It says nothing about who or what made the file: many apps and sites strip marks.
- Pixel watermarks (SynthID and others): report only what the label states. tellall can't see them or remove them, and a clean copy keeps them.
- `harmless` findings (emoji joiners, the joiners Persian or Hindi need) aren't a problem; don't present them as one.
- Mention C2PA, XMP, IPTC or the raw `fields` only when the user asks for detail.

## Make clean copies

```
npx -y tellall clean -- <paths>
```

This writes `name.clean.ext` next to each file and never changes the original. `-o <dir>` writes the copies elsewhere. A second run stops at existing `.clean` files; add `--force` only when the user agrees to replace them.

A clean copy removes location, camera, dates, software, IDs and text, and keeps the AI label. If a labelled image also had private data, tell the user what tellall prints: the label was kept but no longer matches the file.

`clean` takes image files, not text. For text, the report names the hidden characters; if the user wants them gone, remove those characters yourself and keep the harmless ones.

## Removing AI labels

Add `--remove-labels` to `clean` only when both are true:

1. The user asked for the AI labels (C2PA, Content Credentials, the AI-source tag) to be removed. "Remove the metadata" or "strip everything" isn't that request: a plain `clean` already removes the private data.
2. The files are the user's own. If you can't tell, ask before running it.

Then pass on the notice tellall prints: the invisible watermark in the pixels, if any, stays.
