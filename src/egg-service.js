import { randomUUID } from 'node:crypto'
import { ClaimRuntime } from './runtime/claim-runtime.js'
import { validateOfferUrl } from './adapters/epic/browser.js'
import { validateAdapterEntry } from './adapters/contract.js'
import { resolveSettings, resolvePersistedSettings } from './adapters/settings.js'

export class EggService {
  constructor({ store, adapter, adapters }) {
    this.store = store
    const entries = adapters ?? { 'epic-free-games': { name: 'Epic 免费游戏', adapter } }
    this.adapters = Object.fromEntries(Object.entries(entries).map(([id, entry]) => [id, validateAdapterEntry(id, entry)]))
    this.runtimes = new Map(Object.entries(this.adapters).map(([id, entry]) => {
      const authentication = entry.authentication ?? 'session'
      return [id, new ClaimRuntime({ store, adapter: entry.adapter, authentication, settingFields: entry.settings })]
    }))
  }

  listBenefits() { return Object.entries(this.adapters).map(([id, entry]) => ({ id, name: entry.name, ...(entry.settings.length ? { settings: entry.settings } : {}) })) }

  async listPublicOffers(country) {
    if (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)) throw new Error('Invalid country')
    const adapter = this.adapters['epic-free-games']?.adapter
    if (typeof adapter?.discoverPublic !== 'function') throw new Error('Public discovery unavailable')
    const offers = await adapter.discoverPublic(country)
    if (!Array.isArray(offers)) throw new Error('Invalid public offers')
    return offers.filter(offer => offer && typeof offer.title === 'string' && validateOfferUrl(offer.url) && Number.isFinite(Date.parse(offer.expiresAt)))
      .slice(0, 50).map(({ title, url, expiresAt }) => ({ title: title.slice(0, 200), url, expiresAt }))
  }

  async list() {
    return Promise.all((await this.store.listClaims()).map(async claim => {
      const entry = Object.hasOwn(this.adapters, claim.benefitId) ? this.adapters[claim.benefitId] : undefined
      let settings, settingsInvalid = false
      if (entry) {
        const config = await this.store.getClaim(claim.id)
        try { const values = resolvePersistedSettings(entry.settings, config.settings); if (entry.settings.length) settings = values }
        catch (error) { if (error?.code !== 'SETTINGS_REQUIRED') throw error; settings = resolveSettings(entry.settings); settingsInvalid = true }
      }
      return { ...claim, ...(entry?.authentication === 'none' ? { connected: true, authentication: 'none' } : {}), ...(settings ? { settings } : {}), ...(settingsInvalid ? { settingsInvalid: true } : {}) }
    }))
  }

  async history(id) { return this.store.getRunHistory(id) }

  async updateSettings(id, settings) {
    const config = await this.store.getClaim(id)
    const entry = this.adapters[config.benefitId], runtime = this.runtimes.get(config.benefitId)
    if (!entry || !runtime) throw new Error('Settings unavailable')
    if (!settings || entry.settings.some(field => !Object.hasOwn(settings, field.key))) throw new Error('Incomplete settings')
    const values = resolveSettings(entry.settings, settings)
    return runtime.withEffect(`config:${id}`, async () => {
      await this.store.getClaim(id)
      await this.store.updateSettings(id, values)
      return { status: 'updated' }
    })
  }

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

  async create(benefitId = 'epic-free-games', settings = {}) {
    if (!Object.hasOwn(this.adapters, benefitId)) throw new Error('Unknown benefit')
    const id = `claim_${randomUUID().replaceAll('-', '')}`
    const values = resolveSettings(this.adapters[benefitId].settings, settings)
    await this.store.createClaim({ id, benefitId, label: this.adapters[benefitId].name, ...(Object.keys(values).length ? { settings: values } : {}) })
    return { claim_config_id: id }
  }

  async connect(id, signal) {
    try {
      signal?.throwIfAborted()
      const config = await this.store.getClaim(id)
      const runtime = this.runtimes.get(config.benefitId)
      if (!runtime) return { status: 'failed', code: 'INVALID_CONFIG' }
      return await runtime.withEffect(`config:${id}`, () => this.connectLocked(id, signal), signal)
    } catch (error) { if (signal?.aborted) signal.throwIfAborted(); return { status: 'failed', code: 'CONNECT_FAILED' } }
  }

  async connectLocked(id, signal) {
    try {
      signal?.throwIfAborted()
      const config = await this.store.getClaim(id)
      const adapter = this.adapters[config.benefitId]?.adapter
      if (!adapter) return { status: 'failed', code: 'INVALID_CONFIG' }
      if (this.runtimes.get(config.benefitId)?.authentication === 'none') return { status: 'ready' }
      let prior
      try { prior = await this.store.getCredential(id) } catch (error) { if (error?.code !== 'ENOENT') throw error }
      const settings = resolvePersistedSettings(this.adapters[config.benefitId].settings, config.settings)
      const credential = await adapter.connect({ signal, settings })
      signal?.throwIfAborted()
      if (!credential || typeof credential.accountId !== 'string' || !credential.accountId || credential.accountId.length > 120) return { status: 'failed', code: 'INVALID_CREDENTIAL' }
      if (prior && prior.accountId !== credential.accountId) return { status: 'failed', code: 'ACCOUNT_MISMATCH' }
      await this.store.saveCredential(id, credential)
      return { status: 'ready' }
    } catch (error) {
      if (signal?.aborted) signal.throwIfAborted()
      if (error?.code === 'KEY_UNAVAILABLE') return { status: 'failed', code: 'KEY_UNAVAILABLE' }
      if (error?.code === 'AUTH_REQUIRED') return { status: 'failed', code: 'AUTH_REQUIRED' }
      if (error?.code === 'ACCESS_BLOCKED') return { status: 'failed', code: 'ACCESS_BLOCKED' }
      if (error?.code === 'CHALLENGE_REQUIRED') return { status: 'failed', code: 'CHALLENGE_REQUIRED' }
      if (error?.code === 'SETTINGS_REQUIRED') return { status: 'failed', code: 'SETTINGS_REQUIRED' }
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
      if (error?.code === 'AUTH_REQUIRED' || error?.code === 'ENOENT') result = { status: 'auth_required', count: 0 }
      else if (error?.code === 'ACCESS_BLOCKED') result = { status: 'access_blocked', count: 0 }
      else if (error?.code === 'KEY_UNAVAILABLE') result = { status: 'key_unavailable', count: 0 }
      else if (error?.code === 'SETTINGS_REQUIRED') result = { status: 'settings_required', count: 0 }
      else result = { status: 'failed', count: 0 }
    }
    try { await this.store.saveRun(id, result) } catch { /* Do not hide the verified claim outcome. */ }
    return result
  }
}
