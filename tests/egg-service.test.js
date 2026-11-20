import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EggService } from '../src/egg-service.js'

const completeAdapter = overrides => Object.assign({
  async connect() { throw new Error('unexpected connect') }, async authenticate() { throw new Error('unexpected authenticate') },
  async discover() { throw new Error('unexpected discover') }, async verify() { throw new Error('unexpected verify') }, async submit() { throw new Error('unexpected submit') },
}, overrides)

test('connect keeps credentials inside the local store and returns only status', async () => {
  const secret = 'synthetic-oauth-cookie'
  const saved = []
  const store = { async getClaim() { return { id: 'claim_1', benefitId: 'epic-free-games' } }, async getCredential() { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) }, async saveCredential(id, credential) { saved.push([id, credential]) } }
  const service = new EggService({ store, adapter: completeAdapter({ async connect() { return { accountId: 'account_1', storageState: { cookies: [{ value: secret }] } } } }) })
  const response = await service.connect('claim_1')
  assert.deepEqual(response, { status: 'ready' })
  assert.equal(JSON.stringify(response).includes(secret), false)
  assert.equal(saved[0][1].storageState.cookies[0].value, secret)
})

test('connect failures do not return the error or account material', async () => {
  const store = { async getClaim() { return { id: 'claim_1', benefitId: 'epic-free-games' } }, async getCredential() { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) } }
  const service = new EggService({ store, adapter: completeAdapter({ async connect() { throw new Error('synthetic-cookie') } }) })
  assert.deepEqual(await service.connect('claim_1'), { status: 'failed', code: 'CONNECT_FAILED' })
})

test('non-Error adapter failures are reduced to a fixed status', async () => {
  const store = { async getClaim() { return { id: 'claim_1', benefitId: 'epic-free-games' } }, async getCredential() { return { accountId: 'synthetic' } }, async saveRun() {} }
  const service = new EggService({ store, adapter: completeAdapter({ async connect() { throw null }, async authenticate() { throw null } }) })
  assert.deepEqual(await service.connect('claim_1'), { status: 'failed', code: 'CONNECT_FAILED' })
  assert.deepEqual(await service.run('claim_1'), { status: 'failed', count: 0 })
})

test('reconnecting a different account never overwrites the existing session', async () => {
  let writes = 0
  const store = { async getClaim() { return { id: 'claim_1', benefitId: 'epic-free-games' } }, async getCredential() { return { accountId: 'account_1' } }, async saveCredential() { writes++ } }
  const service = new EggService({ store, adapter: completeAdapter({ async connect() { return { accountId: 'account_2', storageState: {} } } }) })
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
    'first-benefit': { name: 'First', adapter: completeAdapter({ async connect() { return { accountId: 'one' } } }) },
    'second-benefit': { name: 'Second', adapter: completeAdapter({ async connect() { return { accountId: 'two' } } }) },
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
  const service = new EggService({ store, adapter: completeAdapter({ async connect() { controller.abort(); return { accountId: 'account_1' } } }) })
  await assert.rejects(service.connect('claim_1', controller.signal), { name: 'AbortError' })
  assert.equal(writes, 0)
})

test('public discovery requires an explicit country and only returns safe Epic links', async () => {
  const adapter = { async discoverPublic(country) { assert.equal(country, 'US'); return [
    { title: 'Free game', url: 'https://store.epicgames.com/en-US/p/game', expiresAt: '2099-01-01T00:00:00Z', secret: 'synthetic' },
    { title: 'Unsafe', url: 'https://example.test/game', expiresAt: '2099-01-01T00:00:00Z' },
  ] } }
  const service = new EggService({ store: {}, adapter: completeAdapter(adapter) })
  await assert.rejects(service.listPublicOffers('us'))
  assert.deepEqual(await service.listPublicOffers('US'), [{ title: 'Free game', url: 'https://store.epicgames.com/en-US/p/game', expiresAt: '2099-01-01T00:00:00Z' }])
})

test('a benefit explicitly marked anonymous runs without creating or reading credentials', async () => {
  const configs = new Map(), effects = new Map(), runs = []
  const store = {
    async createClaim(config) { configs.set(config.id, config) },
    async getClaim(id) { return configs.get(id) },
    async listClaims() { return [...configs.values()].map(config => ({ ...config, connected: false })) },
    async getCredential() { throw new Error('unexpected credential read') },
    async saveCredential() { throw new Error('unexpected credential write') },
    async getEffect(key) { return effects.get(key) },
    async saveEffect(key, value) { effects.set(key, value) },
    async saveRun(_id, result) { runs.push(result) },
  }
  let owned = false
  const adapter = {
    async authenticate(credential) { assert.equal(credential, null); return { subject: 'public', async close() {} } },
    async discover() { return [{ id: 'today', namespace: 'public', expiresAt: '2099-01-01T00:00:00Z' }] },
    async verify() { return owned ? 'owned' : 'not_owned' },
    async submit() { owned = true },
  }
  const service = new EggService({ store, adapters: { 'anonymous-example': { name: 'No login', authentication: 'none', adapter } } })
  const { claim_config_id: id } = await service.create('anonymous-example')
  assert.deepEqual(await service.connect(id), { status: 'ready' })
  assert.equal((await service.list())[0].authentication, 'none')
  assert.deepEqual(await service.run(id), { status: 'success', count: 1 })
  assert.deepEqual(runs, [{ status: 'success', count: 1 }])
})

test('declared benefit settings are validated, stored and passed into each adapter step', async () => {
  let config, owned = false, received = []
  const store = {
    async createClaim(value) { config = value }, async getClaim() { return config }, async getEffect() { return null }, async saveEffect() {}, async saveRun() {},
  }
  const settings = [{ key: 'region', label: 'Region', choices: [{ value: 'CN', label: 'China' }, { value: 'US', label: 'United States' }] }]
  const adapter = {
    async authenticate(_credential, context) { received.push(context.settings.region); return { subject: 'public' } },
    async discover(context) { received.push(context.settings.region); return [{ id: 'offer', namespace: 'test', expiresAt: '2099-01-01T00:00:00Z' }] },
    async verify(_credential, _offer, context) { received.push(context.settings.region); return owned ? 'owned' : 'not_owned' },
    async submit(_credential, _offer, context) { received.push(context.settings.region); owned = true },
  }
  const service = new EggService({ store, adapters: { 'regional-benefit': { name: 'Regional', authentication: 'none', settings, adapter } } })
  await assert.rejects(service.create('regional-benefit', { token: 'synthetic' }))
  const { claim_config_id: id } = await service.create('regional-benefit', { region: 'US' })
  assert.deepEqual(config.settings, { region: 'US' })
  assert.deepEqual(await service.run(id), { status: 'success', count: 1 })
  assert.deepEqual(received, ['US', 'US', 'US', 'US', 'US'])
})
