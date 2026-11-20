import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import EggsPanel from '../src/integration/remote-host.js'
import { TYPERT } from '../src/integration/typert.js'

test('panel exposes safe results with strict argument validation', async () => {
  const ctx = new Context()
  const secret = 'synthetic-secret-that-must-not-be-returned'
  ctx.provide('eggs', {
    listBenefits: () => [{ id: 'epic-free-games', name: 'Epic 免费游戏' }],
    list: async () => [{ id: 'claim_1', benefitId: 'epic-free-games', label: 'Epic', connected: true }],
    create: async () => ({ claim_config_id: 'claim_1' }),
    connect: async () => ({ status: 'ready' }),
    run: async () => ({ status: 'success', count: 1 }),
    secret,
  })
  ctx.provide('schedule', {})
  try {
    await ctx.plugin(EggsPanel)
    assert.deepEqual(remoteMethods(ctx.eggsPanel).map(x => x.method), ['catalog', 'list', 'create', 'connect', 'run', 'schedule', 'deleteClaim', 'freeOffers', 'history', 'updateSettings'])
    const responses = [await ctx.eggsPanel.catalog(), await ctx.eggsPanel.list(), await ctx.eggsPanel.create('epic-free-games'), await ctx.eggsPanel.connect('claim_1'), await ctx.eggsPanel.run('claim_1')]
    assert.equal(JSON.stringify(responses).includes(secret), false)
    const schedule = TYPERT.invocations.find(x => x.method === 'schedule')
    assert.equal(schedule.input({ strict: true }).create().safeParse({ id: 'claim_1', seconds: 86400 }).success, true)
    assert.equal(schedule.input({ strict: true }).create().safeParse({ id: 'claim_1', seconds: 1 }).success, false)
    assert.equal(schedule.input({ strict: true }).create().safeParse({ id: 'claim_1', seconds: 86400, secret }).success, false)
    const settings = TYPERT.invocations.find(x => x.method === 'updateSettings')
    assert.equal(settings.input({ strict: true }).create().safeParse({ id: 'claim_1', settings: { region: 'CN' } }).success, true)
    assert.equal(settings.input({ strict: true }).create().safeParse({ id: 'claim_1', settings: { region: { token: secret } } }).success, false)
    const create = TYPERT.invocations.find(x => x.method === 'create')
    assert.equal(create.input({ strict: true }).create().safeParse({ benefitId: 'epic-free-games' }).success, true)
    assert.equal(create.input({ strict: true }).create().safeParse({ benefitId: 'regional', settings: { region: 'CN' } }).success, true)
  } finally { await ctx.fiber.dispose() }
})
