import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ClaimRuntime } from '../src/runtime/claim-runtime.js'

function harness({ existing, verify = async () => 'not_owned', submit = async () => 'submitted', expiresAt = '2099-01-01T00:00:00.000Z' } = {}) {
  const effects = new Map(existing ? [[existing.key, existing.record]] : [])
  const records = []
  let submissions = 0
  const store = {
    async getClaim() { return { id: 'claim_1', benefitId: 'epic-free-games' } },
    async getCredential() { return { token: 'synthetic' } },
    async getEffect(key) { return effects.get(key) ?? null },
    async saveEffect(key, value) { effects.set(key, value); records.push(value.status) },
  }
  const adapter = {
    async authenticate() { return { subject: 'account_1' } },
    async discover() { return [{ id: 'offer_1', namespace: 'ns', expiresAt }] },
    verify,
    async submit(...args) { submissions++; return submit(...args) },
  }
  return { runtime: new ClaimRuntime({ store, adapter }), effects, records, submissions: () => submissions }
}

test('persists intent before submitting and confirms ownership before success', async () => {
  let checks = 0
  const h = harness({ verify: async () => ++checks === 1 ? 'not_owned' : 'owned' })
  const result = await h.runtime.run('claim_1')
  assert.equal(result.status, 'success')
  assert.equal(h.submissions(), 1)
  assert.deepEqual(h.records, ['submitting', 'claimed'])
})

test('a timeout after submission stays unknown and is verified before another attempt', async () => {
  let checks = 0
  const h = harness({ verify: async () => ++checks === 1 ? 'not_owned' : 'unknown', submit: async () => { throw new Error('synthetic sensitive response') } })
  assert.equal((await h.runtime.run('claim_1')).status, 'unknown')
  assert.equal((await h.runtime.run('claim_1')).status, 'unknown')
  assert.equal(h.submissions(), 1)
})

test('manual checkout action is reported while preserving an unknown effect', async () => {
  let checks = 0
  const h = harness({ verify: async () => ++checks === 1 ? 'not_owned' : 'unknown', submit: async () => { throw Object.assign(new Error('action required'), { code: 'USER_ACTION_REQUIRED' }) } })
  assert.equal((await h.runtime.run('claim_1')).status, 'user_action_required')
  assert.deepEqual(h.records, ['submitting', 'unknown'])
  assert.equal((await h.runtime.run('claim_1')).status, 'unknown')
  assert.equal(h.submissions(), 1)
})

test('concurrent executions for the same opportunity do not submit twice', async () => {
  let owned = false
  const h = harness({ verify: async () => owned ? 'owned' : 'not_owned', submit: async () => { await new Promise(resolve => setTimeout(resolve, 10)); owned = true; return 'submitted' } })
  const results = await Promise.all([h.runtime.run('claim_1'), h.runtime.run('claim_1')])
  assert.equal(h.submissions(), 1)
  assert.equal(results.every(r => r.status === 'success'), true)
})

test('two configurations for the same account serialize the same opportunity', async () => {
  const effects = new Map()
  let submissions = 0, owned = false
  const store = {
    async getClaim() { return { benefitId: 'example' } }, async getCredential() { return { accountId: 'same-account' } },
    async getEffect(key) { return effects.get(key) }, async saveEffect(key, record) { effects.set(key, record) },
  }
  const adapter = {
    async authenticate() { return { subject: 'same-account' } },
    async discover() { return [{ id: 'today', namespace: 'example', expiresAt: '2099-01-01T00:00:00Z' }] },
    async verify() { return owned ? 'owned' : 'not_owned' },
    async submit() { submissions++; await new Promise(resolve => setTimeout(resolve, 10)); owned = true },
  }
  const runtime = new ClaimRuntime({ store, adapter })
  const results = await Promise.all([runtime.run('claim_1'), runtime.run('claim_2')])
  assert.equal(submissions, 1)
  assert.equal(results.every(result => result.status === 'success'), true)
})

test('a stable cycle prevents resubmission when only the expiry changes', async () => {
  let discovers = 0, checks = 0, submissions = 0
  const effects = new Map()
  const store = { async getClaim() { return { benefitId: 'example' } }, async getCredential() { return {} }, async getEffect(key) { return effects.get(key) }, async saveEffect(key, value) { effects.set(key, value) } }
  const adapter = {
    async authenticate() { return { subject: 'account' } },
    async discover() { return [{ id: 'offer', namespace: 'example', cycleKey: 'period-1', expiresAt: ++discovers === 1 ? '2098-01-01T00:00:00Z' : '2099-01-01T00:00:00Z' }] },
    async verify() { return ++checks === 2 ? 'owned' : 'not_owned' },
    async submit() { submissions++ },
  }
  const runtime = new ClaimRuntime({ store, adapter })
  assert.equal((await runtime.run('claim_1')).status, 'success')
  assert.equal((await runtime.run('claim_1')).status, 'unknown')
  assert.equal(submissions, 1)
})

