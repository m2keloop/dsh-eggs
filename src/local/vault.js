import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { open as openFile, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// The caller obtains the key from the OS credential store and holds the writer lease.
function aad(binding) {
  if (!/^[a-zA-Z0-9_-]+$/.test(binding.instanceId) || !/^[a-zA-Z0-9_-]+$/.test(binding.claimConfigId)) throw new Error('Invalid binding')
  return Buffer.from(JSON.stringify(['dsh-eggs-p0', 1, binding.instanceId, binding.claimConfigId]))
}

function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm') throw new Error('Invalid envelope')
  if (Object.keys(envelope).sort().join(',') !== 'algorithm,ciphertext,nonce,tag,version') throw new Error('Invalid envelope')
  for (const field of ['nonce', 'tag', 'ciphertext']) {
    if (typeof envelope[field] !== 'string' || Buffer.from(envelope[field], 'base64').toString('base64') !== envelope[field]) throw new Error('Invalid envelope')
  }
  if (Buffer.from(envelope.nonce, 'base64').length !== 12 || Buffer.from(envelope.tag, 'base64').length !== 16 || Buffer.from(envelope.ciphertext, 'base64').length === 0) throw new Error('Invalid envelope')
}

export function seal(value, key, binding) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Invalid key')
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(aad(binding))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return { version: 1, algorithm: 'aes-256-gcm', nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }
}

export function open(envelope, key, binding) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Invalid key')
  validateEnvelope(envelope)
  const nonce = Buffer.from(envelope.nonce, 'base64')
  const tag = Buffer.from(envelope.tag, 'base64')
  if (nonce.length !== 12 || tag.length !== 16) throw new Error('Invalid envelope')
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAAD(aad(binding))
  decipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'))
}

export async function writeEnvelope(file, envelope) {
  validateEnvelope(envelope)
  const temp = join(dirname(file), `.credentials-${randomUUID()}.tmp`)
  let handle
  try {
    handle = await openFile(temp, 'wx', 0o600)
    await handle.writeFile(JSON.stringify(envelope))
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temp, file)
    const directory = await openFile(dirname(file), 'r')
    try { await directory.sync() } finally { await directory.close() }
  } finally {
    if (handle) await handle.close()
    await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
}

export async function readEnvelope(file) {
  const handle = await openFile(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  let text
  try { text = await handle.readFile('utf8') } finally { await handle.close() }
  const envelope = JSON.parse(text)
  validateEnvelope(envelope)
  return envelope
}
