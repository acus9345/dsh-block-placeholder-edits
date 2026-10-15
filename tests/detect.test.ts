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
