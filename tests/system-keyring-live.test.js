import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalStore } from '../src/local/store.js'
import { systemKeyProvider } from '../src/local/key-provider.js'

// Optional test: only a new random keychain item and synthetic credentials.
test('production keyring provider persists and restores a local synthetic session', { skip: process.platform !== 'darwin' || process.env.DSH_EGGS_TEST_SYSTEM_KEYRING !== '1', timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-eggs-keyring-integration-'))
  const provider = await systemKeyProvider()
  let store, instanceId
  try {
    store = await LocalStore.open(root, provider)
    instanceId = store.instanceId
    await store.createClaim({ id: 'claim_test', benefitId: 'example', label: 'Synthetic' })
    await store.saveCredential('claim_test', { accountId: 'synthetic-account', token: 'synthetic-token-for-test' })
    assert.equal((await readFile(join(root, 'claims', 'claim_test', 'credentials.enc'), 'utf8')).includes('synthetic-token-for-test'), false)
    await store.close(); store = undefined
    store = await LocalStore.open(root, provider)
    assert.deepEqual(await store.getCredential('claim_test'), { accountId: 'synthetic-account', token: 'synthetic-token-for-test' })
  } finally {
    if (store) await store.close()
    if (instanceId) await provider.entry(instanceId).deletePassword()
    await rm(root, { recursive: true, force: true })
  }
})
