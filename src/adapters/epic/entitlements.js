const SAFE_ID = /^[a-zA-Z0-9_-]{1,120}$/
const ENTITLEMENT_ORIGIN = 'https://entitlement-public-service-prod08.ol.epicgames.com'

// A positive result requires an active entitlement for every catalog item in
// the offer. Absence is deliberately unknown until endpoint scope, pagination,
// freshness and the offer-to-item mapping are verified for a real account.
export function verifyEpicEntitlements(offer, entitlements) {
  if (!SAFE_ID.test(offer?.namespace ?? '') || !Array.isArray(offer?.catalogItemIds) || offer.catalogItemIds.length === 0 || !Array.isArray(entitlements)) return 'unknown'
  if (!offer.catalogItemIds.every(id => typeof id === 'string' && SAFE_ID.test(id))) return 'unknown'
  const active = new Set(entitlements.filter(item => item?.namespace === offer.namespace && item?.status === 'ACTIVE' && typeof item?.catalogItemId === 'string').map(item => item.catalogItemId))
  return offer.catalogItemIds.every(id => active.has(id)) ? 'owned' : 'unknown'
}

// Experimental read-only launcher entitlement query. It never returns the
// response body or credential to its caller; absence is not proof of absence.
// A launcher-authorized session and live endpoint semantics remain unverified.
export async function checkEpicEntitlement({ accountId, accessToken, offer, fetch = globalThis.fetch, signal }) {
  if (typeof accountId !== 'string' || !SAFE_ID.test(accountId) || typeof accessToken !== 'string' || accessToken.length < 1 || accessToken.length > 8192 || /[\r\n]/.test(accessToken)) throw new Error('Invalid local session')
  if (typeof offer?.namespace !== 'string' || !SAFE_ID.test(offer.namespace) || !Array.isArray(offer?.catalogItemIds) || !offer.catalogItemIds.length || offer.catalogItemIds.length > 100 || !offer.catalogItemIds.every(id => typeof id === 'string' && SAFE_ID.test(id))) return 'unknown'
  const expected = new Set(offer.catalogItemIds), found = new Set()
  for (let page = 0; page < 100; page++) {
    signal?.throwIfAborted()
    const url = new URL(`/entitlement/api/account/${accountId}/entitlements`, ENTITLEMENT_ORIGIN)
    url.search = new URLSearchParams({ start: String(page * 1000), count: '1000' }).toString()
    let response
    try { response = await fetch(url, { method: 'GET', headers: { authorization: `Bearer ${accessToken}` }, redirect: 'error', signal }) } catch { signal?.throwIfAborted(); throw new Error('Epic entitlement request failed') }
    if (!response.ok) throw new Error('Epic entitlement request failed')
    let rows
    try {
      const body = await response.text()
      if (body.length > 5_000_000) throw new Error('Response too large')
      rows = JSON.parse(body)
    } catch { throw new Error('Invalid entitlement response') }
    if (!Array.isArray(rows) || rows.length > 1000) throw new Error('Invalid entitlement response')
    for (const row of rows) if (row?.namespace === offer.namespace && row?.status === 'ACTIVE' && expected.has(row?.catalogItemId)) found.add(row.catalogItemId)
    if (found.size === expected.size) return 'owned'
    if (rows.length < 1000) return 'unknown'
  }
  return 'unknown'
}
