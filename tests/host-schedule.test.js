import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import Schedule from '@deepseek-ai/dsh-schedule'
import { LocalStore } from '../src/local/store.js'
import { EggService } from '../src/egg-service.js'
import * as tools from '../src/integration/tools.js'
import * as scope from '../src/integration/runner-scope.js'
import { createEggSchedule } from '../src/integration/scheduler.js'
import { createBrowserSession } from './support/browser-session.js'

test('native schedule drives the production tool with isolated stored credentials and a fake Epic adapter', { timeout: 30000, skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ehs-'))
  const key = randomBytes(32), secret = `synthetic-${randomBytes(24).toString('hex')}`
  const keys = { async get() { return key }, async create() { return key } }
  let store, browserSession, submissions = 0, owned = false
  const requests = []
  class FakeModel extends LlmAdapter {
    async *stream(options) {
      requests.push(JSON.stringify(options))
      if (requests.length === 1) {
        const args = JSON.stringify({ claim_config_id: 'claim_1' })
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: 'call_1', name: 'egg_run', argumentsDelta: args }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call_1', name: 'egg_run', arguments: args } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'done' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
  }
  const adapter = {
    async authenticate(credential) { assert.equal(credential.token, secret); return { subject: 'test-account' } },
    async discover() { return [{ id: 'test-offer', namespace: 'test', expiresAt: '2099-01-01T00:00:00Z' }] },
    async verify() { return owned ? 'owned' : 'not_owned' },
    async submit() { if (browserSession) await browserSession.session.probe(); submissions++; owned = true },
  }
  const ctx = new Context()
  try {
    store = await LocalStore.open(join(root, 'eggs'), keys)
    if (process.env.DSH_EGGS_TEST_CHROMIUM_CFT) browserSession = await createBrowserSession(root, process.env.DSH_EGGS_TEST_CHROMIUM_CFT)
    await store.createClaim({ id: 'claim_1', benefitId: 'epic-free-games', label: 'Test' })
    await store.saveCredential('claim_1', { token: secret })
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(Storage); await ctx.plugin(StorageJson, { root: join(root, 'schedule') }); await ctx.plugin(StorageDomain, { backend: 'json' }); await ctx.plugin(Schedule)
    ctx.provide('eggs', new EggService({ store, adapter }))
    // The full Web Host provides this service; this test does not deliver the
    // long-running task and only needs to check its stored target.
    ctx.provide('sessionController', {})
    const schedulable = 'claim_' + 'a'.repeat(32)
    await store.createClaim({ id: schedulable, benefitId: 'epic-free-games', label: 'Test schedule' })
    const created = await createEggSchedule(ctx, schedulable, 86400)
    assert.deepEqual(await createEggSchedule(ctx, schedulable, 86400), { status: 'already_exists', schedule_id: created.schedule_id })
    const saved = await ctx.schedule.view({ id: created.schedule_id })
    assert.equal(saved.target.create.agentPreset, 'eggs-runner')
    assert.equal(saved.prompt.includes(schedulable), true)
    await assert.rejects(createEggSchedule(ctx, schedulable, 1))
    await ctx.plugin(tools)
    ctx.llm.registerAdapter(['mock'], new FakeModel())
    const agent = await ctx.agentLoop.create('p0-production', { provider: 'mock', model: 'mock' })
    await agent.ctx.plugin(scope)
    ctx.on('schedule/resolve-agent', async () => agent)
    const task = await ctx.schedule.create({ title: 'P0', prompt: 'Run egg_run.', timing: { kind: 'after', after_seconds: 1 }, target: { kind: 'session', sessionId: agent.session.id } }, agent.session.id)
    const deadline = Date.now() + 15000
    while (submissions === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(submissions, 1)
    await agent.whenIdle()
    const events = JSON.stringify(agent.session.snapshotEvents())
    assert.equal(events.includes('success'), true)
    assert.equal(events.includes(secret), false)
    assert.equal(requests.every(request => !request.includes(secret)), true)
    assert.equal(requests[0].includes('egg_connect'), false)
    assert.equal(requests[0].includes('egg_create'), false)
    assert.equal(requests[0].includes('egg_run'), true)
    let history
    while (Date.now() < deadline) { history = await ctx.schedule.history({ id: task.id, limit: 10 }); if (JSON.stringify(history).includes('p0-production')) break; await new Promise(resolve => setTimeout(resolve, 50)) }
    assert.equal(JSON.stringify(history).includes('p0-production'), true)
  } finally { await ctx.fiber.dispose(); if (browserSession) await browserSession.close(); if (store) await store.close(); await rm(root, { recursive: true, force: true }) }
})
