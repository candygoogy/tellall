# tellall

See in plain sentences what an image or a text tells about you: AI labels, location, camera, dates, hidden characters. Make clean copies that keep AI labels unless you ask. Everything runs on your machine; nothing is sent anywhere.

```
npx tellall <file|dir|-> ...            plain-sentence report; "-" reads text from stdin
        --json                          machine-readable reports
        --all                           also print raw fields
        --fail-on private|label|any     exit 1 if any input has that kind of finding (CI use)
npx tellall clean <file|dir> ...        write clean copies, never touching originals
        -o, --out <dir>                 where to write (default: next to each file, name.clean.ext)
        --remove-labels                 also remove AI labels (C2PA, AI-source tags); files you own
        --force                         overwrite existing .clean files
```

Exit codes: 0 done, 1 `--fail-on` matched, 2 usage or read error. Needs Node 20 or later.

```
$ npx tellall chatgpt-image.png
chatgpt-image.png
  This image says it was made by AI.
  · Signed with a certificate issued to OpenAI OpCo, LLC. The signature matches this file.
  · Made with ChatGPT (gpt-image) on 25 Oct 2026 at 14:46:19 UTC.
  · The label says OpenAI also put an invisible watermark in the pixels. A clean copy can't remove it.
  · No location, camera or other personal data.
```

`--remove-labels` removes the AI label, not the invisible watermark some generators put in the pixels; no tool here can remove that.

Web page: https://tellall.candygoogy.dev · Source: https://github.com/candygoogy/tellall · MIT
