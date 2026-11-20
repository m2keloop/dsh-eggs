import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { TYPERT } from '../src/integration/typert.js'

test('browser and Host expose the same panel methods and argument names', async () => {
  let client
  const source = await readFile(new URL('../src/client/client.js', import.meta.url), 'utf8')
  runInNewContext(source, { window: { __ModuleLoader__: { load: entry => { client = entry.factory(() => ({})) } } } })
  let descriptors
  const scope = { remote: { eggsPanel: {} }, slots: { inject() {} } }
  const ctx = {
    remote: { async $mount(contribution) { descriptors = contribution.descriptors; return async () => {} } },
    inject(_names, fn) { fn(scope); const done = Promise.resolve(); done.dispose = async () => {}; return done },
  }
  const dispose = await client.apply(ctx)
  const projection = entries => Array.from(entries, entry => ({ method: entry.method, parameters: Array.from(entry.parameters, p => ({ name: p.name, optional: Boolean(p.acceptsUndefined) })), cancellation: Boolean(entry.cancellation) })).sort((a, b) => a.method.localeCompare(b.method))
  assert.deepEqual(projection(descriptors), projection(TYPERT.invocations))
  await dispose()
})
