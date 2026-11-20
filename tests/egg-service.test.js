import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EggService } from '../src/egg-service.js'

test('connect keeps credentials inside the local store and returns only status', async () => {
  const secret = 'synthetic-oauth-cookie'
  const saved = []
  const store = { async getClaim() { return { id: 'claim_1', benefitId: 'epic-free-games' } }, async getCredential() { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) }, async saveCredential(id, credential) { saved.push([id, credential]) } }
  const service = new EggService({ store, adapter: { async connect() { return { accountId: 'account_1', storageState: { cookies: [{ value: secret }] } } } } })
  const response = await service.connect('claim_1')
  assert.deepEqual(response, { status: 'ready' })
  assert.equal(JSON.stringify(response).includes(secret), false)
  assert.equal(saved[0][1].storageState.cookies[0].value, secret)
})

test('connect failures do not return the error or account material', async () => {
  const store = { async getClaim() { return { id: 'claim_1', benefitId: 'epic-free-games' } }, async getCredential() { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) } }
  const service = new EggService({ store, adapter: { async connect() { throw new Error('synthetic-cookie') } } })
  assert.deepEqual(await service.connect('claim_1'), { status: 'failed', code: 'CONNECT_FAILED' })
})

test('reconnecting a different account never overwrites the existing session', async () => {
  let writes = 0
  const store = { async getClaim() { return { id: 'claim_1', benefitId: 'epic-free-games' } }, async getCredential() { return { accountId: 'account_1' } }, async saveCredential() { writes++ } }
  const service = new EggService({ store, adapter: { async connect() { return { accountId: 'account_2', storageState: {} } } } })
  assert.deepEqual(await service.connect('claim_1'), { status: 'failed', code: 'ACCOUNT_MISMATCH' })
  assert.equal(writes, 0)
})

test('catalog routes each benefit to its registered adapter and rejects unknown benefits', async () => {
  const configs = new Map(), calls = []
  const store = {
    async createClaim(config) { configs.set(config.id, config) },
    async getClaim(id) { return configs.get(id) },
    async getCredential() { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) },
    async saveCredential(_id, value) { calls.push(value) },
  }
  const adapters = {
    'first-benefit': { name: 'First', adapter: { async connect() { return { accountId: 'one' } } } },
    'second-benefit': { name: 'Second', adapter: { async connect() { return { accountId: 'two' } } } },
  }
  const service = new EggService({ store, adapters })
  assert.equal(service.listBenefits().length, 2)
  const { claim_config_id: id } = await service.create('second-benefit')
  assert.deepEqual(await service.connect(id), { status: 'ready' })
  assert.deepEqual(calls, [{ accountId: 'two' }])
  await assert.rejects(service.create('unknown'))
})

test('cancelling during login never writes a credential', async () => {
  const controller = new AbortController()
  let writes = 0
  const store = {
    async getClaim() { return { id: 'claim_1', benefitId: 'epic-free-games' } },
    async getCredential() { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) },
    async saveCredential() { writes++ },
  }
  const service = new EggService({ store, adapter: { async connect() { controller.abort(); return { accountId: 'account_1' } } } })
  await assert.rejects(service.connect('claim_1', controller.signal), { name: 'AbortError' })
  assert.equal(writes, 0)
})

test('public discovery requires an explicit country and only returns safe Epic links', async () => {
  const adapter = { async discoverPublic(country) { assert.equal(country, 'US'); return [
    { title: 'Free game', url: 'https://store.epicgames.com/en-US/p/game', expiresAt: '2099-01-01T00:00:00Z', secret: 'synthetic' },
    { title: 'Unsafe', url: 'https://example.test/game', expiresAt: '2099-01-01T00:00:00Z' },
  ] } }
  const service = new EggService({ store: {}, adapter })
  await assert.rejects(service.listPublicOffers('us'))
  assert.deepEqual(await service.listPublicOffers('US'), [{ title: 'Free game', url: 'https://store.epicgames.com/en-US/p/game', expiresAt: '2099-01-01T00:00:00Z' }])
})
