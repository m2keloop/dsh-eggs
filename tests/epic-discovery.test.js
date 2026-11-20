import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discoverEpicFreeGames } from '../src/adapters/epic/discovery.js'

const now = Date.parse('2026-11-19T10:00:00Z')
const offer = (overrides = {}) => ({
  id: 'offer_1', namespace: 'ns_1', title: 'A game',
  productSlug: 'a-game', price: { totalPrice: { originalPrice: 2000, discountPrice: 0 } },
  items: [{ id: 'game_1' }, { id: 'game_1' }],
  promotions: { promotionalOffers: [{ promotionalOffers: [{ startDate: '2026-11-19T00:00:00Z', endDate: '2026-11-20T00:00:00Z' }] }] },
  ...overrides,
})

test('incomplete or malformed catalog item mappings are not used for ownership', async () => {
  const games = await discoverEpicFreeGames({ fetch: mockResponse([offer({ items: [{ id: 'game_1' }, { id: '../unsafe' }] }), offer({ id: 'missing-items', items: undefined })]), now })
  assert.deepEqual(games.map(game => game.catalogItemIds), [[], []])
})
const mockResponse = items => async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: { Catalog: { searchStore: { elements: items } } } }) })

test('discovers only currently free limited offers with safe product paths', async () => {
  const values = [offer(), offer({ id: 'not-free', price: { totalPrice: { originalPrice: 1000, discountPrice: 1 } } }), offer({ id: 'unsafe', productSlug: '../bad' }), offer({ id: 'future', promotions: { promotionalOffers: [{ promotionalOffers: [{ startDate: '2026-12-01T00:00:00Z', endDate: '2026-12-02T00:00:00Z' }] }] } })]
  const games = await discoverEpicFreeGames({ fetch: mockResponse(values), now })
  assert.equal(games.length, 1)
  assert.equal(games[0].id, 'offer_1')
  assert.equal(games[0].url, 'https://store.epicgames.com/en-US/p/a-game')
  assert.deepEqual(games[0].catalogItemIds, ['game_1'])
})

test('a malformed response or non-HTTPS country cannot silently report no offers', async () => {
  await assert.rejects(discoverEpicFreeGames({ fetch: async () => ({ ok: true, text: async () => '{}' }), now }))
  await assert.rejects(discoverEpicFreeGames({ fetch: mockResponse([]), now, country: '../' }))
})

test('uses the official IPv4 promotions endpoint without credentials', async () => {
  let request
  await discoverEpicFreeGames({ fetch: async (url, options) => { request = { url: new URL(url), options }; return (mockResponse([]))() }, now, country: 'CN' })
  assert.equal(request.url.origin, 'https://store-site-backend-static-ipv4.ak.epicgames.com')
  assert.equal(request.url.searchParams.get('country'), 'CN')
  assert.equal(request.options.method, 'GET')
  assert.equal(request.options.redirect, 'error')
  assert.equal(request.options.headers, undefined)
})
