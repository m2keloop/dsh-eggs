import { discoverEpicFreeGames } from './discovery.js'
import { captureEpicSession, openEpicSession } from './browser.js'

export class EpicAdapter {
  async discoverPublic(country) { return discoverEpicFreeGames({ country }) }
  async connect({ signal } = {}) { return captureEpicSession({ signal }) }
  async authenticate(credential) { return openEpicSession(credential) }
  async discover({ signal, account } = {}) {
    if (!account?.country) throw new Error('Epic account country is unavailable')
    return discoverEpicFreeGames({ signal, country: account.country })
  }
  async verify(_credential, opportunity, { account }) { return account.verify(opportunity) }
  async submit(_credential, opportunity, { account }) { return account.submit(opportunity) }
}
