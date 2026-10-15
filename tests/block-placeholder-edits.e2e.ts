import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pluginEntry, runDsh } from './helpers/dsh.ts'

const plugin = { id: 'block-placeholder-edits', entry: pluginEntry }
const original = ['export function a() {', '  setup()', '  return 1', '}', '', 'export function b() {', '  return 2', '}', ''].join('\n')
const lazy = { file_path: 'src/app.ts', old_string: 'export function a() {\n  setup()\n  return 1\n}', new_string: 'export function a() {\n  // ... existing code ...\n  return 42\n}' }

test('a placeholder edit is blocked and the file is untouched; a full edit goes through', async () => {
  const run = await runDsh({
    plugins: [plugin],
    files: { 'src/app.ts': original },
    readAfter: ['src/app.ts'],
    script: [
      { tool: 'read', input: { file_path: 'src/app.ts' } },
      { tool: 'edit', input: lazy },
      { tool: 'edit', input: { ...lazy, new_string: 'export function a() {\n  setup()\n  return 42\n}' } },
    ],
  })
  assert.equal(run.exitCode, 0, run.stderr)
  const [, blocked, ok] = run.toolResults
  assert.match(blocked!.result, /block-placeholder-edits blocked this edit to src\/app\.ts/)
  assert.match(blocked!.result, /line 2: \/\/ \.\.\. existing code \.\.\./)
  assert.equal(ok!.status, 'completed', ok!.result)
  assert.match(run.filesAfter['src/app.ts']!, /return 42/)
  assert.match(run.filesAfter['src/app.ts']!, /setup\(\)/)
})

test('repeating the identical blocked call confirms it', async () => {
  const run = await runDsh({
    plugins: [plugin],
    files: { 'src/app.ts': original },
    readAfter: ['src/app.ts'],
    script: [
      { tool: 'read', input: { file_path: 'src/app.ts' } },
      { tool: 'edit', input: lazy },
      { tool: 'edit', input: lazy },
    ],
  })
  assert.equal(run.exitCode, 0, run.stderr)
  assert.match(run.toolResults[1]!.result, /block-placeholder-edits blocked/)
  assert.equal(run.toolResults[2]!.status, 'completed', run.toolResults[2]!.result)
  assert.match(run.filesAfter['src/app.ts']!, /existing code/)
})

test('a whole-file write that drops most of a large file is blocked', async () => {
  const big = Array.from({ length: 80 }, (_, i) => `export const v${i} = ${i}`).join('\n') + '\n'
  const run = await runDsh({
    plugins: [plugin],
    files: { 'src/consts.ts': big },
    readAfter: ['src/consts.ts'],
    script: [
      { tool: 'read', input: { file_path: 'src/consts.ts' } },
      { tool: 'write', input: { file_path: 'src/consts.ts', content: 'export const v0 = 100\n' } },
    ],
  })
  assert.equal(run.exitCode, 0, run.stderr)
  assert.match(run.toolResults[1]!.result, /replaces a 80-line file with 1 line,/)
  assert.equal(run.filesAfter['src/consts.ts'], big)
})

test('works when installed with `dsh plugin add`', async () => {
  const run = await runDsh({
    installed: true,
    files: { 'src/app.ts': original },
    script: [
      { tool: 'read', input: { file_path: 'src/app.ts' } },
      { tool: 'edit', input: lazy },
    ],
  })
  assert.equal(run.exitCode, 0, run.stderr)
  assert.match(run.toolResults[1]!.result, /block-placeholder-edits blocked this edit/)
})
