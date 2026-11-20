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
