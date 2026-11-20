import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateAdapterEntry } from '../src/adapters/contract.js'
import { builtInAdapters } from '../src/adapters/index.js'
import { resolveSettings } from '../src/adapters/settings.js'

test('every built-in benefit implements the registration contract', () => {
  for (const [id, entry] of Object.entries(builtInAdapters())) assert.equal(validateAdapterEntry(id, entry).adapter, entry.adapter)
})

test('benefit settings accept only declared choices and never arbitrary fields', () => {
  const adapter = { authenticate() {}, discover() {}, verify() {}, submit() {} }
  const entry = validateAdapterEntry('sample', { name: 'Sample', authentication: 'none', adapter, settings: [{ key: 'region', label: '地区', choices: [{ value: 'CN', label: '中国' }, { value: 'US', label: '美国' }], defaultValue: 'CN' }] })
  assert.deepEqual(resolveSettings(entry.settings), { region: 'CN' })
  assert.deepEqual(resolveSettings(entry.settings, { region: 'US' }), { region: 'US' })
  assert.throws(() => resolveSettings(entry.settings, { region: 'unexpected' }))
  assert.throws(() => resolveSettings(entry.settings, { token: 'synthetic' }))
  assert.throws(() => validateAdapterEntry('sample', { name: 'Sample', authentication: 'none', adapter, settings: [{ key: '__proto__', label: 'Bad', choices: [{ value: 'one', label: 'One' }] }] }))
})

test('registration requires safe metadata and the methods for its auth mode', () => {
  const adapter = { authenticate() {}, discover() {}, verify() {}, submit() {} }
  assert.equal(validateAdapterEntry('sample-freebie', { name: 'Sample', authentication: 'none', adapter }).authentication, 'none')
  assert.throws(() => validateAdapterEntry('sample-freebie', { name: 'Sample', adapter }))
  assert.throws(() => validateAdapterEntry('sample-freebie', { name: 'Sample', authentication: 'none', adapter: { ...adapter, verify: undefined } }))
  assert.throws(() => validateAdapterEntry('../bad', { name: 'Sample', authentication: 'none', adapter }))
  assert.throws(() => validateAdapterEntry('sample', { name: '', authentication: 'none', adapter }))
  assert.throws(() => validateAdapterEntry('sample', { name: 'Sample', authentication: 'unknown', adapter }))
})
