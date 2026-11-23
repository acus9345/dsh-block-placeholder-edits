import { test } from 'node:test'
import assert from 'node:assert/strict'
import { globToRegExp, matchesAny } from '../src/shared/glob.ts'

test('matchesAny supports *, **, ?, character classes, braces, and negation', () => {
  assert.equal(matchesAny('docs/guide.md', ['docs/**']), true)
  assert.equal(matchesAny('src/app.ts', ['docs/**']), false)
  assert.equal(matchesAny('src/nested/README.md', ['*.md']), true)
  assert.equal(matchesAny('src/a.tsx', ['src/*.{ts,tsx}']), true)
  assert.equal(matchesAny('src/a.js', ['src/*.{ts,tsx}']), false)
  assert.equal(matchesAny('src/v1.ts', ['src/v?.ts']), true)
  assert.equal(matchesAny('src/v1.ts', ['src/v[0-9].ts']), true)
  assert.equal(matchesAny('docs/keep.md', ['docs/**', '!docs/keep.md']), false)
  assert.equal(matchesAny('docs/keep.md', ['docs/**', ' !docs/keep.md ']), false)
})

test('empty, whitespace, and malformed globs do not match everything or throw', () => {
  assert.equal(globToRegExp('').test('src/app.ts'), false)
  assert.equal(globToRegExp('   ').test('src/app.ts'), false)
  assert.equal(matchesAny('src/app.ts', ['', '   ']), false)
  assert.equal(matchesAny('docs/a.md', ['docs/**', '!', '!   ']), true)
  assert.equal(matchesAny('src/app.ts', ['src/{unclosed', 'src/[z-a].ts']), false)
  assert.equal(matchesAny('docs/a.md', ['src/{unclosed', 'docs/**']), true)
})
