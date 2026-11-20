const API = 'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions'
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/i
const SAFE_ID = /^[a-zA-Z0-9_-]{1,120}$/

// Discovery is read-only. A zero discovery price is not approval to submit an order.
export async function discoverEpicFreeGames({ fetch = globalThis.fetch, country = 'US', now = Date.now(), signal } = {}) {
  if (!/^[A-Z]{2}$/.test(country) || !Number.isFinite(now)) throw new Error('Invalid discovery options')
  const url = new URL(API)
  url.search = new URLSearchParams({ locale: 'en-US', country, allowCountries: country }).toString()
  const response = await fetch(url, { method: 'GET', redirect: 'error', signal })
  if (!response.ok) throw new Error('Epic discovery unavailable')
  const text = await response.text()
  if (text.length > 5_000_000) throw new Error('Epic discovery response too large')
  let elements
  try { elements = JSON.parse(text)?.data?.Catalog?.searchStore?.elements } catch { throw new Error('Invalid Epic discovery response') }
  if (!Array.isArray(elements)) throw new Error('Invalid Epic discovery response')
  return elements.flatMap(item => {
    if (!SAFE_ID.test(item?.id ?? '') || !SAFE_ID.test(item?.namespace ?? '')) return []
    if (item?.price?.totalPrice?.discountPrice !== 0) return []
    const periods = item?.promotions?.promotionalOffers?.flatMap(group => group?.promotionalOffers ?? []) ?? []
    const active = periods.find(period => {
      const start = Date.parse(period?.startDate), end = Date.parse(period?.endDate)
      return Number.isFinite(start) && Number.isFinite(end) && start <= now && now < end
    })
    if (!active) return []
    const candidates = [...(item?.catalogNs?.mappings ?? []).map(mapping => mapping?.pageSlug), item.productSlug, item.urlSlug]
    const slug = candidates.find(value => typeof value === 'string' && SAFE_SLUG.test(value))
    if (!slug) return []
    // The offer ID is not an entitlement item ID. Retain only valid catalog
    // item IDs for later ownership verification; an absent list is unknown.
    const catalogItemIds = Array.isArray(item.items) && item.items.every(entry => typeof entry?.id === 'string' && SAFE_ID.test(entry.id))
      ? [...new Set(item.items.map(entry => entry.id))]
      : []
    return [{ id: item.id, namespace: item.namespace, catalogItemIds, title: typeof item.title === 'string' ? item.title.slice(0, 200) : '', url: `https://store.epicgames.com/en-US/p/${slug}`, expiresAt: new Date(active.endDate).toISOString() }]
  })
}
