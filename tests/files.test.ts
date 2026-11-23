import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { canonicalJson, fileMutation, resolvePath } from '../src/shared/files.ts'

test('canonicalJson ignores key order, so a reordered retry counts as identical', () => {
  // Seen in the desktop app: the retry of a blocked edit came back with its keys in a different order.
  const first = { file_path: 'db/query.sql.go', old_string: 'a', new_string: 'b' }
  const retry = { file_path: 'db/query.sql.go', new_string: 'b', old_string: 'a' }
  assert.equal(canonicalJson(first), canonicalJson(retry))
  assert.equal(canonicalJson({ b: { y: 1, x: [2, { d: 1, c: 2 }] }, a: null }), canonicalJson({ a: null, b: { x: [2, { c: 2, d: 1 }], y: 1 } }))
})

test('canonicalJson still tells different calls apart', () => {
  assert.notEqual(canonicalJson({ new_string: 'b' }), canonicalJson({ new_string: 'c' }))
  assert.notEqual(canonicalJson({ x: [1, 2] }), canonicalJson({ x: [2, 1] }))
})

test('fileMutation extracts write, edit, and str_replace_editor mutations', () => {
  assert.deepEqual(fileMutation({ name: 'write', arguments: { file_path: 'a.ts', content: 'x' } }), { path: 'a.ts', kind: 'write', newText: 'x' })
  assert.deepEqual(fileMutation({ name: 'edit', arguments: { file_path: 'a.ts', old_string: 'a', new_string: 'b' } }), { path: 'a.ts', kind: 'edit', newText: 'b', oldText: 'a' })
  assert.deepEqual(fileMutation({ name: 'str_replace_editor', arguments: { path: 'a.ts', command: 'create', file_text: 'x' } }), { path: 'a.ts', kind: 'write', newText: 'x' })
  assert.deepEqual(fileMutation({ name: 'str_replace_editor', arguments: { path: 'a.ts', command: 'str_replace', old_str: 'a', new_str: 'b' } }), { path: 'a.ts', kind: 'edit', newText: 'b', oldText: 'a' })
  assert.deepEqual(fileMutation({ name: 'str_replace_editor', arguments: { path: 'a.ts', command: 'insert', new_str: 'b' } }), { path: 'a.ts', kind: 'edit', newText: 'b', oldText: '' })
  assert.equal(fileMutation({ name: 'read', arguments: { file_path: 'a.ts' } }), undefined)
})

test('resolvePath normalizes redundant segments in absolute and relative paths', () => {
  const ws = resolve('workspace-root')
  const fromRel = resolvePath('src/../src/app.ts', ws)
  const fromAbs = resolvePath(`${ws}/src/../src/app.ts`, ws)
  assert.equal(fromRel.absolute, resolve(ws, 'src/app.ts'))
  assert.equal(fromAbs.absolute, resolve(ws, 'src/app.ts'))
  assert.equal(fromRel.relative, 'src/app.ts')
  assert.equal(fromAbs.relative, 'src/app.ts')
})
