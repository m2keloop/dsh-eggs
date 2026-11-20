import { randomBytes } from 'node:crypto'
import { ClaimRuntime } from '../../src/runtime/claim-runtime.js'
import { validateAdapterEntry } from '../../src/adapters/contract.js'

// Only for an isolated DSH_HOME. Never installed by the production bundle.
export const name = 'eggs-test-benefit'
export const inject = ['eggs']

export function apply(ctx) {
  if (process.env.DSH_EGGS_TEST_DEMO !== '1') throw new Error('Test fixture disabled')
  const keys = new Map()
  ctx.eggs.store.keys = {
    async get(id) { return keys.get(id) ?? null },
    async create(id) { const key = randomBytes(32); keys.set(id, key); return key },
  }
  let owned = false
  const adapter = {
    async connect() { return { accountId: 'synthetic-demo', token: 'synthetic-demo-token' } },
    async authenticate(credential) {
      if (credential?.accountId !== 'synthetic-demo' || credential.token !== 'synthetic-demo-token') throw new Error('Invalid test credential')
      return { subject: 'synthetic-demo' }
    },
    async discover({ settings }) { return [{ id: `offer-${settings.region}`, namespace: 'test', cycleKey: 'test-period', expiresAt: '2099-01-01T00:00:00Z' }] },
    async verify() { return owned ? 'owned' : 'not_owned' },
    async submit() { owned = true },
  }
  const id = 'synthetic-benefit'
  const entry = validateAdapterEntry(id, { name: '合成测试福利', settings: [{ key: 'region', label: '测试地区', choices: [{ value: 'CN', label: '中国' }, { value: 'US', label: '美国' }] }], adapter })
  ctx.eggs.adapters[id] = entry
  ctx.eggs.runtimes.set(id, new ClaimRuntime({ store: ctx.eggs.store, adapter, authentication: entry.authentication, settingFields: entry.settings }))
  return () => { delete ctx.eggs.adapters[id]; ctx.eggs.runtimes.delete(id) }
}
