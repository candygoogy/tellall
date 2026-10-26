# tellall plugin

A Claude Code plugin with one skill, `tellall`. Ask Claude what an image or a copied text gives away, whether an image says it was made by AI, or to clean files before you publish them. The skill runs the [tellall](https://github.com/candygoogy/tellall) command-line tool with `npx -y tellall`, on your machine, and explains the result in plain words. It needs Node 20.19 or later.

It makes clean copies next to your files and never changes the originals. It removes AI labels only when you ask for that and the files are yours.

## Install

```
/plugin install tellall --marketplace candygoogy/tellall
```

For Codex and Cursor, copy [`skills/tellall`](skills/tellall) into `~/.agents/skills/`, or into a project's `.agents/skills/`.

MIT. Copyright (c) 2026 candygoogy.
