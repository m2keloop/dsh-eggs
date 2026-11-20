import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as plugin from '../src/p0/plugin.js'

test('the P0 plugin entry registers the synthetic egg_run tool', async () => {
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(plugin)
    const tool = ctx.tools.get('egg_run')
    assert.ok(tool)
    assert.equal(tool.name, 'egg_run')
  } finally {
    await ctx.fiber.dispose()
  }
})
