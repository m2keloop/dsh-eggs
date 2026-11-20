import { randomUUID } from 'node:crypto'
import { ClaimRuntime } from './runtime/claim-runtime.js'
import { validateOfferUrl } from './adapters/epic/browser.js'

export class EggService {
  constructor({ store, adapter, adapters }) {
    this.store = store
    this.adapters = adapters ?? { 'epic-free-games': { name: 'Epic 免费游戏', adapter } }
    this.runtimes = new Map(Object.entries(this.adapters).map(([id, entry]) => [id, new ClaimRuntime({ store, adapter: entry.adapter })]))
  }

  listBenefits() { return Object.entries(this.adapters).map(([id, entry]) => ({ id, name: entry.name })) }

  async listPublicOffers(country) {
    if (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)) throw new Error('Invalid country')
    const adapter = this.adapters['epic-free-games']?.adapter
    if (typeof adapter?.discoverPublic !== 'function') throw new Error('Public discovery unavailable')
    const offers = await adapter.discoverPublic(country)
    if (!Array.isArray(offers)) throw new Error('Invalid public offers')
    return offers.filter(offer => offer && typeof offer.title === 'string' && validateOfferUrl(offer.url) && Number.isFinite(Date.parse(offer.expiresAt)))
      .slice(0, 50).map(({ title, url, expiresAt }) => ({ title: title.slice(0, 200), url, expiresAt }))
  }

  async list() { return this.store.listClaims() }

  async remove(id) {
    try {
      const config = await this.store.getClaim(id)
      const runtime = this.runtimes.get(config.benefitId)
      if (!runtime) return { status: 'failed', code: 'INVALID_CONFIG' }
      return await runtime.withEffect(`config:${id}`, async () => {
        await this.store.deleteClaim(id)
        return { status: 'deleted' }
      })
    } catch { return { status: 'failed', code: 'DELETE_FAILED' } }
  }

  async create(benefitId = 'epic-free-games') {
    if (!Object.hasOwn(this.adapters, benefitId)) throw new Error('Unknown benefit')
    const id = `claim_${randomUUID().replaceAll('-', '')}`
    await this.store.createClaim({ id, benefitId, label: this.adapters[benefitId].name })
    return { claim_config_id: id }
  }

  async connect(id, signal) {
    try {
      signal?.throwIfAborted()
      const config = await this.store.getClaim(id)
      const runtime = this.runtimes.get(config.benefitId)
      if (!runtime) return { status: 'failed', code: 'INVALID_CONFIG' }
      return await runtime.withEffect(`config:${id}`, () => this.connectLocked(id, signal))
    } catch (error) { if (signal?.aborted) signal.throwIfAborted(); return { status: 'failed', code: 'CONNECT_FAILED' } }
  }

  async connectLocked(id, signal) {
    try {
      signal?.throwIfAborted()
      const config = await this.store.getClaim(id)
      const adapter = this.adapters[config.benefitId]?.adapter
      if (!adapter) return { status: 'failed', code: 'INVALID_CONFIG' }
      let prior
      try { prior = await this.store.getCredential(id) } catch (error) { if (error.code !== 'ENOENT') throw error }
      const credential = await adapter.connect({ signal })
      signal?.throwIfAborted()
      if (!credential || typeof credential.accountId !== 'string' || !credential.accountId || credential.accountId.length > 120) return { status: 'failed', code: 'INVALID_CREDENTIAL' }
      if (prior && prior.accountId !== credential.accountId) return { status: 'failed', code: 'ACCOUNT_MISMATCH' }
      await this.store.saveCredential(id, credential)
      return { status: 'ready' }
    } catch (error) {
      if (signal?.aborted) signal.throwIfAborted()
      if (error.code === 'KEY_UNAVAILABLE') return { status: 'failed', code: 'KEY_UNAVAILABLE' }
      if (error.code === 'AUTH_REQUIRED') return { status: 'failed', code: 'AUTH_REQUIRED' }
      if (error.code === 'ACCESS_BLOCKED') return { status: 'failed', code: 'ACCESS_BLOCKED' }
      if (error.code === 'CHALLENGE_REQUIRED') return { status: 'failed', code: 'CHALLENGE_REQUIRED' }
      return { status: 'failed', code: 'CONNECT_FAILED' }
    }
  }

  async run(id, signal) {
    let result
    try {
      const config = await this.store.getClaim(id)
      const runtime = this.runtimes.get(config.benefitId)
      if (!runtime) return { status: 'failed', count: 0 }
      result = await runtime.run(id, signal)
    } catch (error) {
      if (signal?.aborted) signal.throwIfAborted()
      if (error.code === 'AUTH_REQUIRED' || error.code === 'ENOENT') result = { status: 'auth_required', count: 0 }
      else if (error.code === 'ACCESS_BLOCKED') result = { status: 'access_blocked', count: 0 }
      else if (error.code === 'KEY_UNAVAILABLE') result = { status: 'key_unavailable', count: 0 }
      else result = { status: 'failed', count: 0 }
    }
    try { await this.store.saveRun(id, result) } catch { /* Do not hide the verified claim outcome. */ }
    return result
  }
}
