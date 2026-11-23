import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectElision, isPlaceholderLine } from '../src/detect.ts'

const opts = { shrinkRatio: 0.5, minLinesForShrink: 40 }

const placeholders = [
  '// ... existing code ...',
  '  // ...existing code...',
  '// ... rest of the code ...',
  '# ... rest of the file unchanged',
  '/* ... */',
  '// [...]',
  '// ...',
  '# ...',
  '<!-- ... -->',
  '{/* ... existing JSX ... */}',
  '// Rest of the implementation remains the same',
  '// rest of file unchanged',
  '# (other methods unchanged)',
  '// ... other imports',
  '// existing code here',
  '-- ... previous queries ...',
  '// ... (handlers) ...',
  '// code omitted for brevity',
  '// keep the existing implementation',
  '    # Same as before',
  '...',
  '…',
  '// …',
]

const realLines = [
  'const xs = [...a, ...b]',
  'function f(...args) {}',
  '// TODO: handle errors',
  '// Loading...',
  '// This function keeps existing users logged in',
  'console.log("...")',
  'return { ...state, ok: true }',
  '# Wait for the job...',
  '// unchanged values are skipped by the diff algorithm below, which compares each field',
  '* @param rest - the rest of the arguments',
  'print("rest of the code")',
  '',
  '}',
]

for (const line of placeholders) {
  test(`placeholder: ${line}`, () => assert.equal(isPlaceholderLine(line, 'src/app.ts'), true))
}
for (const line of realLines) {
  test(`real code: ${JSON.stringify(line)}`, () => assert.equal(isPlaceholderLine(line, 'src/app.ts'), false))
}

test('bare ... is legal in Python and Markdown', () => {
  assert.equal(isPlaceholderLine('...', 'stubs/api.pyi'), false)
  assert.equal(isPlaceholderLine('...', 'README.md'), false)
  assert.equal(isPlaceholderLine('# ... rest unchanged', 'app.py'), true)
})

test('edit introducing a placeholder is flagged with its line number', () => {
  const finding = detectElision('function a() {\n  // ... existing code ...\n  return 2\n}', 'function a() {\n  setup()\n  return 1\n}', false, opts)
  assert.deepEqual(finding, { kind: 'placeholder', hits: [{ line: 2, text: '// ... existing code ...' }] })
})

test('placeholders already present in the original are not flagged', () => {
  const old = 'a\n// ...\nb'
  assert.equal(detectElision('a\n// ...\nc', old, false, opts), undefined)
  assert.equal(detectElision('a\n// ...\n// ...\nc', old, false, opts)?.kind, 'placeholder')
})

test('whole-file shrink below the ratio is flagged; new files are not', () => {
  const big = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
  assert.deepEqual(detectElision('line 0\nline 1', big, true, opts), { kind: 'shrink', oldLines: 100, newLines: 2 })
  assert.equal(detectElision(big.slice(0, big.length / 2 + 200), big, true, opts), undefined)
  assert.equal(detectElision('tiny', undefined, true, opts), undefined)
  assert.equal(detectElision('tiny', big, false, opts), undefined)
  assert.equal(detectElision('tiny', big, true, { ...opts, shrinkRatio: 0 }), undefined)
})

test('extra patterns extend detection', () => {
  assert.equal(detectElision('x\nSNIP\ny', '', false, { ...opts, extraPatterns: ['^SNIP$'] })?.kind, 'placeholder')
})

test('ordinary comments that mention "unchanged", "the rest", or "existing code" are not placeholders', () => {
  for (const line of [
    '// unchanged since v1 for compatibility',
    '// Keep the rest of the list sorted',
    '  // ...and then we retry',
    '// The rest of the request is validated by zod',
    '// Matches the existing code in the parser',
    '// Compatible with existing implementation',
    '// Unlike the original logic, this handles nulls',
    '// The existing code remains fast',
    '// Uses the remaining functions from utils.ts',
    '// Insert existing record into the cache table',
    '// This value is unchanged when retries are disabled',
    '// Cached value stays the same',
    '// Cached value stays the same until invalidated',
    '// cache stays unchanged until the next refresh',
    '// Cached value remains the same until invalidated',
    '// payload is intact',
    '// Original input is left untouched',
    '// Keep existing code style consistent with the repo',
    '// Leave existing code untouched when flag is false',
  ]) {
    assert.equal(isPlaceholderLine(line, 'a.ts'), false, line)
  }
  assert.equal(isPlaceholderLine('    """..."""', 'a.py'), false)
  for (const line of [
    '-- rest of the query unchanged',
    '/* rest of styles unchanged */',
    '// keep the rest as is',
    '// ... (unchanged)',
    '// existing code',
    '// (existing implementation)',
    '// your existing code goes here',
    '// insert existing code here',
    '// remaining functions go here',
    '// existing code (no changes)',
    '// insert the rest here',
    '// other handlers go here',
    '// existing code - no changes',
    '// previous methods stay the same',
    '// code elided',
    '// keep existing code intact',
    '// existing code (keep as-is)',
    '// keep existing code as-is',
    '// leave existing code intact',
    '// existing code (keep intact)',
    '// leave the rest as-is',
    '// keep all existing code',
    '// keep all the existing code',
    '// leave all existing code intact',
    '// existing code (unchanged from above)',
    '// existing code - unchanged from before',
  ]) {
    assert.equal(isPlaceholderLine(line, 'a.ts'), true, line)
  }
})

test('targeted edits with no-ellipsis placeholder comments are detected by detectElision', () => {
  for (const comment of [
    '// insert existing code here',
    '// remaining functions go here',
    '// existing code (no changes)',
    '// keep existing code intact',
    '// existing code (keep as-is)',
    '// keep existing code as-is',
    '// leave existing code intact',
    '// keep all existing code',
    '// existing code (unchanged from above)',
  ]) {
    assert.deepEqual(
      detectElision(comment, 'doRealWork()', false, { ...opts, extraPatterns: [], path: 'a.ts' }),
      { kind: 'placeholder', hits: [{ line: 1, text: comment }] },
      comment,
    )
  }
})

test('targeted edits with harmless cache-retention comments alongside real code are allowed', () => {
  for (const comment of [
    '// Cached value stays the same',
    '// Cached value stays the same until invalidated',
    '// cache stays unchanged until the next refresh',
  ]) {
    assert.equal(
      detectElision(`${comment}\nreturn cache.get(key)`, 'return cache.get(key)', false, { ...opts, extraPatterns: [], path: 'a.ts' }),
      undefined,
      comment,
    )
  }
})

test('targeted edits with harmless non-deleting comments before an unchanged return payload are allowed', () => {
  for (const [comment, stmt] of [
    ['// payload is intact', 'return payload'],
    ['// Original input is left untouched', 'return input'],
  ]) {
    assert.equal(
      detectElision(`${comment}\n${stmt}`, stmt, false, { ...opts, extraPatterns: [], path: 'a.ts' }),
      undefined,
      comment,
    )
  }
})
