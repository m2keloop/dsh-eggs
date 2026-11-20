import { createHash } from 'node:crypto'
import { resolvePersistedSettings } from '../adapters/settings.js'

async function waitForTurn(previous, signal) {
  if (!signal) return previous
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', aborted)
    const aborted = () => { cleanup(); reject(signal.reason) }
    signal.addEventListener('abort', aborted, { once: true })
    previous.then(() => { cleanup(); resolve() }, error => { cleanup(); reject(error) })
    if (signal.aborted) aborted()
  })
}

// This runtime requires a store with one exclusive writer and an adapter which verifies ownership.
export class ClaimRuntime {
  constructor({ store, adapter, authentication = 'session', settingFields = [] }) { this.store = store; this.adapter = adapter; this.authentication = authentication; this.settingFields = settingFields; this.locks = new Map() }

  async withEffect(key, operation, signal) {
    signal?.throwIfAborted()
    const previous = this.locks.get(key) ?? Promise.resolve()
    let release
    const gate = new Promise(resolve => { release = resolve })
    const queued = previous.then(() => gate)
    this.locks.set(key, queued)
    try { await waitForTurn(previous, signal); signal?.throwIfAborted(); return await operation() } finally {
      release()
      // A cancelled waiter may release its gate before the prior owner exits.
      // Keep the tail until the entire preceding chain has actually settled.
      void queued.then(() => { if (this.locks.get(key) === queued) this.locks.delete(key) })
    }
  }

  async run(configId, signal) {
    return this.withEffect(`config:${configId}`, () => this.execute(configId, signal), signal)
  }

  async execute(configId, signal) {
    signal?.throwIfAborted()
    const config = await this.store.getClaim(configId)
    const settings = resolvePersistedSettings(this.settingFields, config.settings)
    const credential = this.authentication === 'none' ? null : await this.store.getCredential(configId)
    const account = await this.adapter.authenticate(credential, { signal, settings })
    let authenticated = false
    try {
    if (!account?.subject || typeof account.subject !== 'string' || account.subject.length > 200 || (credential?.accountId && account.subject !== credential.accountId)) return { status: 'auth_required', count: 0 }
    authenticated = true
    const opportunities = await this.adapter.discover({ signal, account, settings })
    if (!Array.isArray(opportunities) || opportunities.length > 100) throw new Error('Invalid discovery result')
    let unknown = false, needsUser = false, successes = 0
    for (const opportunity of opportunities) {
      signal?.throwIfAborted()
      const expires = Date.parse(opportunity?.expiresAt)
      if (typeof opportunity?.namespace !== 'string' || !opportunity.namespace || opportunity.namespace.length > 200 || typeof opportunity?.id !== 'string' || !opportunity.id || opportunity.id.length > 200 || !Number.isFinite(expires)) { unknown = true; continue }
      if (opportunity.cycleKey !== undefined && (typeof opportunity.cycleKey !== 'string' || !opportunity.cycleKey || opportunity.cycleKey.length > 200)) { unknown = true; continue }
      if (expires <= Date.now()) continue
      // Legacy entries include the expiry. A declared stable cycle key allows
      // new adapters to keep the same effect when an expiry timestamp changes.
      const identity = opportunity.cycleKey === undefined
        ? [config.benefitId, account.subject, opportunity.namespace, opportunity.id, opportunity.expiresAt]
        : ['cycle-v1', config.benefitId, account.subject, opportunity.namespace, opportunity.id, opportunity.cycleKey]
      const key = createHash('sha256').update(JSON.stringify(identity)).digest('hex')
      const outcome = await this.withEffect(key, async () => {
        const prior = await this.store.getEffect(key)
        let before
        try { before = await this.adapter.verify(credential, opportunity, { signal, account, settings }) } catch { signal?.throwIfAborted(); return 'unknown' }
        if (before === 'owned') {
          await this.store.saveEffect(key, { version: 1, status: 'claimed' })
          return 'success'
        }
        // A cached success is not evidence of current ownership. Do not submit
        // it again if a later verification is unavailable or contradictory.
        if (prior?.status === 'claimed' || before !== 'not_owned') return 'unknown'
        signal?.throwIfAborted()
        // Verification may have taken long enough for the promotion to end.
        if (expires <= Date.now()) return 'unknown'
        await this.store.saveEffect(key, { version: 1, status: 'submitting' })
        let requiresAction = false
        try {
          signal?.throwIfAborted()
          await this.adapter.submit(credential, opportunity, { signal, account, settings })
          const after = await this.adapter.verify(credential, opportunity, { signal, account, settings })
          if (after === 'owned') {
            await this.store.saveEffect(key, { version: 1, status: 'claimed' })
            return 'success'
          }
        } catch (error) {
          // A request may have reached the server; do not retry without verification.
          requiresAction = error?.code === 'USER_ACTION_REQUIRED'
        }
        await this.store.saveEffect(key, { version: 1, status: 'unknown' })
        signal?.throwIfAborted()
        return requiresAction ? 'user_action_required' : 'unknown'
      }, signal)
      if (outcome === 'success') successes++
      else if (outcome === 'user_action_required') needsUser = true
      else unknown = true
    }
    return { status: unknown ? 'unknown' : needsUser ? 'user_action_required' : successes ? 'success' : 'no_offers', count: successes }
    } finally {
      try {
        if (authenticated && this.authentication !== 'none' && typeof account?.snapshot === 'function') {
          const snapshot = await account.snapshot()
          if (credential?.accountId && snapshot?.accountId !== credential.accountId) throw Object.assign(new Error('Session identity changed'), { code: 'AUTH_REQUIRED' })
          await this.store.saveCredential(configId, snapshot)
        }
      } finally {
        if (typeof account?.close === 'function') await account.close()
      }
    }
  }
}
