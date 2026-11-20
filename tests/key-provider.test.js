import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KeyringKeyProvider } from '../src/local/key-provider.js'

test('keys are namespaced by instance and existing keys are never overwritten', async () => {
  const map = new Map()
  class Entry {
    constructor(service, account, options) { this.id = `${service}/${account}`; this.options = options }
    getPassword() { return map.get(this.id) ?? null }
    setPassword(value) { map.set(this.id, value) }
  }
  const provider = new KeyringKeyProvider(Entry)
  assert.equal(await provider.get('instance_1'), null)
  const key = await provider.create('instance_1')
  assert.equal(key.length, 32)
  assert.deepEqual(await provider.get('instance_1'), key)
  assert.deepEqual(await provider.create('instance_1'), key)
  assert.notDeepEqual(await provider.create('instance_2'), key)
  assert.throws(() => provider.entry('../bad'))
})

test('malformed stored key fails closed rather than being replaced', async () => {
  let writes = 0
  class Entry { getPassword() { return 'not-a-valid-key' } setPassword() { writes++ } }
  const provider = new KeyringKeyProvider(Entry)
  await assert.rejects(provider.create('instance_1'), { code: 'KEY_UNAVAILABLE' })
  assert.equal(writes, 0)
})
