# dsh-block-placeholder-edits

English | [中文](README.zh.md)

Models have a habit that quietly wrecks files. They write `// ... existing code ...` in place of code they didn't feel like retyping, and the edit tool takes it literally. The file now holds a comment where forty lines of real code used to be. You only find out when the build breaks, or worse, when it doesn't.

This [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin checks every `write` and `edit` before it lands. If the new text uses a placeholder comment to stand in for code, or a whole-file write throws away most of a large file, the call is refused and the file is left alone. The model is told exactly which line was the problem:

```
dsh-block-placeholder-edits blocked this edit to src/app.ts: the new text contains
placeholder comments that stand in for code instead of the code itself. Writing them
would delete whatever they replace.
  line 2: // ... rest of the function unchanged
Fix: write out the full code in place of each placeholder, or use a smaller `edit`
that replaces only the lines you are changing (old_string/new_string) so untouched
code stays as it is.
```

In practice the model reacts well to this. It switches to a narrower `edit`, or it writes the code out properly.

## Install

```sh
dsh plugin --profile web add dsh-block-placeholder-edits
```

That's the `web` profile, the browser UI you start with `dsh web`. If you run DSH another way, use `headless` (scripts and CI) or `acp` (editor integrations) instead. Each profile keeps its own plugin list, so add it to every profile you use. It turns on as soon as it's installed. Remove it with `dsh plugin --profile web remove dsh-block-placeholder-edits`.

### From a clone

To try local changes, build a tarball and install that:

```sh
git clone https://github.com/acus9345/dsh-block-placeholder-edits
cd dsh-block-placeholder-edits
npm install
npm pack
dsh plugin --profile web add ./dsh-block-placeholder-edits-0.2.0.tgz
```

## What counts as a placeholder

These are comments, in any common comment style (`//`, `#`, `/* */`, `<!-- -->`, `--`, `;`, JSX `{/* */}`), that talk about code instead of being code:

```
// ... existing code ...
# rest of the file unchanged
/* ... */
// keep the rest as is
// ... other methods
{/* ... */}
```

A bare `...` line counts too, except in Python, Markdown and other files where `...` means something.

Ordinary comments pass, including ones that mention existing code. A placeholder that was already in the old text also doesn't count, so the plugin won't nag the model about a file that already had one.

The second check is for whole-file `write` calls. If a file of 40 lines or more is replaced with less than half as many lines, the write is refused. That pattern almost always means the model rewrote the file from memory and dropped a chunk. Targeted edits aren't affected by this check, and neither are new files.

## When the model means it

Sometimes deleting most of a file is the point. The model is told it can repeat the identical call once to confirm, and the second try goes through. That keeps a real refactor from getting stuck, but the model has to choose it on purpose. If you'd rather have a person decide, set `mode: ask`.

## Settings

The easy way: open **Plugins** in DSH's sidebar, click **dsh-block-placeholder-edits**, change what you want and press **Save**. It applies to the next tool call, no restart needed.

Or add a row like this to `~/.dsh/profiles/<profile>/cordis.patch.yml`, or to `~/.dsh/cordis.patch.yml` for all profiles. Keys you leave out keep their defaults.

```yaml
- id: block-placeholder-edits
  config:
    mode: deny                 # or `ask` for an approval prompt
    shrinkRatio: 0.5           # 0 turns the large-deletion check off
    minLinesForShrink: 40      # files shorter than this are never shrink-checked
    allowIdenticalRetry: true  # false: a refusal is final
    extraPatterns: []          # extra regexes for your own placeholder phrasing
    ignore: ['docs/**']        # globs to skip entirely
```

## Development

```sh
npm install
npm test           # detector unit tests
npm run test:e2e   # real dsh runs against a scripted local model, no API key needed
```

The install test runs `dsh plugin add`, which needs `pnpm` on your PATH.

MIT licensed. Written by [acus9345](https://github.com/acus9345). Bug reports and ideas are welcome in the issues.
