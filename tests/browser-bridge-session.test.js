import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startSessionBridge } from '../experiments/browser-bridge/session-server.js'

const host = fileURLToPath(new URL('../experiments/browser-bridge/session-host.js', import.meta.url))
const frame = value => { const data = Buffer.from(JSON.stringify(value)), head = Buffer.alloc(4); head.writeUInt32LE(data.length); return Buffer.concat([head, data]) }
function reader(stream) {
  let buffer = Buffer.alloc(0), waiter
  const items = []
  stream.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
      const length = buffer.readUInt32LE(0), value = JSON.parse(buffer.subarray(4, length + 4)); buffer = buffer.subarray(length + 4)
      if (waiter) { const ready = waiter; waiter = undefined; ready(value) } else items.push(value)
    }
  })
  return () => items.length ? Promise.resolve(items.shift()) : new Promise(resolve => { waiter = resolve })
}

test('local Host can push a correlated test task to a browser native session', { skip: process.platform === 'win32' || process.env.DSH_EGGS_TEST_LOCAL_SOCKET !== '1', timeout: 10000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'es-'))
  const path = join(root, 'session.sock')
  let server, child
  try {
    server = await startSessionBridge(path)
    child = spawn(process.execPath, [host], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH, DSH_EGGS_TEST_SESSION_SOCKET: path } })
    const next = reader(child.stdout)
    assert.deepEqual(await next(), { type: 'ready', version: 1 })
    const result = server.probe()
    const request = await next()
    assert.equal(request.type, 'probe')
    child.stdin.write(frame({ type: 'ack', version: 1, id: request.id }))
    assert.equal(await result, true)
    const check = server.inspect()
    const read = await next()
    assert.equal(read.type, 'inspect')
    child.stdin.write(frame({ type: 'inspect_result', version: 1, id: read.id, status: 'ok', loggedIn: 'yes', getVisible: true, libraryVisible: false, challengeVisible: false }))
    assert.deepEqual(await check, { status: 'ok', loggedIn: 'yes', getVisible: true, libraryVisible: false, challengeVisible: false })
    const denied = server.inspect()
    const invalid = await next()
    child.stdin.write(frame({ type: 'inspect_result', version: 1, id: invalid.id, status: 'ok', loggedIn: 'yes', getVisible: true, libraryVisible: false, challengeVisible: false, cookie: 'synthetic-secret' }))
    await assert.rejects(denied)
  } finally {
    if (child) { child.stdin.end(); child.kill('SIGTERM') }
    if (server) await server.close()
    await rm(root, { recursive: true, force: true })
  }
})
