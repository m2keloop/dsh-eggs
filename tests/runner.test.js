import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runFakeClaim, safeResult } from '../src/p0/runner.js'

test('fake claim performs local verification and returns only allowed fields', async () => {
  const secret = 'synthetic-secret-must-not-leak'
  const result = await runFakeClaim({ claimConfigId: 'claim_p0', readCredential: async () => secret })
  assert.deepEqual(result, { run_id: 'p0-run', status: 'verified', code: 'FAKE_CLAIM_VERIFIED' })
  assert.equal(JSON.stringify(result).includes(secret), false)
  assert.deepEqual(Object.keys(result).sort(), ['code', 'run_id', 'status'])
})

test('credential errors and invalid ids do not leak exception text', async () => {
  const secret = 'synthetic-secret-must-not-leak'
  const failure = await runFakeClaim({ claimConfigId: 'claim_p0', readCredential: async () => { throw new Error(secret) } })
  assert.deepEqual(failure, { run_id: 'p0-run', status: 'failed', code: 'LOCAL_CREDENTIAL_ERROR' })
  assert.equal(JSON.stringify(failure).includes(secret), false)
  assert.deepEqual(safeResult('../credentials.enc'), { run_id: 'p0-run', status: 'failed', code: 'INVALID_CONFIG_ID' })
})

test('cancellation is honored and does not return a fake success', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(runFakeClaim({ claimConfigId: 'claim_p0', readCredential: async () => 'synthetic', signal: controller.signal }), { name: 'AbortError' })
})
