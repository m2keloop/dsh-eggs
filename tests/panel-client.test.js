import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

test('panel passes declared choices and displays local execution history', async () => {
  const states = [], pendingEffects = []
  let index = 0, initialized = false, Panel
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
      const slot = index++
      if (!(slot in states)) states[slot] = initial
      return [states[slot], value => { states[slot] = typeof value === 'function' ? value(states[slot]) : value }]
    },
    useCallback: fn => fn,
    useEffect(fn) { if (!initialized) pendingEffects.push(fn) },
  }
  let client
  const source = await readFile(new URL('../src/client/client.js', import.meta.url), 'utf8')
  runInNewContext(source, { window: { __ModuleLoader__: { load: entry => { client = entry.factory(() => React) } } } })
  const scope = { remote: { eggsPanel: {} }, slots: { inject(_name, fn) { fn() }, register(_spec, component) { Panel = component } } }
  const ctx = { remote: { async $mount() { return async () => {} } }, inject(_names, fn) { fn(scope); const done = Promise.resolve(); done.dispose = async () => {}; return done } }
  const dispose = await client.apply(ctx)
  const calls = []
  const options = [{ key: 'region', label: '地区', defaultValue: 'CN', choices: [{ value: 'CN', label: '中国' }, { value: 'US', label: '美国' }] }]
  const api = {
    catalog: async () => ({ ok: true, value: [{ id: 'example', name: '示例', settings: options }] }),
    list: async () => ({ ok: true, value: [{ id: 'claim_1', benefitId: 'example', label: '示例', connected: true, authentication: 'none', settings: { region: 'CN' } }] }),
    create: async (id, settings) => { calls.push(['create', id, settings]); return { ok: true, value: { status: 'created' } } },
    updateSettings: async (id, settings) => { calls.push(['update', id, settings]); return { ok: true, value: { status: 'updated' } } },
    history: async () => ({ ok: true, value: { status: 'ok', items: [{ status: 'success', count: 1, finishedAt: '2026-01-01T00:00:00Z' }] } }),
  }
  const render = () => { index = 0; return Panel({ api }) }
  const flat = node => !node || typeof node !== 'object' ? [] : [node, ...(node.children || []).flatMap(flat)]
  let tree = render(); initialized = true
  for (const effect of pendingEffects) effect()
  await new Promise(resolve => setImmediate(resolve))
  tree = render()
  let nodes = flat(tree)
  assert.equal(nodes.filter(node => node.type === 'select').length, 2)
  nodes.filter(node => node.type === 'select')[0].props.onChange({ target: { value: 'US' } })
  tree = render(); nodes = flat(tree)
  await nodes.find(node => node.type === 'button' && node.children[0] === '添加').props.onClick()
  assert.equal(JSON.stringify(calls[0]), JSON.stringify(['create', 'example', { region: 'US' }]))
  tree = render(); nodes = flat(tree)
  nodes.filter(node => node.type === 'select')[1].props.onChange({ target: { value: 'US' } })
  tree = render(); nodes = flat(tree)
  await nodes.find(node => node.type === 'button' && node.children[0] === '保存福利设置').props.onClick()
  assert.equal(JSON.stringify(calls[1]), JSON.stringify(['update', 'claim_1', { region: 'US' }]))
  tree = render(); nodes = flat(tree)
  nodes.find(node => node.type === 'button' && node.children[0] === '查看执行记录').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  tree = render()
  assert.equal(JSON.stringify(tree).includes('领取结果已核验'), true)
  await dispose()
})
