/**
 * dsh-block-placeholder-edits: blocks file edits that would replace real code with
 * placeholder comments such as `// ... existing code ...`, and whole-file
 * rewrites that silently drop most of a file.
 *
 * Runs on `tools/pre-execute` for `write`, `edit`, and `str_replace_editor`.
 * A blocked call returns a reason telling the model which lines are
 * placeholders and how to fix the edit. When `allowIdenticalRetry` is on,
 * repeating the exact same call confirms it was intentional and lets it run.
 *
 * @module dsh-block-placeholder-edits
 */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { detectElision, type ElisionFinding } from './detect.ts'
import { fileMutation, readExisting, resolvePath, workspaceOf } from './shared/files.ts'
import { matchesAny } from './shared/glob.ts'

export { detectElision, findPlaceholders, isPlaceholderLine } from './detect.ts'
export type { ElisionFinding, ElisionHit, DetectOptions } from './detect.ts'

export const name = 'block-placeholder-edits'

/** Plugin configuration. */
export interface Config {
  /** `deny` tells the model; `ask` shows an approval prompt. */
  mode: 'deny' | 'ask'
  /** Block a whole-file rewrite that keeps fewer than this fraction of the original lines. 0 disables. */
  shrinkRatio: number
  /** Apply the shrink rule only to files with at least this many lines. */
  minLinesForShrink: number
  /** Let an identical retry of a blocked call through (the model confirming it is intentional). */
  allowIdenticalRetry: boolean
  /** Extra regexes that mark a placeholder line. */
  extraPatterns: string[]
  /** Workspace-relative globs to skip. */
  ignore: string[]
  /** Largest existing file (bytes) read for comparison. */
  maxFileBytes: number
}

export const Config: Schema<Config> = Schema.object({
  mode: Schema.union(['deny', 'ask']).default('deny'),
  shrinkRatio: Schema.number().min(0).max(1).default(0.5),
  minLinesForShrink: Schema.natural().default(40),
  allowIdenticalRetry: Schema.boolean().default(true),
  extraPatterns: Schema.array(Schema.string()).default([]),
  ignore: Schema.array(Schema.string()).default([]),
  maxFileBytes: Schema.natural().default(2_000_000),
}) as Schema<Config>

/**
 * Render the model-facing reason for a blocked mutation.
 * @param path - workspace-relative path.
 * @param finding - what was detected.
 * @param retryAllowed - whether an identical retry will be accepted.
 * @returns the denial text.
 */
export function denialText(path: string, finding: ElisionFinding, retryAllowed: boolean): string {
  const retry = retryAllowed ? ' If the change really is intended exactly as written, repeat the identical call once to confirm.' : ''
  if (finding.kind === 'placeholder') {
    const lines = finding.hits.slice(0, 5).map(h => `  line ${h.line}: ${h.text}`).join('\n')
    const more = finding.hits.length > 5 ? `\n  (+${finding.hits.length - 5} more)` : ''
    return `dsh-block-placeholder-edits blocked this edit to ${path}: the new text contains placeholder comments that stand in for code instead of the code itself. Writing them would delete whatever they replace.\n${lines}${more}\n`
      + `Fix: write out the full code in place of each placeholder, or use a smaller \`edit\` that replaces only the lines you are changing (old_string/new_string) so untouched code stays as it is.${retry}`
  }
  return `dsh-block-placeholder-edits blocked this write to ${path}: it replaces a ${finding.oldLines}-line file with ${finding.newLines} line${finding.newLines === 1 ? "" : "s"}, which usually means part of the file was left out. `
    + `Fix: read the file and use \`edit\` for targeted changes, or write the complete file content.${retry}`
}

export function apply(ctx: Context, config: Config): void {
  const extra = config.extraPatterns.map((p) => {
    try {
      new RegExp(p, 'i')
      return p
    } catch (error) {
      throw new Error(`block-placeholder-edits: invalid extraPatterns entry ${JSON.stringify(p)}`, { cause: error })
    }
  })
  /** Fingerprints of blocked calls awaiting an identical retry. Bounded FIFO. */
  const pending = new Set<string>()
  const remember = (key: string): void => {
    pending.add(key)
    if (pending.size > 200) pending.delete(pending.values().next().value!)
  }

  ctx.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>) => {
    const mutation = fileMutation(exec)
    if (mutation === undefined) return next()
    const { absolute, relative } = resolvePath(mutation.path, workspaceOf(exec))
    if (config.ignore.length > 0 && matchesAny(relative, config.ignore)) return next()
    const key = createHash('sha256').update(`${exec.name}\0${absolute}\0${JSON.stringify(exec.arguments)}`).digest('hex')
    if (config.allowIdenticalRetry && pending.delete(key)) return next()
    const wholeFile = mutation.kind === 'write'
    const previous = wholeFile ? await readExisting(absolute, config.maxFileBytes) : mutation.oldText
    const finding = detectElision(mutation.newText, previous, wholeFile, {
      shrinkRatio: config.shrinkRatio,
      minLinesForShrink: config.minLinesForShrink,
      extraPatterns: extra,
      path: relative,
    })
    if (finding === undefined) return next()
    const text = denialText(relative, finding, config.allowIdenticalRetry)
    if (config.mode === 'ask') {
      return { kind: 'ask', reason: text, displayReason: { en: `Edit to ${relative} looks incomplete (${finding.kind === 'placeholder' ? 'placeholder comments' : 'large deletion'}).` } }
    }
    if (config.allowIdenticalRetry) remember(key)
    return { kind: 'deny', reason: text }
  })
}
