import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open, readEnvelope, seal, writeEnvelope } from '../src/p0/vault.js'

// A disposable keychain and randomly generated test values only; never touches the login keychain.
test('synthetic key can be recovered from a disposable macOS keychain', { skip: process.platform !== 'darwin' || process.env.DSH_EGGS_P0_KEYCHAIN !== '1', timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-eggs-keychain-'))
  const path = join(root, 'p0.keychain-db')
  const password = randomBytes(24).toString('hex')
  const key = randomBytes(32)
  const service = 'dsh-eggs-p0-disposable'
  const run = args => {
    try { return execFileSync('/usr/bin/security', args, { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch { throw new Error('macOS disposable keychain operation failed') }
  }
  try {
    run(['create-keychain', '-p', password, path])
    run(['unlock-keychain', '-p', password, path])
    run(['add-generic-password', '-a', 'p0', '-s', service, '-w', key.toString('base64'), '-T', '/usr/bin/security', path])
    const stored = Buffer.from(run(['find-generic-password', '-a', 'p0', '-s', service, '-w', path]).trim(), 'base64')
    assert.equal(stored.equals(key), true)
    const binding = { instanceId: 'instance_p0', claimConfigId: 'claim_p0' }
    const file = join(root, 'credentials.enc')
    await writeEnvelope(file, seal({ token: 'synthetic' }, key, binding))
    assert.deepEqual(open(await readEnvelope(file), stored, binding), { token: 'synthetic' })
  } finally {
    try { run(['delete-keychain', path]) } catch { /* The file may not have been created. */ }
    await rm(root, { recursive: true, force: true })
  }
})
