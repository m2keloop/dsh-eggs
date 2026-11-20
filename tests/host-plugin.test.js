import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as host from '../src/integration/host.js'
import * as tools from '../src/integration/tools.js'

test('the real host plugin registers a local service and its DSH tools', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-eggs-host-'))
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    ctx.provide('profileContext', { home: root })
    await ctx.plugin(host)
    await ctx.plugin(tools)
    assert.ok(ctx.eggs)
    for (const name of ['egg_catalog', 'egg_list', 'egg_create', 'egg_run']) assert.ok(ctx.tools.get(name))
    assert.equal(ctx.tools.get('egg_connect'), undefined)
    const created = await ctx.eggs.create()
    assert.match(created.claim_config_id, /^claim_[a-f0-9]+$/)
    assert.deepEqual(await ctx.eggs.list(), [{ id: created.claim_config_id, benefitId: 'epic-free-games', label: 'Epic 免费游戏', connected: false }])
    assert.equal((await ctx.eggs.run(created.claim_config_id)).status, 'auth_required')
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})
