import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { resolveConfig } from '../src/shared/live.ts'

test('resolveConfig reads live fields and passes plain ones through', () => {
  // Live fields are how DSH's Plugins page changes settings without a restart.
  let mode = 'deny'
  const config = { mode: { get: () => mode }, tools: ['bash', 'pwsh'], extra: { 'gen/**': 'run make' }, on: true }
  assert.deepEqual(resolveConfig(config), { mode: 'deny', tools: ['bash', 'pwsh'], extra: { 'gen/**': 'run make' }, on: true })
  mode = 'ask'
  assert.equal(resolveConfig(config).mode, 'ask', 'a change made on the settings page shows up on the next read')
})

test('an extra placeholder pattern that is not a valid regex is skipped, not fatal', async () => {
  // Patterns typed on the settings page apply live, so a typo must not take the plugin down.
  const { validPatterns } = await import('../src/index.ts')
  assert.deepEqual(validPatterns(['TODO: fill in', '([unclosed']), ['TODO: fill in'])
})

test('ask mode omits the retry-to-confirm hint and does not bypass via pending retries', async () => {
  const { apply } = await import('../src/index.ts')
  let handler: ((exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>) | undefined
  const ctx = {
    on(event: string, fn: typeof handler) {
      if (event === 'tools/pre-execute') handler = fn
    },
  } as unknown as Context
  let mode: 'deny' | 'ask' = 'deny'
  apply(ctx, {
    mode: { get: () => mode } as unknown as 'deny' | 'ask',
    shrinkRatio: 0.5,
    minLinesForShrink: 40,
    allowIdenticalRetry: true,
    extraPatterns: [],
    ignore: [],
    maxFileBytes: 2_000_000,
  })
  assert.ok(handler)
  const exec = {
    name: 'edit',
    arguments: { file_path: 'src/app.ts', old_string: 'a()', new_string: '// ... existing code ...' },
  } as unknown as ToolExecution
  const next = async (): Promise<PreToolDecision> => {
    throw new Error('unexpected allow')
  }

  const denied = await handler(exec, next)
  assert.equal(denied.kind, 'deny')
  assert.match(denied.reason ?? '', /repeat the identical call once to confirm/)

  // Switching to ask mode must prompt instead of consuming the earlier deny-mode retry.
  mode = 'ask'
  const asked = await handler(exec, next)
  assert.equal(asked.kind, 'ask')
  assert.doesNotMatch(asked.reason ?? '', /repeat the identical call once to confirm/)

  // Repeating in ask mode still prompts rather than silently allowing.
  const askedAgain = await handler(exec, next)
  assert.equal(askedAgain.kind, 'ask')
})

test('tools/pre-execute denies targeted edits with genuine no-ellipsis placeholder comments', async () => {
  const { apply } = await import('../src/index.ts')
  let handler: ((exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>) | undefined
  const ctx = {
    on(event: string, fn: typeof handler) {
      if (event === 'tools/pre-execute') handler = fn
    },
  } as unknown as Context
  apply(ctx, {
    mode: 'deny',
    allowIdenticalRetry: false,
    ignore: [],
    extraPatterns: [],
    shrinkRatio: 0.5,
    minLinesForShrink: 40,
    maxFileBytes: 2_000_000,
  })
  assert.ok(handler)
  const next = async (): Promise<PreToolDecision> => {
    throw new Error('unexpected allow')
  }

  for (const comment of [
    '// insert existing code here',
    '// remaining functions go here',
    '// existing code (no changes)',
    '// keep existing code intact',
    '// existing code (keep as-is)',
    '// keep all existing code',
    '// existing code (unchanged from above)',
  ]) {
    const decision = await handler(
      {
        name: 'edit',
        arguments: { file_path: 'a.ts', old_string: 'doRealWork()', new_string: comment },
      } as unknown as ToolExecution,
      next,
    )
    assert.equal(decision.kind, 'deny', comment)
    assert.match(decision.reason ?? '', /placeholder comments/, comment)
  }
})

test('tools/pre-execute allows harmless cache-retention and payload comments alongside real code', async () => {
  const { apply } = await import('../src/index.ts')
  let handler: ((exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>) | undefined
  const ctx = {
    on(event: string, fn: typeof handler) {
      if (event === 'tools/pre-execute') handler = fn
    },
  } as unknown as Context
  apply(ctx, {
    mode: 'deny',
    allowIdenticalRetry: false,
    ignore: [],
    extraPatterns: [],
    shrinkRatio: 0.5,
    minLinesForShrink: 40,
    maxFileBytes: 2_000_000,
  })
  assert.ok(handler)
  const allowed = {} as PreToolDecision
  let nextCalls = 0
  const next = async (): Promise<PreToolDecision> => {
    nextCalls += 1
    return allowed
  }

  const cases: Array<[string, string]> = [
    ['// Cached value stays the same', 'return cache.get(key)'],
    ['// Cached value stays the same until invalidated', 'return cache.get(key)'],
    ['// cache stays unchanged until the next refresh', 'return cache.get(key)'],
    ['// payload is intact', 'return payload'],
    ['// Original input is left untouched', 'return input'],
  ]
  for (const [comment, stmt] of cases) {
    const decision = await handler(
      {
        name: 'edit',
        arguments: {
          file_path: 'a.ts',
          old_string: stmt,
          new_string: `${comment}\n${stmt}`,
        },
      } as unknown as ToolExecution,
      next,
    )
    assert.equal(decision, allowed, comment)
  }
  assert.equal(nextCalls, cases.length)
})
