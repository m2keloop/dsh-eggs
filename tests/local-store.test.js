import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalStore } from '../src/local/store.js'

function keyProvider() {
  const keys = new Map()
  return {
    keys,
    async get(id) { return keys.get(id) ?? null },
    async create(id) { const key = randomBytes(32); keys.set(id, key); return key },
  }
}

test('persists a configuration and encrypted credential and restores them after restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-eggs-local-'))
  const keys = keyProvider()
  const secret = 'synthetic-local-store-token'
  let store
  try {
    store = await LocalStore.open(root, keys)
    await store.createClaim({ id: 'claim_1', benefitId: 'epic-free-games', label: 'Test account' })
    await store.saveCredential('claim_1', { token: secret })
    await store.saveRun('claim_1', { status: 'success', count: 1 })
    const effectKey = 'a'.repeat(64)
    await store.saveEffect(effectKey, { version: 1, status: 'submitting' })
    assert.equal((await readFile(join(root, 'claims', 'claim_1', 'credentials.enc'), 'utf8')).includes(secret), false)
    assert.equal((await readFile(join(root, 'claims', 'claim_1', 'config.json'), 'utf8')).includes(secret), false)
    assert.equal((await readFile(join(root, 'claims', 'claim_1', 'last-run.json'), 'utf8')).includes(secret), false)
    await store.close(); store = undefined
    store = await LocalStore.open(root, keys)
    assert.equal((await store.getClaim('claim_1')).benefitId, 'epic-free-games')
    assert.deepEqual(await store.getCredential('claim_1'), { token: secret })
    assert.equal((await store.listClaims())[0].lastRun.status, 'success')
    assert.deepEqual(await store.getEffect(effectKey), { version: 1, status: 'submitting' })
  } finally { if (store) await store.close(); await rm(root, { recursive: true, force: true }) }
})

test('fails closed when a key is missing and prevents concurrent writers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-eggs-local-'))
  const keys = keyProvider()
  let store
  try {
    store = await LocalStore.open(root, keys)
    await store.createClaim({ id: 'claim_1', benefitId: 'epic-free-games', label: 'Test' })
    await store.saveCredential('claim_1', { token: 'synthetic' })
    await assert.rejects(LocalStore.open(root, keys), { code: 'WRITER_BUSY' })
    keys.keys.clear()
    await assert.rejects(store.getCredential('claim_1'), { code: 'KEY_UNAVAILABLE' })
    await assert.rejects(store.saveCredential('claim_1', { token: 'replacement' }), { code: 'KEY_UNAVAILABLE' })
    await store.createClaim({ id: 'claim_2', benefitId: 'epic-free-games', label: 'Other' })
    await assert.rejects(store.saveCredential('claim_2', { token: 'new account' }), { code: 'KEY_UNAVAILABLE' })
    assert.equal(keys.keys.size, 0)
  } finally { if (store) await store.close(); await rm(root, { recursive: true, force: true }) }
})

test('rejects traversal, duplicate claim creation and malformed input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-eggs-local-'))
  let store
  try {
    store = await LocalStore.open(root, keyProvider())
    await assert.rejects(store.createClaim({ id: '../escape', benefitId: 'epic-free-games', label: 'x' }))
    await assert.rejects(store.createClaim({ id: 'claim_1', benefitId: 'epic-free-games', label: 'x', token: 'secret' }))
    await store.createClaim({ id: 'claim_1', benefitId: 'epic-free-games', label: 'x' })
    await assert.rejects(store.createClaim({ id: 'claim_1', benefitId: 'epic-free-games', label: 'x' }))
    await assert.rejects(store.getCredential('../escape'))
  } finally { if (store) await store.close(); await rm(root, { recursive: true, force: true }) }
})

test('deleting one local configuration removes its session without affecting other configurations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-eggs-local-'))
  let store
  try {
    store = await LocalStore.open(root, keyProvider())
    for (const id of ['claim_1', 'claim_2']) {
      await store.createClaim({ id, benefitId: 'epic-free-games', label: 'Test' })
      await store.saveCredential(id, { token: `synthetic-${id}` })
    }
    await store.deleteClaim('claim_1')
    await assert.rejects(store.getCredential('claim_1'), { code: 'ENOENT' })
    assert.deepEqual(await store.getCredential('claim_2'), { token: 'synthetic-claim_2' })
    await assert.rejects(store.deleteClaim('../escape'))
  } finally { if (store) await store.close(); await rm(root, { recursive: true, force: true }) }
})

test('stores bounded, sanitized execution history and migrates an existing latest run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-eggs-history-'))
  let store
  try {
    store = await LocalStore.open(root, keyProvider())
    await store.createClaim({ id: 'claim_1', benefitId: 'epic-free-games', label: 'Test' })
    const legacy = { version: 1, status: 'unknown', count: 0, finishedAt: '2026-01-01T00:00:00.000Z' }
    await writeFile(join(root, 'claims', 'claim_1', 'last-run.json'), JSON.stringify(legacy))
    assert.deepEqual(await store.getRunHistory('claim_1'), [{ status: legacy.status, count: 0, finishedAt: legacy.finishedAt }])
    await store.saveRun('claim_1', { status: 'success', count: 1, token: 'synthetic-secret' })
    const first = await store.getRunHistory('claim_1')
    assert.equal(first.length, 2)
    assert.equal(JSON.stringify(first).includes('synthetic-secret'), false)
    assert.equal((await readFile(join(root, 'claims', 'claim_1', 'run-history.json'), 'utf8')).includes('synthetic-secret'), false)
    for (let i = 0; i < 52; i++) await store.saveRun('claim_1', { status: 'no_offers', count: 0 })
    assert.equal((await store.getRunHistory('claim_1')).length, 50)
    await store.close(); store = undefined
    store = await LocalStore.open(root, keyProvider())
    assert.equal((await store.getRunHistory('claim_1')).length, 50)
    await store.deleteClaim('claim_1')
    await assert.rejects(store.getRunHistory('claim_1'), { code: 'ENOENT' })
  } finally { if (store) await store.close(); await rm(root, { recursive: true, force: true }) }
})
