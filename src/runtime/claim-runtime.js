import { createHash } from 'node:crypto'

// This runtime requires a store with one exclusive writer and an adapter which verifies ownership.
export class ClaimRuntime {
  constructor({ store, adapter }) { this.store = store; this.adapter = adapter; this.locks = new Map() }

  async withEffect(key, operation) {
    const previous = this.locks.get(key) ?? Promise.resolve()
    let release
    const gate = new Promise(resolve => { release = resolve })
    const queued = previous.then(() => gate)
    this.locks.set(key, queued)
    await previous
    try { return await operation() } finally {
      release()
      if (this.locks.get(key) === queued) this.locks.delete(key)
    }
  }

  async run(configId, signal) {
    return this.withEffect(`config:${configId}`, () => this.execute(configId, signal))
  }

  async execute(configId, signal) {
    signal?.throwIfAborted()
    const config = await this.store.getClaim(configId)
    const credential = await this.store.getCredential(configId)
    const account = await this.adapter.authenticate(credential, { signal })
    if (!account?.subject || typeof account.subject !== 'string') return { status: 'auth_required', count: 0 }
    try {
    const opportunities = await this.adapter.discover({ signal, account })
    if (!Array.isArray(opportunities)) throw new Error('Invalid discovery result')
    let unknown = false, needsUser = false, successes = 0
    for (const opportunity of opportunities) {
      signal?.throwIfAborted()
      const expires = Date.parse(opportunity?.expiresAt)
      if (!opportunity?.namespace || !opportunity.id || !Number.isFinite(expires) || expires <= Date.now()) continue
      const key = createHash('sha256').update(JSON.stringify([config.benefitId, account.subject, opportunity.namespace, opportunity.id, opportunity.expiresAt])).digest('hex')
      const outcome = await this.withEffect(key, async () => {
        const prior = await this.store.getEffect(key)
        let before
        try { before = await this.adapter.verify(credential, opportunity, { signal, account }) } catch { signal?.throwIfAborted(); return 'unknown' }
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
          await this.adapter.submit(credential, opportunity, { signal, account })
          const after = await this.adapter.verify(credential, opportunity, { signal, account })
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
      })
      if (outcome === 'success') successes++
      else if (outcome === 'user_action_required') needsUser = true
      else unknown = true
    }
    return { status: unknown ? 'unknown' : needsUser ? 'user_action_required' : successes ? 'success' : 'no_offers', count: successes }
    } finally {
      try {
        if (typeof account.snapshot === 'function') await this.store.saveCredential(configId, await account.snapshot())
      } finally {
        if (typeof account.close === 'function') await account.close()
      }
    }
  }
}
