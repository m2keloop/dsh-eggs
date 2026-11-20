import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createExampleAdapter, exampleSettings } from '../examples/adapter-example.js'
import { withAdapterHarness } from './support/adapter-harness.js'
import { EggService } from '../src/egg-service.js'
import { LocalStore } from '../src/local/store.js'

test('example adapter uses the real local runtime with isolated synthetic data', { skip: process.platform === 'win32' }, async () => {
  await withAdapterHarness('example-benefit', { name: 'Example', authentication: 'none', settings: exampleSettings, adapter: createExampleAdapter() }, async ({ service, configId, store }) => {
    assert.deepEqual((await store.getClaim(configId)).settings, { region: 'CN' })
    assert.deepEqual(await service.updateSettings(configId, { region: 'US' }), { status: 'updated' })
    assert.deepEqual((await service.list())[0].settings, { region: 'US' })
    await assert.rejects(service.updateSettings(configId, { region: 'unlisted' }))
    assert.deepEqual((await store.getClaim(configId)).settings, { region: 'US' })
    assert.deepEqual(await service.run(configId), { status: 'success', count: 1 })
    assert.deepEqual(await service.run(configId), { status: 'success', count: 1 })
    const history = await service.history(configId)
    assert.equal(history.length, 2)
    assert.equal(history.every(item => item.status === 'success'), true)
  })
})

test('updating benefit settings waits for the active run to finish', { skip: process.platform === 'win32' }, async () => {
  let release, entered
  const started = new Promise(resolve => { entered = resolve })
  const adapter = createExampleAdapter()
  const original = adapter.discover
  adapter.discover = async context => {
    entered()
    await new Promise(resolve => { release = resolve })
    return original(context)
  }
  await withAdapterHarness('example-benefit', { name: 'Example', authentication: 'none', settings: exampleSettings, adapter }, async ({ service, configId, store }) => {
    const run = service.run(configId)
    await started
    const update = service.updateSettings(configId, { region: 'US' })
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual((await store.getClaim(configId)).settings, { region: 'CN' })
    release()
    assert.equal((await run).status, 'success')
    assert.equal((await update).status, 'updated')
    assert.deepEqual((await store.getClaim(configId)).settings, { region: 'US' })
  })
})

test('changed or removed setting choices require repair without hiding the configuration', { skip: process.platform === 'win32' }, async () => {
  await withAdapterHarness('example-benefit', { name: 'Example', authentication: 'none', settings: exampleSettings, adapter: createExampleAdapter() }, async ({ configId, store }) => {
    const changed = [{ key: 'region', label: 'Region', choices: [{ value: 'US', label: 'United States' }] }]
    const entry = { name: 'Example', authentication: 'none', settings: changed, adapter: createExampleAdapter() }
    const updated = new EggService({ store, adapters: { 'example-benefit': entry } })
    const listed = (await updated.list())[0]
    assert.equal(listed.settingsInvalid, true)
    assert.deepEqual(listed.settings, { region: 'US' })
    assert.equal((await updated.run(configId)).status, 'settings_required')
    assert.equal((await store.getClaim(configId)).settings.region, 'CN')
    await updated.updateSettings(configId, { region: 'US' })
    assert.equal((await updated.list())[0].settingsInvalid, undefined)
    assert.equal((await updated.run(configId)).status, 'success')
    const withoutSettings = new EggService({ store, adapters: { 'example-benefit': { ...entry, settings: [] } } })
    assert.equal((await withoutSettings.list())[0].settingsInvalid, true)
    await withoutSettings.updateSettings(configId, {})
    assert.equal((await withoutSettings.list())[0].settingsInvalid, undefined)
  })
})

test('an uncertain submission is reconciled after restarting the local runtime', { skip: process.platform === 'win32' }, async () => {
  let status = 'not_owned', submissions = 0
  const adapter = {
    async authenticate() { return { subject: 'public' } },
    async discover() { return [{ id: 'offer', namespace: 'example', cycleKey: 'period', expiresAt: '2099-01-01T00:00:00Z' }] },
    async verify() { return status },
    async submit() { submissions++; status = 'unknown'; throw new Error('synthetic timeout') },
  }
  const entry = { name: 'Example', authentication: 'none', adapter }
  await withAdapterHarness('example-benefit', entry, async ({ service, configId, store, root }) => {
    assert.equal((await service.run(configId)).status, 'unknown')
    await store.close()
    const reopened = await LocalStore.open(root, { async get() { return null }, async create() { throw new Error('credentials should not be created') } })
    try {
      const restarted = new EggService({ store: reopened, adapters: { 'example-benefit': entry } })
      assert.equal((await restarted.run(configId)).status, 'unknown')
      assert.equal(submissions, 1)
      status = 'owned'
      assert.equal((await restarted.run(configId)).status, 'success')
      assert.equal(submissions, 1)
      assert.equal((await restarted.history(configId)).length, 3)
    } finally { await reopened.close() }
  })
})
