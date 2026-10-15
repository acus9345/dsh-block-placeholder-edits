/**
 * Detection of lazy elisions in file edits.
 *
 * Models sometimes "rewrite" a file by emitting only the changed part and a
 * placeholder comment such as `// ... existing code ...`. Written to disk,
 * that placeholder silently deletes the code it stands for. This module
 * finds such placeholders in new text that were not already present in the
 * text being replaced, and flags whole-file rewrites that drop most of a
 * file.
 */

/** One placeholder line found in the new text. */
export interface ElisionHit {
  /** 1-based line number inside the new text. */
  line: number
  /** The placeholder line, trimmed. */
  text: string
}

/** Result of analysing one mutation. */
export type ElisionFinding =
  | { kind: 'placeholder'; hits: ElisionHit[] }
  | { kind: 'shrink'; oldLines: number; newLines: number }

/** Analysis options. */
export interface DetectOptions {
  /** Flag a whole-file rewrite whose line count falls below this fraction of the original. 0 disables. */
  shrinkRatio: number
  /** Only apply the shrink rule to originals with at least this many lines. */
  minLinesForShrink: number
  /** Extra regular expressions (source strings) that mark a placeholder line. */
  extraPatterns?: readonly string[]
  /** File path, used to relax rules for languages where `...` is valid code. */
  path?: string
}

