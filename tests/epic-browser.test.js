import { test } from 'node:test'
import assert from 'node:assert/strict'
import { zeroTotal, validateOfferUrl, sameOfferUrl, openEpicSession, captureEpicSession } from '../src/adapters/epic/browser.js'

test('only an explicitly zero checkout total is accepted', () => {
  for (const value of ['$0.00', '0.00 USD', 'CN¥0.00', '0.00 CNY', 'Free']) assert.equal(zeroTotal(value), true)
  for (const value of ['$0.01', 'CN¥0.01', '0', '', 'Total: $0.00 and $9.99', 'Free trial', null]) assert.equal(zeroTotal(value), false)
})

test('offer URLs are restricted to the Epic product path', () => {
  assert.equal(validateOfferUrl('https://store.epicgames.com/en-US/p/example'), true)
  assert.equal(validateOfferUrl('https://store.epicgames.com/p/example'), true)
  assert.equal(validateOfferUrl('https://store.epicgames.com/p/example?lang=en-US'), true)
  for (const url of ['http://store.epicgames.com/en-US/p/example', 'https://store.epicgames.com.attacker.test/en-US/p/example', 'https://store.epicgames.com/en-US/p/../checkout', 'https://store.epicgames.com/en-US/p/example?token=x']) assert.equal(validateOfferUrl(url), false)
  assert.equal(sameOfferUrl('https://store.epicgames.com/en-US/p/example', 'https://store.epicgames.com/p/example'), true)
  assert.equal(sameOfferUrl('https://store.epicgames.com/en-US/p/example', 'https://store.epicgames.com/p/example?lang=en-US'), true)
  for (const url of ['https://store.epicgames.com/p/example?lang=en-US&lang=en-US', 'https://store.epicgames.com/p/example?lang=en-US&token=x', 'https://store.epicgames.com/p/example?lang=zh-CN']) assert.equal(validateOfferUrl(url), false)
  for (const url of ['https://store.epicgames.com/p/another', 'https://store.epicgames.com/p/Example', 'https://evil.test/p/example', 'https://store.epicgames.com/p/example?x=1']) assert.equal(sameOfferUrl('https://store.epicgames.com/en-US/p/example', url), false)
})

test('does not place an order when checkout is nonzero or cannot be verified', async () => {
  let orders = 0
  const frame = {
    url: () => 'https://payment.epicgames.com/checkout',
    getByTestId: () => ({ innerText: async () => '$9.99' }),
    locator: () => ({ count: async () => 0 }),
    getByRole: () => ({ click: async () => { orders++ } }),
  }
  const page = {
    url: () => 'https://store.epicgames.com/en-US/p/example',
    getByRole: () => ({ count: async () => 1, first: () => ({ innerText: async () => 'Get', isVisible: async () => true, isEnabled: async () => true, click: async () => {} }) }),
    locator: selector => selector === '[role="dialog"]'
      ? { getByRole: () => ({ isVisible: async () => false }) }
      : { count: async () => 1, first: () => ({ waitFor: async () => {}, elementHandle: async () => ({ contentFrame: async () => frame }) }) },
  }
  const chromium = { launch: async () => ({ newContext: async () => ({ cookies: async () => [], request: { get: async () => ({ status: () => 200, json: async () => ({ id: 'account_1' }) }) }, newPage: async () => page }), close: async () => {} }) }
  const session = await openEpicSession({ accountId: 'account_1', storageState: {} }, { chromium })
  await assert.rejects(session.submit({ url: page.url() }), { code: 'USER_ACTION_REQUIRED' })
  assert.equal(orders, 0)
  await session.close()
})

test('device warning requires user action without opening checkout', async () => {
  let checkoutRead = false
  const page = {
    url: () => 'https://store.epicgames.com/p/example',
    getByRole: () => ({ count: async () => 1, first: () => ({ innerText: async () => 'Get', isVisible: async () => true, isEnabled: async () => true, click: async () => {} }) }),
    locator: selector => selector === '[role="dialog"]'
      ? { getByRole: () => ({ isVisible: async () => true }) }
      : (checkoutRead = true, {}),
  }
  const chromium = { launch: async () => ({ newContext: async () => ({ cookies: async () => [], request: { get: async () => ({ status: () => 200, json: async () => ({ id: 'account_1' }) }) }, newPage: async () => page }), close: async () => {} }) }
  const session = await openEpicSession({ accountId: 'account_1', storageState: {} }, { chromium })
  await assert.rejects(session.submit({ url: 'https://store.epicgames.com/en-US/p/example' }), { code: 'USER_ACTION_REQUIRED' })
  assert.equal(checkoutRead, false)
  await session.close()
})

test('recognizes the live locale redirect and disabled In Library button', async () => {
  const page = {
    async goto() {},
    url: () => 'https://store.epicgames.com/p/example?lang=en-US',
    getByRole: () => ({ count: async () => 1, first: () => ({ waitFor: async () => {}, innerText: async () => 'In Library', isEnabled: async () => false }) }),
  }
  const chromium = { launch: async () => ({ newContext: async () => ({ cookies: async () => [], request: { get: async () => ({ status: () => 200, json: async () => ({ id: 'account_1' }) }) }, newPage: async () => page }), close: async () => {} }) }
  const session = await openEpicSession({ accountId: 'account_1', storageState: {} }, { chromium })
  assert.equal(await session.verify({ url: 'https://store.epicgames.com/en-US/p/example' }), 'owned')
  await session.close()
})

test('identity check carries the synthetic XSRF header only to the Epic account endpoint', async () => {
  let request
  const chromium = { launch: async () => ({
    async newContext() { return {
      cookies: async () => [{ name: 'XSRF-TOKEN', value: 'synthetic%2Btoken' }],
      request: { async get(url, options) { request = { url, options }; return { status: () => 200, json: async () => ({ id: 'account_1', country: 'US' }) } } },
      newPage: async () => ({}),
    } },
    async close() {},
  }) }
  const session = await openEpicSession({ accountId: 'account_1', storageState: {} }, { chromium })
  assert.equal(request.url, 'https://www.epicgames.com/id/api/account')
  assert.equal(request.options.headers['x-xsrf-token'], 'synthetic+token')
  await session.close()
})

test('login completes only after the account endpoint confirms identity', async () => {
  let checks = 0, closed = false
  const page = { async goto() {}, isClosed: () => false, async waitForTimeout() {}, locator: () => ({ count: async () => 0 }) }
  const chromium = { launch: async () => ({
    async newContext() { return {
      cookies: async () => [],
      request: { async get() { checks++; return { status: () => checks === 1 ? 401 : 200, json: async () => ({ id: 'account_1' }) } } },
      newPage: async () => page,
      storageState: async () => ({ cookies: [{ value: 'synthetic' }] }),
    } },
    async close() { closed = true },
  }) }
  assert.deepEqual(await captureEpicSession({ chromium, timeout: 1000 }), { accountId: 'account_1', storageState: { cookies: [{ value: 'synthetic' }] } })
  assert.equal(checks, 2)
  assert.equal(closed, true)
})

test('an unresolved security challenge reports that user action is needed', async () => {
  const page = { async goto() {}, isClosed: () => false, async waitForTimeout() { await new Promise(resolve => setTimeout(resolve, 50)) }, locator: () => ({ count: async () => 1 }) }
  const chromium = { launch: async () => ({
    async newContext() { return { cookies: async () => [], request: { async get() { return { status: () => 401 } } }, newPage: async () => page } },
    async close() {},
  }) }
  await assert.rejects(captureEpicSession({ chromium, timeout: 25 }), { code: 'CHALLENGE_REQUIRED' })
})
