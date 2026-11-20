import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection } from 'node:net'
import { startLocalBridge } from '../experiments/browser-bridge/local-server.js'
import { runInNewContext } from 'node:vm'

const host = fileURLToPath(new URL('../experiments/browser-bridge/native-host.js', import.meta.url))
function frame(value) {
  const body = Buffer.from(JSON.stringify(value))
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length)
  return Buffer.concat([header, body])
}
async function run(chunks, socket) {
  const env = socket ? { PATH: process.env.PATH, DSH_EGGS_TEST_BRIDGE_SOCKET: socket } : { PATH: process.env.PATH }
  const child = spawn(process.execPath, [host], { stdio: ['pipe', 'pipe', 'pipe'], env })
  const output = [], errors = []
  child.stdout.on('data', chunk => output.push(chunk)); child.stderr.on('data', chunk => errors.push(chunk))
  const exit = new Promise(resolve => child.on('close', resolve))
  for (const chunk of chunks) { if (!child.stdin.destroyed) child.stdin.write(chunk) }
  child.stdin.end()
  return { code: await exit, out: Buffer.concat(output), err: Buffer.concat(errors) }
}

test('native bridge accepts only a bounded ping across fragmented messages', async () => {
  const valid = frame({ type: 'ping', version: 1 })
  const ok = await run([valid.subarray(0, 2), valid.subarray(2, 7), valid.subarray(7)])
  assert.equal(ok.code, 0)
  assert.equal(ok.err.length, 0)
  assert.equal(ok.out.readUInt32LE(), ok.out.length - 4)
  assert.deepEqual(JSON.parse(ok.out.subarray(4).toString()), { type: 'pong', version: 1 })
  for (const input of [frame({ type: 'claim', version: 1 }), frame({ type: 'ping', version: 1, cookie: 'synthetic' }), Buffer.from([255, 255, 255, 127])]) {
    const rejected = await run([input])
    assert.notEqual(rejected.code, 0)
    assert.equal(rejected.out.length, 0)
    assert.equal(rejected.err.length, 0)
  }
})

test('native bridge exchanges a ping over a private local socket', { skip: process.platform === 'win32' || process.env.DSH_EGGS_TEST_LOCAL_SOCKET !== '1' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'eggs-bridge-'))
  const socket = join(root, 'bridge.sock')
  let stop, pings = 0
  try {
    stop = await startLocalBridge(socket, { onPing: () => { pings++ } })
    assert.equal((await stat(socket)).mode & 0o777, 0o600)
    await assert.rejects(startLocalBridge(socket))
    const rejected = await new Promise(resolve => {
      const connection = createConnection(socket)
      let output = ''
      connection.on('connect', () => connection.write('{"type":"read","version":1}\n'))
      connection.on('data', chunk => { output += chunk.toString('utf8') })
      connection.on('close', () => resolve(output))
    })
    assert.equal(rejected, '')
    assert.equal(pings, 0)
    const result = await run([frame({ type: 'ping', version: 1 })], socket)
    assert.equal(result.code, 0)
    assert.deepEqual(JSON.parse(result.out.subarray(4).toString()), { type: 'pong', version: 1 })
    assert.equal(pings, 1)
    await stop(); stop = undefined
    const failed = await run([frame({ type: 'ping', version: 1 })], socket)
    assert.deepEqual(JSON.parse(failed.out.subarray(4).toString()), { type: 'error', version: 1 })
  } finally { if (stop) await stop(); await rm(root, { recursive: true, force: true }) }
})

test('experimental extension requests no persistent website or cookie access', async () => {
  const manifest = JSON.parse(await readFile(new URL('../experiments/browser-bridge/manifest.json', import.meta.url), 'utf8'))
  assert.deepEqual(manifest.permissions, ['nativeMessaging', 'activeTab', 'scripting'])
  assert.equal('host_permissions' in manifest, false)
  assert.equal('content_scripts' in manifest, false)
})

test('read-only page-check experiment contains no native bridge and matches the verified inspector', async () => {
  const manifest = JSON.parse(await readFile(new URL('../experiments/epic-page-check/manifest.json', import.meta.url), 'utf8'))
  const small = await readFile(new URL('../experiments/epic-page-check/popup.js', import.meta.url), 'utf8')
  const full = await readFile(new URL('../experiments/browser-bridge/popup.js', import.meta.url), 'utf8')
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting'])
  assert.equal('host_permissions' in manifest, false)
  assert.equal('content_scripts' in manifest, false)
  assert.equal(small.includes('nativeMessaging'), false)
  const fullInspector = full.slice(full.indexOf("const inspect =")).replace("    // Register only this user-invoked tab; a closed or cross-origin tab fails closed.\n    await chrome.runtime.sendMessage({ type: 'register_tab', tabId: tab.id })\n", '')
  assert.equal(small.slice(small.indexOf("const inspect =")), fullInspector)
})

test('page inspection refuses other sites and returns only fixed non-sensitive status', async () => {
  const source = await readFile(new URL('../experiments/browser-bridge/popup.js', import.meta.url), 'utf8')
  const handlers = {}, elements = Object.fromEntries(['ping', 'push', 'inspect', 'status'].map(id => [id, { textContent: '', disabled: false, addEventListener(_type, fn) { handlers[id] = fn } }]))
  let selected = 'https://not-epic.example/', injections = 0
  const secret = 'synthetic-cookie-value'
  const document = {
    querySelector(query) { if (query === 'egs-navigation') return { getAttribute: () => 'true' }; return null },
    querySelectorAll(query) { assert.equal(query, 'section[class*="_sidebar_"]'); return [{ querySelectorAll() { return [{ innerText: 'Get' }] } }] },
    get cookie() { throw new Error('Cookie access is forbidden') },
  }
  const chrome = {
    tabs: { async query() { return [{ id: 3, url: selected }] } },
    scripting: { async executeScript({ func }) { injections++; return [{ result: runInNewContext(`(${func.toString()})()`, { location: new URL(selected), document }) }] } },
    runtime: { async sendMessage() { return { status: 'ready' } } },
  }
  runInNewContext(source, { chrome, URL, document: { getElementById: id => elements[id] } })
  await handlers.inspect()
  assert.equal(injections, 0)
  selected = 'https://store.epicgames.com/en-US/p/example'
  await handlers.inspect()
  assert.equal(injections, 1)
  assert.match(elements.status.textContent, /已登录/)
  assert.equal(elements.status.textContent.includes(secret), false)
})
