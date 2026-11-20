import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyEpicEntitlements, checkEpicEntitlement } from '../src/adapters/epic/entitlements.js'

test('ownership requires active matching catalog items in the correct namespace', () => {
  const offer = { namespace: 'game', id: 'offer', catalogItemIds: ['item1', 'item2'] }
  const active = id => ({ namespace: 'game', catalogItemId: id, status: 'ACTIVE' })
  assert.equal(verifyEpicEntitlements(offer, [active('item1'), active('item2')]), 'owned')
  for (const rows of [[], [active('item1')], [active('offer')], [active('item1'), { ...active('item2'), namespace: 'other' }], [active('item1'), { ...active('item2'), status: 'REVOKED' }], [active('item1'), { ...active('item2'), status: 'unknown' }]]) assert.equal(verifyEpicEntitlements(offer, rows), 'unknown')
  assert.equal(verifyEpicEntitlements({ ...offer, catalogItemIds: [] }, [active('item1')]), 'unknown')
  assert.equal(verifyEpicEntitlements({ ...offer, catalogItemIds: ['../item'] }, [active('item1')]), 'unknown')
  assert.equal(verifyEpicEntitlements(offer, null), 'unknown')
})

test('fetches ownership pages without returning session data or guessing absence', async () => {
  const calls = []
  const offer = { namespace: 'ns', catalogItemIds: ['item1', 'item2'] }
  const item = id => ({ namespace: 'ns', catalogItemId: id, status: 'ACTIVE', privateField: 'do-not-return' })
  const fetch = async (url, options) => {
    calls.push({ url, options })
    const rows = calls.length === 1 ? [...Array.from({ length: 999 }, () => ({})), item('item1')] : [item('item2')]
    return { ok: true, text: async () => JSON.stringify(rows) }
  }
  assert.equal(await checkEpicEntitlement({ accountId: 'account_1', accessToken: 'synthetic-secret', offer, fetch }), 'owned')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].url.searchParams.get('start'), '1000')
  assert.equal(calls[0].url.hostname, 'entitlement-public-service-prod08.ol.epicgames.com')
  assert.equal(calls[0].options.redirect, 'error')
  assert.equal(await checkEpicEntitlement({ accountId: 'account_1', accessToken: 'synthetic-secret', offer, fetch: async () => ({ ok: true, text: async () => '[]' }) }), 'unknown')
  await assert.rejects(checkEpicEntitlement({ accountId: 'account_1', accessToken: 'synthetic-secret', offer, fetch: async () => { throw new Error('synthetic-secret') } }), error => !String(error).includes('synthetic-secret'))
})
