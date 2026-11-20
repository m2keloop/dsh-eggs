import { randomBytes } from 'node:crypto'

const unavailable = () => Object.assign(new Error('System credential store unavailable'), { code: 'KEY_UNAVAILABLE' })
const INSTANCE_ID = /^[a-zA-Z0-9_-]{1,80}$/

// Callers must hold the instance writer lease before creating a key.
export class KeyringKeyProvider {
  constructor(Entry) { this.Entry = Entry }

  entry(instanceId) {
    if (typeof instanceId !== 'string' || !INSTANCE_ID.test(instanceId)) throw new Error('Invalid instance ID')
    return new this.Entry('dsh-eggs', instanceId, { linux: { store: 'secret-service' } })
  }

  async get(instanceId) {
    let encoded
    try { encoded = await this.entry(instanceId).getPassword() } catch { throw unavailable() }
    if (encoded == null) return null
    if (typeof encoded !== 'string') throw unavailable()
    const key = Buffer.from(encoded, 'base64')
    if (key.length !== 32 || key.toString('base64') !== encoded) throw unavailable()
    return key
  }

  async create(instanceId) {
    const existing = await this.get(instanceId)
    if (existing) return existing
    const key = randomBytes(32)
    try { await this.entry(instanceId).setPassword(key.toString('base64')) } catch { throw unavailable() }
    const saved = await this.get(instanceId)
    if (!saved || !saved.equals(key)) throw unavailable()
    return key
  }
}

export async function systemKeyProvider() {
  try {
    const { AsyncEntry } = await import('@napi-rs/keyring')
    if (!AsyncEntry) throw new Error('Missing keyring entry')
    return new KeyringKeyProvider(AsyncEntry)
  } catch { throw unavailable() }
}
