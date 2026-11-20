#!/usr/bin/env node
// Long-lived P0 channel: bounded hello/probe/ack only; no website or credentials.
import { createConnection } from 'node:net'
const MAX = 4096, path = process.env.DSH_EGGS_TEST_SESSION_SOCKET
if (!path) process.exit(1)
const socket = createConnection(path)
let input = Buffer.alloc(0), socketInput = '', ready = false
function send(value) {
  const body = Buffer.from(JSON.stringify(value)); const header = Buffer.alloc(4); header.writeUInt32LE(body.length)
  process.stdout.write(Buffer.concat([header, body]))
}
const fail = () => { socket.destroy(); process.stdin.destroy(); process.exitCode = 1 }
socket.on('error', fail)
socket.on('close', () => { process.stdin.destroy() })
socket.on('connect', () => socket.write('{"type":"hello","version":1}\n'))
socket.on('data', chunk => {
  socketInput += chunk.toString('utf8')
  if (Buffer.byteLength(socketInput) > MAX) return fail()
  for (;;) {
    const end = socketInput.indexOf('\n'); if (end < 0) break
    const line = socketInput.slice(0, end); socketInput = socketInput.slice(end + 1)
    try {
      const value = JSON.parse(line)
      if (!ready && value && Object.keys(value).sort().join(',') === 'type,version' && value.type === 'ready' && value.version === 1) { ready = true; send(value); continue }
      if (ready && value && Object.keys(value).sort().join(',') === 'id,type,version' && ['probe', 'inspect'].includes(value.type) && value.version === 1 && /^[a-f0-9-]{36}$/.test(value.id)) { send(value); continue }
      throw new Error('Invalid message')
    } catch { return fail() }
  }
})
process.stdin.on('data', chunk => {
  if (input.length + chunk.length > MAX + 4) return fail()
  input = Buffer.concat([input, chunk])
  while (input.length >= 4) {
    const size = input.readUInt32LE(0)
    if (!size || size > MAX) return fail()
    if (input.length < size + 4) break
    const body = input.subarray(4, 4 + size); input = input.subarray(4 + size)
    try {
      const value = JSON.parse(body.toString('utf8'))
      if (!ready || !value || value.version !== 1 || !/^[a-f0-9-]{36}$/.test(value.id)) throw new Error('Invalid message')
      const keys = Object.keys(value).sort().join(',')
      const ack = value.type === 'ack' && keys === 'id,type,version'
      const unavailable = value.type === 'inspect_result' && value.status === 'unavailable' && keys === 'id,status,type,version'
      const ok = value.type === 'inspect_result' && value.status === 'ok' && keys === 'challengeVisible,getVisible,id,libraryVisible,loggedIn,status,type,version' && ['yes', 'no', 'unknown'].includes(value.loggedIn) && typeof value.getVisible === 'boolean' && typeof value.libraryVisible === 'boolean' && typeof value.challengeVisible === 'boolean'
      if (!ack && !unavailable && !ok) throw new Error('Invalid message')
      socket.write(JSON.stringify(value) + '\n')
    } catch { return fail() }
  }
})
process.stdin.on('end', () => socket.end())
