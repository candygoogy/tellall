# tellall

See in plain sentences what an image or a text tells about you: AI labels, location, camera, dates, hidden characters. Make clean copies that keep AI labels unless you ask. Everything runs on your machine; nothing is sent anywhere.

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
    --always                     also write a copy when nothing is removed
npx tellall -h, --help           this text
npx tellall -v, --version        the version number
```

Put `--` before the paths so a name starting with `-` isn't read as an option. Folders are read all the way down, except links, `node_modules` and folders whose names start with a dot; tellall says on stderr how many it skipped. `clean` doesn't clean its own earlier copies again: a `photo.clean.jpg` next to a `photo.jpg` is skipped. A file with nothing to remove gets no copy unless you add `--always`, and a copy already there is left as it is unless you add `--force`; neither is an error.

Exit codes: 0 done; 1 `--fail-on` matched; 2 usage, read or write error, also when `clean` can't make a copy of a damaged file. A file of a kind tellall can't read is listed and doesn't change the exit code. Needs Node 20.19 or later.

```
$ npx tellall -- chatgpt-image.png
chatgpt-image.png
  This image says it was made by AI.
  · Signed with a certificate issued to OpenAI OpCo, LLC. The signature matches this file.
  · Made with ChatGPT (gpt-image) on 25 Oct 2026 at 14:46:19 UTC.
  · The label says OpenAI also put an invisible watermark in the pixels. A clean copy can't remove it.
  · No location, camera or other personal data.
```

`--remove-labels` removes the AI label, not the invisible watermark some generators put in the pixels; no tool here can remove that.

Web page: https://tellall.candygoogy.dev · Source: https://github.com/candygoogy/tellall · MIT
