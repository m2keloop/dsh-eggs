import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium as playwrightChromium } from 'playwright'
import { openEpicSession } from '../src/adapters/epic/browser.js'

// Optional browser integration with completely synthetic responses, no network.
test('browser checkout does not place an order without a verified real checkout contract', { skip: !process.env.DSH_EGGS_TEST_BROWSER }, async () => {
  let owned = false, orders = 0, amount = '$9.99'
  const chromium = {
    async launch() {
      const browser = await playwrightChromium.launch({ headless: true, executablePath: process.env.DSH_EGGS_TEST_BROWSER })
      return {
        async newContext(options) {
          const context = await browser.newContext(options)
          await context.route('**/*', async route => {
            const url = route.request().url()
            if (url === 'https://store.epicgames.com/en-US/p/example') {
              await route.fulfill({ contentType: 'text/html', body: `<button data-testid="purchase-cta-button">${owned ? 'In Library' : 'Get'}</button><div id="webPurchaseContainer"></div><script>document.querySelector('button').onclick = () => { const frame = document.createElement('iframe'); frame.src = 'https://payment.epicgames.com/checkout'; document.getElementById('webPurchaseContainer').append(frame) }</script>` })
            } else if (url === 'https://payment.epicgames.com/checkout') {
              await route.fulfill({ contentType: 'text/html', body: `<div data-testid="order-summary-total">${amount}</div><button onclick="fetch('/order',{method:'POST'})">Place Order</button>` })
            } else if (url === 'https://payment.epicgames.com/order') {
              orders++; owned = true; await route.fulfill({ status: 200, body: 'ok' })
            } else await route.abort()
          })
          return {
            cookies: () => context.cookies('https://www.epicgames.com'),
            request: { async get() { return { status: () => 200, json: async () => ({ id: 'synthetic-account', country: 'US' }) } } },
            newPage: () => context.newPage(),
            storageState: options => context.storageState(options),
          }
        },
        close: () => browser.close(),
      }
    },
  }
  const session = await openEpicSession({ accountId: 'synthetic-account', storageState: {} }, { chromium })
  const offer = { url: 'https://store.epicgames.com/en-US/p/example' }
  try {
    assert.equal(await session.verify(offer), 'not_owned')
    await assert.rejects(session.submit(offer), { code: 'USER_ACTION_REQUIRED' })
    assert.equal(orders, 0)
    amount = '$0.00'
    assert.equal(await session.verify(offer), 'not_owned')
    await assert.rejects(session.submit(offer), { code: 'USER_ACTION_REQUIRED' })
    assert.equal(orders, 0)
    assert.equal(await session.verify(offer), 'not_owned')
  } finally { await session.close() }
})
