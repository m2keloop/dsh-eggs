const STORE = 'https://store.epicgames.com/en-US/free-games'
const ACCOUNT = 'https://www.epicgames.com/id/api/account'
const SAFE_PATH = /^\/(?:en-US\/)?p\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/i
const needsUser = () => Object.assign(new Error('Checkout requires user action'), { code: 'USER_ACTION_REQUIRED' })

export function zeroTotal(value) {
  return typeof value === 'string' && /^(?:\$0\.00|CN¥0\.00|0\.00\s*(?:USD|CNY|\$)|Free)$/i.test(value.trim())
}

export function sameOfferUrl(expected, actual) {
  if (!validateOfferUrl(expected) || !validateOfferUrl(actual)) return false
  const normalize = value => new URL(value).pathname.replace(/^\/en-US(?=\/p\/)/, '')
  return normalize(expected) === normalize(actual)
}

export function validateOfferUrl(value) {
  try {
    const url = new URL(value)
    // The live store can redirect to the locale-neutral path with lang=en-US.
    // No other query parameters, duplicates or fragments are allowed.
    const query = [...url.searchParams.entries()]
    const safeQuery = query.length === 0 || (query.length === 1 && query[0][0] === 'lang' && query[0][1] === 'en-US')
    return url.protocol === 'https:' && url.hostname === 'store.epicgames.com' && !url.port && !url.username && !url.password && safeQuery && !url.hash && SAFE_PATH.test(url.pathname)
  } catch { return false }
}

async function identity(context) {
  // Epic's ID API may require the XSRF cookie in a matching header. The value
  // stays inside the browser context and is never returned to a tool or log.
  const cookies = await context.cookies('https://www.epicgames.com')
  const xsrf = cookies.find(cookie => cookie.name === 'XSRF-TOKEN')?.value
  let token
  try { token = xsrf && decodeURIComponent(xsrf) } catch { return null }
  if (token && /[\r\n]/.test(token)) return null
  const response = await context.request.get(ACCOUNT, { maxRedirects: 0, timeout: 10000, headers: token ? { 'x-xsrf-token': token } : {} })
  if (response.status() === 401) return null
  if (response.status() !== 200) throw Object.assign(new Error('Epic account endpoint unavailable'), { code: 'ACCESS_BLOCKED' })
  const account = await response.json()
  if (typeof account?.id !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(account.id)) return null
  return { id: account.id, country: typeof account.country === 'string' && /^[A-Z]{2}$/.test(account.country) ? account.country : null }
}

// Users enter credentials and solve challenges only in the official browser page.
export async function captureEpicSession({ chromium, timeout = 180000, signal } = {}) {
  signal?.throwIfAborted()
  chromium ??= (await import('playwright')).chromium
  const browser = await chromium.launch({ headless: false })
  const cancel = () => { void browser.close().catch(() => {}) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    signal?.throwIfAborted()
    const context = await browser.newContext({ locale: 'en-US' })
    const page = await context.newPage()
    await page.goto(STORE, { waitUntil: 'domcontentloaded', timeout: 30000 })
    const deadline = Date.now() + timeout
    let challengeSeen = false
    while (Date.now() < deadline && !page.isClosed()) {
      signal?.throwIfAborted()
      challengeSeen ||= await page.locator('iframe[src*="challenges.cloudflare.com"], iframe[src*="hcaptcha.com"], iframe[src*="recaptcha"]').count() > 0
      const account = await identity(context)
      if (account) {
        const storageState = await context.storageState({ indexedDB: true })
        return { accountId: account.id, storageState }
      }
      await page.waitForTimeout(Math.min(5000, Math.max(1, deadline - Date.now())))
    }
    throw Object.assign(new Error('Could not confirm Epic identity'), { code: challengeSeen ? 'CHALLENGE_REQUIRED' : 'AUTH_REQUIRED' })
  } finally { signal?.removeEventListener('abort', cancel); await browser.close().catch(() => {}) }
}

// These selectors must be validated against the live store before release. Unrecognized states fail closed.
export async function openEpicSession(credential, { chromium, headless = false } = {}) {
  chromium ??= (await import('playwright')).chromium
  const browser = await chromium.launch({ headless })
  try {
    const context = await browser.newContext({ locale: 'en-US', storageState: credential.storageState })
    const account = await identity(context)
    if (!account || account.id !== credential.accountId) throw Object.assign(new Error('Epic session requires login'), { code: 'AUTH_REQUIRED' })
    const page = await context.newPage()
    return {
      subject: account.id,
      country: account.country,
      async verify(offer) {
        if (!validateOfferUrl(offer.url)) return 'unknown'
        await page.goto(offer.url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        if (!sameOfferUrl(offer.url, page.url())) return 'unknown'
        const buttons = page.getByRole('button', { name: /^(Get|In Library)$/i })
        await buttons.first().waitFor({ state: 'visible', timeout: 15000 })
        if (await buttons.count() !== 1) return 'unknown'
        const text = (await buttons.first().innerText()).trim().toLowerCase()
        if (text === 'in library') return 'owned'
        if (text === 'get') return 'not_owned'
        return 'unknown'
      },
      async submit(offer) {
        if (!sameOfferUrl(offer.url, page.url())) throw new Error('Unverified offer page')
        const buttons = page.getByRole('button', { name: /^Get$/i })
        if (await buttons.count() !== 1) throw new Error('Offer is not claimable')
        const button = buttons.first()
        if (!(await button.isVisible()) || !(await button.isEnabled()) || (await button.innerText()).trim().toLowerCase() !== 'get') throw new Error('Offer is not claimable')
        await button.click()
        const warning = page.locator('[role="dialog"]').getByRole('button', { name: 'Continue', exact: true })
        if (await warning.isVisible().catch(() => true)) throw needsUser()
        const frames = page.locator('#webPurchaseContainer iframe:visible, [role="dialog"] iframe:visible')
        try { await frames.first().waitFor({ state: 'visible', timeout: 15000 }) } catch { throw needsUser() }
        if (await warning.isVisible().catch(() => true) || await frames.count() !== 1) throw needsUser()
        const element = await frames.first().elementHandle()
        const frame = await element?.contentFrame()
        if (!frame) throw needsUser()
        const frameUrl = new URL(frame.url())
        if (frameUrl.protocol !== 'https:' || !(frameUrl.hostname === 'epicgames.com' || frameUrl.hostname.endsWith('.epicgames.com'))) throw new Error('Untrusted checkout')
        const total = frame.getByTestId('order-summary-total')
        let value
        try { value = await total.innerText({ timeout: 10000 }) } catch { throw needsUser() }
        if (!zeroTotal(value)) throw needsUser()
        if (await frame.locator('iframe[src*="hcaptcha"], iframe[src*="recaptcha"]').count()) throw needsUser()
        // The real checkout does not expose the synthetic total selector used in
        // tests. Until its final amount and confirmation flow are verified on
        // Epic, even a matching zero-looking element cannot authorize an order.
        throw needsUser()
      },
      async snapshot() { return { accountId: account.id, storageState: await context.storageState({ indexedDB: true }) } },
      async close() { await browser.close() },
    }
  } catch (error) { await browser.close(); throw error }
}
