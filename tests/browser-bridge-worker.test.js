import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const tick = () => new Promise(resolve => setImmediate(resolve))
test('browser worker only inspects an explicitly authorized Epic tab and returns fixed fields', async () => {
  const source = await readFile(new URL('../experiments/browser-bridge/worker.js', import.meta.url), 'utf8')
  const sent = [], events = {}, extensionId = 'synthetic-extension'
  let listener, url = 'https://store.epicgames.com/en-US/p/example', injections = 0
  const port = {
    onMessage: { addListener(fn) { events.message = fn } },
    onDisconnect: { addListener(fn) { events.disconnect = fn } },
    postMessage(value) { sent.push(value) }, disconnect() {},
  }
  const chrome = {
    runtime: { id: extensionId, getURL: path => `chrome-extension://${extensionId}/${path}`, onMessage: { addListener(fn) { listener = fn } }, connectNative: () => port },
    tabs: { async get() { return { url } } },
    scripting: { async executeScript() { injections++; return [{ result: { allowed: true, loggedIn: 'yes', getVisible: true, libraryVisible: false, challengeVisible: false, cookie: 'synthetic-secret' } }] } },
  }
  runInNewContext(source, { chrome, URL, importScripts() {}, inspectEpicPage() {} })
  const owner = { id: extensionId, url: `chrome-extension://${extensionId}/popup.html` }
  assert.equal(listener({ type: 'register_tab', tabId: 4 }, { id: 'other', url: owner.url }, () => {}), false)
  const registered = new Promise(resolve => assert.equal(listener({ type: 'register_tab', tabId: 4 }, owner, resolve), true))
  assert.equal((await registered).status, 'ready')
  const connected = new Promise(resolve => assert.equal(listener({ type: 'start_probe' }, owner, resolve), true))
  events.message({ type: 'ready', version: 1 })
  assert.equal((await connected).status, 'ready')
  const id = '12345678-1234-1234-1234-123456789abc'
  events.message({ type: 'inspect', version: 1, id }); await tick()
  assert.equal(injections, 1)
  assert.equal(sent[0].status, 'ok')
  assert.equal(JSON.stringify(sent).includes('synthetic-secret'), false)
  url = 'https://unrelated.example/'
  events.message({ type: 'inspect', version: 1, id }); await tick()
  assert.equal(sent[1].status, 'unavailable')
  assert.equal(injections, 1)
  url = 'https://store.epicgames.com/en-US/p/example'
  events.message({ type: 'inspect', version: 1, id }); await tick()
  assert.equal(sent[2].status, 'unavailable')
  assert.equal(injections, 1)
})
