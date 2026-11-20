import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, rename, rm, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { acquireWriterLease } from './writer-lease.js'
import { open as decrypt, seal, readEnvelope, writeEnvelope } from './vault.js'

const ID = /^[a-zA-Z0-9_-]{1,80}$/
const RUN_STATUS = new Set(['success', 'unknown', 'user_action_required', 'no_offers', 'auth_required', 'access_blocked', 'key_unavailable', 'settings_required', 'failed'])
const validRun = record => record && Object.keys(record).sort().join(',') === 'count,finishedAt,status,version' && record.version === 1 && RUN_STATUS.has(record.status) && Number.isSafeInteger(record.count) && record.count >= 0 && typeof record.finishedAt === 'string' && Number.isFinite(Date.parse(record.finishedAt))
const unavailable = () => Object.assign(new Error('Credential key unavailable'), { code: 'KEY_UNAVAILABLE' })
const validId = id => { if (typeof id !== 'string' || !ID.test(id)) throw new Error('Invalid identifier'); return id }
const missing = error => { if (error.code === 'ENOENT') return null; throw error }
const validSettings = settings => settings && typeof settings === 'object' && !Array.isArray(settings) && Object.keys(settings).length <= 8 && Object.entries(settings).every(([key, value]) => /^[a-z][a-z0-9_]{0,31}$/.test(key) && typeof value === 'string' && /^[A-Za-z0-9_-]{1,50}$/.test(value))

async function ensureDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid data directory')
}

async function readJson(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { return JSON.parse(await file.readFile('utf8')) } finally { await file.close() }
}

async function writeJson(path, data) {
  const temp = join(dirname(path), `.${randomUUID()}.tmp`)
  let file
  try {
    file = await open(temp, 'wx', 0o600)
    await file.writeFile(JSON.stringify(data))
    await file.sync()
    await file.close(); file = undefined
    await rename(temp, path)
    const directory = await open(dirname(path), 'r')
    try { await directory.sync() } finally { await directory.close() }
  } finally {
    if (file) await file.close()
    await unlink(temp).catch(missing)
  }
}

export class LocalStore {
  static async open(root, keys) {
    if (!keys || typeof keys.get !== 'function' || typeof keys.create !== 'function') throw new Error('Key provider required')
    await ensureDirectory(root)
    const locks = join(root, 'locks')
    await ensureDirectory(locks)
    const lease = await acquireWriterLease(join(locks, 'writer.lock'))
    try {
      await ensureDirectory(join(root, 'claims'))
      await ensureDirectory(join(root, 'ledger'))
      const path = join(root, 'instance.json')
      let instance = await readJson(path).catch(missing)
      if (instance === null) {
        instance = { version: 1, instanceId: `instance_${randomUUID().replaceAll('-', '')}` }
        await writeJson(path, instance)
      }
      if (instance.version !== 1 || typeof instance.instanceId !== 'string' || !ID.test(instance.instanceId)) throw new Error('Invalid data instance')
      return new LocalStore(root, keys, lease, instance.instanceId)
    } catch (error) { await lease.release(); throw error }
  }

  constructor(root, keys, lease, instanceId) {
    this.root = root; this.keys = keys; this.lease = lease; this.instanceId = instanceId
    this.queue = Promise.resolve(); this.closed = false
  }

  async serial(fn) {
    if (this.closed) throw new Error('Store is closed')
    const task = this.queue.then(fn)
    this.queue = task.catch(() => {})
    return task
  }

  claimPath(id) { return join(this.root, 'claims', validId(id)) }

  async createClaim(config) {
    return this.serial(async () => {
      if (!config || !['benefitId,id,label', 'benefitId,id,label,settings'].includes(Object.keys(config).sort().join(','))) throw new Error('Invalid configuration')
      validId(config.id); validId(config.benefitId)
      if (typeof config.label !== 'string' || config.label.length > 100) throw new Error('Invalid configuration')
      if (config.settings !== undefined && !validSettings(config.settings)) throw new Error('Invalid settings')
      const path = this.claimPath(config.id)
      await mkdir(path, { mode: 0o700 })
      await writeJson(join(path, 'config.json'), { version: 1, ...config })
    })
  }

  async getClaim(id) {
    return this.serial(async () => {
      const path = this.claimPath(id)
      const info = await lstat(path)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid claim directory')
      const config = await readJson(join(path, 'config.json'))
      if (config.version !== 1 || config.id !== id || !ID.test(config.benefitId) || typeof config.label !== 'string') throw new Error('Invalid configuration')
      return config
    })
  }

  async updateSettings(id, settings) {
    return this.serial(async () => {
      if (!validSettings(settings)) throw new Error('Invalid settings')
      const path = this.claimPath(id)
      const info = await lstat(path)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid claim directory')
      const config = await readJson(join(path, 'config.json'))
      if (config.version !== 1 || config.id !== id || !ID.test(config.benefitId) || typeof config.label !== 'string') throw new Error('Invalid configuration')
      await writeJson(join(path, 'config.json'), { version: 1, id, benefitId: config.benefitId, label: config.label, settings })
    })
  }