const COMMENT_START = /^(?:\/\/+|#+|\/\*+|\*|<!--|--|;+|%+|\{\s*\/\*|REM\b|"""|''')\s*/i
const COMMENT_END = /\s*(?:\*+\/\s*\}?|-->|"""|''')\s*$/

const DOTS = /(?:\.\s*){3,}|…/
const ELISION_WORDS = new RegExp([
  String.raw`\brest of (?:the )?(?:code|file|implementation|function|class|component|module|methods?|logic|content|body|tests?|file contents?|query|styles?|template|markup|config(?:uration)?)\b`,
  String.raw`\b(?:remains?|stays?|is|are|kept|left) (?:the same|unchanged|as[- ]is|as before)\b`,
  String.raw`\bunchanged\b`,
  String.raw`\b(?:existing|previous|original|prior|other|remaining|same) (?:code|implementation|logic|methods?|functions?|imports?|content|lines|props|properties|fields|routes|handlers|tests?|cases|styles|config(?:uration)?|exports|definitions?)\b`,
  String.raw`\b(?:code|content|implementation|details?|lines?) (?:omitted|elided|truncated|skipped|removed for brevity)\b`,
  String.raw`\b(?:omitted|elided|truncated) for brevity\b`,
  String.raw`\bfor brevity\b`,
  String.raw`\bsame as (?:before|above|original|existing)\b`,
  String.raw`\bkeep (?:the )?(?:existing|original|rest)\b`,
  String.raw`\b(?:your|the) (?:existing|original) (?:code|implementation)\b`,
  String.raw`\b(?:insert|add|put) (?:the )?(?:rest|remaining|existing)\b`,
  String.raw`\betc\.?$`,
].join('|'), 'i')

/** Languages where a bare `...` line is legal code (Python Ellipsis, Go variadics are inline). */
const BARE_DOTS_OK = /\.(?:py|pyi|pyx|md|mdx|markdown|txt|rst|adoc|org|tex|csv|json|ya?ml|toml|ini|log|svg|html?)$/i

/**
 * Test whether one line is an elision placeholder.
 * @param raw - the line.
 * @param path - optional path for language rules.
 * @param extra - compiled extra patterns.
 * @returns true when the line stands in for omitted code.
 */
export function isPlaceholderLine(raw: string, path: string | undefined, extra: readonly RegExp[] = []): boolean {
  const line = raw.trim()
  if (line.length === 0 || line.length > 160) return false
  if (extra.some(re => re.test(line))) return true
  const bare = line.replace(/[,;]$/, '')
  if (/^(?:\.\.\.|…)$/.test(bare) || /^\[?(?:\.\.\.|…)\]?$/.test(bare) || /^\{\s*(?:\.\.\.|…)\s*\}$/.test(bare) || /^\((?:\.\.\.|…)\)$/.test(bare)) {
    return path === undefined || !BARE_DOTS_OK.test(path)
  }
  const comment = COMMENT_START.exec(line)
  if (comment === null) return false
  const body = line.slice(comment[0].length).replace(COMMENT_END, '').trim()
  if (body.length === 0) return false
  // A `"""..."""` docstring is a stub, not elided code.
  if (/^\[?(?:\.\s*){3,}\]?$|^…$/.test(body)) return !/^(?:"""|''')/.test(comment[0])
  if (/^(?:TODO|FIXME|XXX|NOTE)\b/i.test(body) && !ELISION_WORDS.test(body)) return false
  const hasDots = DOTS.test(body)
  const hasWords = ELISION_WORDS.test(body)
  if (hasDots && hasWords) return true
  // Without an ellipsis, require the strong phrasings that only appear in placeholders.
  // `unchanged` and `keep the rest` also show up in real comments ("unchanged since v1", "keep the rest sorted"),
  // so they only count at the end of the comment.
  if (hasWords && /\b(?:rest of (?:the )?(?:code|file|implementation|function|class|component|module|methods?|logic|content|body|tests?|query|styles?|template|markup|config)|remains?|omitted|for brevity|same as|(?:existing|previous|original|remaining) (?:code|implementation|logic|methods|functions|content))\b|\bunchanged\W*$|\bkeep (?:the )?(?:existing|original|rest)(?: (?:code|implementation|as[- ]is|unchanged|the same))?\W*$/i.test(body)) {
    return body.split(/\s+/).length <= 12
  }
  // `// ... handlers ...` style: dots wrapping a short noun phrase.
  if (/^(?:\.\s*){3,}[\w\s/()-]{1,40}(?:\.\s*){3,}$|^(?:\.\s*){2,}\.\s+\(?[\w\s-]{1,30}\)?$/.test(body)) return true
  return false
}

/**
 * Collect placeholder lines in `text`.
 * @param text - new text.
 * @param path - optional path for language rules.
 * @param extra - compiled extra patterns.
 * @returns hits in line order.
 */
export function findPlaceholders(text: string, path?: string, extra: readonly RegExp[] = []): ElisionHit[] {
  const hits: ElisionHit[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    if (isPlaceholderLine(lines[i]!, path, extra)) hits.push({ line: i + 1, text: lines[i]!.trim() })
  }
  return hits
}

const countLines = (text: string): number => (text.length === 0 ? 0 : text.replace(/\r?\n$/, '').split(/\r?\n/).length)

/**
 * Analyse one mutation.
 * @param newText - text being written (whole file or replacement span).
 * @param previous - text being replaced: the file for writes, `old_string` for edits; undefined for a new file.
 * @param wholeFile - the mutation replaces the entire file.
 * @param options - thresholds and extra patterns.
 * @returns the finding, or undefined when the edit looks complete.
 */
export function detectElision(
  newText: string,
  previous: string | undefined,
  wholeFile: boolean,
  options: DetectOptions,
): ElisionFinding | undefined {
  const extra = (options.extraPatterns ?? []).map(p => new RegExp(p, 'i'))
  const hits = findPlaceholders(newText, options.path, extra)
  if (hits.length > 0) {
    // A placeholder that already existed the same number of times is not new.
    const before = new Map<string, number>()
    for (const hit of findPlaceholders(previous ?? '', options.path, extra)) before.set(hit.text, (before.get(hit.text) ?? 0) + 1)
    const fresh = hits.filter((hit) => {
      const n = before.get(hit.text) ?? 0
      if (n > 0) {
        before.set(hit.text, n - 1)
        return false
      }
      return true
    })
    if (fresh.length > 0) return { kind: 'placeholder', hits: fresh }
  }
  if (wholeFile && previous !== undefined && options.shrinkRatio > 0) {
    const oldLines = countLines(previous)
    const newLines = countLines(newText)
    if (oldLines >= options.minLinesForShrink && newLines < oldLines * options.shrinkRatio) {
      return { kind: 'shrink', oldLines, newLines }
    }
  }
  return undefined
}