test('a previous success is rechecked and an ambiguous result is not resubmitted', async () => {
  let checks = 0
  const h = harness({ verify: async () => ++checks <= 2 ? (checks === 1 ? 'not_owned' : 'owned') : 'unknown' })
  assert.equal((await h.runtime.run('claim_1')).status, 'success')
  assert.equal((await h.runtime.run('claim_1')).status, 'unknown')
  assert.equal(h.submissions(), 1)
})

test('cancellation during ownership verification never starts a submission', async () => {
  const controller = new AbortController()
  const h = harness({ verify: async () => { controller.abort(); return 'not_owned' } })
  await assert.rejects(h.runtime.run('claim_1', controller.signal), { name: 'AbortError' })
  assert.equal(h.submissions(), 0)
  assert.deepEqual(h.records, [])
})

test('a promotion that expires during verification is never submitted', async () => {
  const h = harness({ expiresAt: new Date(Date.now() + 100).toISOString(), verify: async () => { await new Promise(resolve => setTimeout(resolve, 150)); return 'not_owned' } })
  assert.equal((await h.runtime.run('claim_1')).status, 'unknown')
  assert.equal(h.submissions(), 0)
  assert.deepEqual(h.records, [])
})

test('an invalid opportunity cannot be reported as no offers', async () => {
  const store = { async getClaim() { return { benefitId: 'sample' } }, async getCredential() { return {} } }
  const adapter = { async authenticate() { return { subject: 'one' } }, async discover() { return [{ id: 123, namespace: 'ns', expiresAt: '2099-01-01T00:00:00Z' }] } }
  assert.deepEqual(await new ClaimRuntime({ store, adapter }).run('claim_1'), { status: 'unknown', count: 0 })
})

test('invalid account is closed and cannot replace a credential', async () => {
  let closed = 0, saved = 0
  const store = { async getClaim() { return {} }, async getCredential() { return { accountId: 'expected' } }, async saveCredential() { saved++ } }
  const adapter = { async authenticate() { return { subject: 'other', async close() { closed++ }, async snapshot() { return { accountId: 'expected' } } } } }
  assert.equal((await new ClaimRuntime({ store, adapter }).run('claim_1')).status, 'auth_required')
  assert.equal(closed, 1)
  assert.equal(saved, 0)
})

test('a refreshed session cannot silently switch accounts', async () => {
  let closed = false, saved = 0
  const store = { async getClaim() { return {} }, async getCredential() { return { accountId: 'expected' } }, async saveCredential() { saved++ } }
  const adapter = { async authenticate() { return { subject: 'expected', async close() { closed = true }, async snapshot() { return { accountId: 'other' } } } }, async discover() { return [] } }
  await assert.rejects(new ClaimRuntime({ store, adapter }).run('claim_1'), { code: 'AUTH_REQUIRED' })
  assert.equal(closed, true)
  assert.equal(saved, 0)
})

test('a queued operation can be cancelled without bypassing the preceding lock', async () => {
  const runtime = new ClaimRuntime({ store: {}, adapter: {} })
  let release, entered = false
  const first = runtime.withEffect('same', () => new Promise(resolve => { release = resolve }))
  await new Promise(resolve => setImmediate(resolve))
  const controller = new AbortController()
  const cancelled = runtime.withEffect('same', async () => { entered = true }, controller.signal)
  const third = runtime.withEffect('same', async () => { entered = true })
  controller.abort()
  await assert.rejects(cancelled, { name: 'AbortError' })
  assert.equal(entered, false)
  release()
  await Promise.all([first, third])
  assert.equal(entered, true)
})

test('a new waiter cannot bypass a cancelled tail while the lock is held', async () => {
  const runtime = new ClaimRuntime({ store: {}, adapter: {} })
  let release, entered = false
  const first = runtime.withEffect('same', () => new Promise(resolve => { release = resolve }))
  await new Promise(resolve => setImmediate(resolve))
  const controller = new AbortController()
  const second = runtime.withEffect('same', async () => {}, controller.signal)
  controller.abort()
  await assert.rejects(second, { name: 'AbortError' })
  const late = runtime.withEffect('same', async () => { entered = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(entered, false)
  release()
  await Promise.all([first, late])
  assert.equal(entered, true)
})
