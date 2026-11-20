import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seal, open, writeEnvelope, readEnvelope } from '../src/p0/vault.js'

test('synthetic credential is encrypted at rest and recovers with the same key and binding', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-eggs-vault-'))
  try {
    const file = join(dir, 'credentials.enc')
    const key = randomBytes(32)
    const binding = { instanceId: 'instance_1', claimConfigId: 'claim_1' }
    const secret = 'synthetic-credential-for-p0-only'
    await writeEnvelope(file, seal({ token: secret }, key, binding))
    const bytes = await readFile(file, 'utf8')
    assert.equal(bytes.includes(secret), false)
    assert.deepEqual(open(await readEnvelope(file), key, binding), { token: secret })
    assert.notDeepEqual(seal({ token: secret }, key, binding), seal({ token: secret }, key, binding))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('wrong key, changed binding and modified ciphertext fail closed', () => {
  const key = randomBytes(32)
  const binding = { instanceId: 'instance_1', claimConfigId: 'claim_1' }
  const envelope = seal({ token: 'synthetic' }, key, binding)
  assert.throws(() => open(envelope, randomBytes(32), binding))
  assert.throws(() => open(envelope, key, { ...binding, claimConfigId: 'claim_2' }))
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64')
  ciphertext[0] ^= 1
  assert.throws(() => open({ ...envelope, ciphertext: ciphertext.toString('base64') }, key, binding))
  assert.throws(() => open({ ...envelope, version: 99 }, key, binding))
})

test('plain objects cannot be written as credential envelopes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-eggs-vault-'))
  try {
    const file = join(dir, 'credentials.enc')
    await assert.rejects(writeEnvelope(file, { token: 'synthetic-plaintext' }), /Invalid envelope/)
    await assert.rejects(readFile(file), { code: 'ENOENT' })
  } finally { await rm(dir, { recursive: true, force: true }) }
})