  async listClaims() {
    const entries = await readdir(join(this.root, 'claims'), { withFileTypes: true })
    const result = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !ID.test(entry.name)) continue
      const config = await this.getClaim(entry.name)
      const credential = await lstat(join(this.claimPath(entry.name), 'credentials.enc')).catch(missing)
      if (credential && (!credential.isFile() || credential.isSymbolicLink())) throw new Error('Invalid credential file')
      const lastRun = await readJson(join(this.claimPath(entry.name), 'last-run.json')).catch(missing)
      if (lastRun && !validRun(lastRun)) throw new Error('Invalid run record')
      result.push({ id: config.id, benefitId: config.benefitId, label: config.label, connected: Boolean(credential), ...(lastRun ? { lastRun: { status: lastRun.status, count: lastRun.count, finishedAt: lastRun.finishedAt } } : {}) })
    }
    return result.sort((a, b) => a.id.localeCompare(b.id))
  }

  async saveRun(id, result) {
    return this.serial(async () => {
      if (!result || !RUN_STATUS.has(result.status) || !Number.isSafeInteger(result.count) || result.count < 0) throw new Error('Invalid run result')
      const path = this.claimPath(id)
      const info = await lstat(path)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid claim directory')
      const config = await readJson(join(path, 'config.json'))
      if (config.version !== 1 || config.id !== id) throw new Error('Invalid configuration')
      const record = { version: 1, status: result.status, count: result.count, finishedAt: new Date().toISOString() }
      const historyPath = join(path, 'run-history.json')
      let history = await readJson(historyPath).catch(missing)
      if (history === null) {
        const last = await readJson(join(path, 'last-run.json')).catch(missing)
        if (last && !validRun(last)) throw new Error('Invalid run record')
        history = { version: 1, runs: last ? [last] : [] }
      }
      if (history.version !== 1 || !Array.isArray(history.runs) || history.runs.length > 50 || !history.runs.every(validRun)) throw new Error('Invalid run history')
      await writeJson(historyPath, { version: 1, runs: [record, ...history.runs].slice(0, 50) })
      await writeJson(join(path, 'last-run.json'), record)
    })
  }

  async getRunHistory(id) {
    return this.serial(async () => {
      const path = this.claimPath(id)
      const info = await lstat(path)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid claim directory')
      const config = await readJson(join(path, 'config.json'))
      if (config.version !== 1 || config.id !== id) throw new Error('Invalid configuration')
      const history = await readJson(join(path, 'run-history.json')).catch(missing)
      if (history === null) {
        const last = await readJson(join(path, 'last-run.json')).catch(missing)
        if (last && !validRun(last)) throw new Error('Invalid run record')
        return last ? [{ status: last.status, count: last.count, finishedAt: last.finishedAt }] : []
      }
      if (history.version !== 1 || !Array.isArray(history.runs) || history.runs.length > 50 || !history.runs.every(validRun)) throw new Error('Invalid run history')
      return history.runs.map(({ status, count, finishedAt }) => ({ status, count, finishedAt }))
    })
  }

  async deleteClaim(id) {
    return this.serial(async () => {
      const path = this.claimPath(id)
      const info = await lstat(path)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid claim directory')
      const config = await readJson(join(path, 'config.json'))
      if (config.version !== 1 || config.id !== id) throw new Error('Invalid configuration')
      await rm(path, { recursive: true })
      const directory = await open(join(this.root, 'claims'), 'r')
      try { await directory.sync() } finally { await directory.close() }
    })
  }

  async saveCredential(id, credential) {
    return this.serial(async () => {
      const path = this.claimPath(id)
      const info = await lstat(path)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid claim directory')
      const config = await readJson(join(path, 'config.json'))
      if (config.version !== 1 || config.id !== id) throw new Error('Invalid configuration')
      const file = join(path, 'credentials.enc')
      const exists = await lstat(file).catch(missing)
      if (exists && (!exists.isFile() || exists.isSymbolicLink())) throw new Error('Invalid credential file')
      let key = await this.keys.get(this.instanceId)
      // One key protects every claim in this instance. Never create a new key
      // while any encrypted credential exists, including under another claim.
      if (!key) {
        const claims = await readdir(join(this.root, 'claims'), { withFileTypes: true })
        for (const claim of claims) {
          if (!claim.isDirectory()) throw unavailable()
          if (await lstat(join(this.root, 'claims', claim.name, 'credentials.enc')).catch(missing)) throw unavailable()
        }
      }
      if (!key) key = await this.keys.create(this.instanceId)
      if (!Buffer.isBuffer(key) || key.length !== 32) throw unavailable()
      await writeEnvelope(file, seal(credential, key, { instanceId: this.instanceId, claimConfigId: id }))
    })
  }

  async getCredential(id) {
    return this.serial(async () => {
      const path = this.claimPath(id)
      const info = await lstat(path)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid claim directory')
      const config = await readJson(join(path, 'config.json'))
      if (config.version !== 1 || config.id !== id) throw new Error('Invalid configuration')
      const file = join(path, 'credentials.enc')
      const stat = await lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid credential file')
      const key = await this.keys.get(this.instanceId)
      if (!Buffer.isBuffer(key) || key.length !== 32) throw unavailable()
      return decrypt(await readEnvelope(file), key, { instanceId: this.instanceId, claimConfigId: id })
    })
  }

  async getEffect(key) {
    return this.serial(async () => {
      if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid effect ID')
      const record = await readJson(join(this.root, 'ledger', `${key}.json`)).catch(missing)
      if (record !== null && (record.version !== 1 || !['submitting', 'claimed', 'unknown'].includes(record.status))) throw new Error('Invalid effect record')
      return record
    })
  }

  async saveEffect(key, record) {
    return this.serial(async () => {
      if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid effect ID')
      if (!record || Object.keys(record).sort().join(',') !== 'status,version' || record.version !== 1 || !['submitting', 'claimed', 'unknown'].includes(record.status)) throw new Error('Invalid effect record')
      await writeJson(join(this.root, 'ledger', `${key}.json`), record)
    })
  }

  async close() {
    if (this.closed) return
    this.closed = true
    await this.queue
    await this.lease.release()
  }
}
