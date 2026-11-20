#!/usr/bin/env node
// A narrow, experimental Chrome Native Messaging ping. No account or site data.
import { createConnection } from 'node:net'
const MAX_BYTES = 4096
let buffer = Buffer.alloc(0), completed = false
function reply(value) {
  const data = Buffer.from(JSON.stringify(value), 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(data.length)
  process.stdout.write(Buffer.concat([header, data]))
}
function accept(chunk) {
  if (completed) return
  if (buffer.length + chunk.length > MAX_BYTES + 4) { completed = true; process.exitCode = 1; process.stdin.destroy(); return }
  buffer = Buffer.concat([buffer, chunk])
  if (buffer.length < 4) return
  const length = buffer.readUInt32LE(0)
  if (length === 0 || length > MAX_BYTES || buffer.length > length + 4) { completed = true; process.exitCode = 1; process.stdin.destroy(); return }
  if (buffer.length < length + 4) return
  completed = true
  try {
    const value = JSON.parse(buffer.subarray(4).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'type,version' || value.type !== 'ping' || value.version !== 1) throw new Error('Invalid request')
    const socketPath = process.env.DSH_EGGS_TEST_BRIDGE_SOCKET
    if (!socketPath) reply({ type: 'pong', version: 1 })
    else {
      const socket = createConnection(socketPath)
      socket.setTimeout(2000)
      let response = '', done = false
      const finish = ok => {
        if (done) return
        done = true
        socket.destroy()
        reply(ok ? { type: 'pong', version: 1 } : { type: 'error', version: 1 })
      }
      socket.on('connect', () => socket.write('{"type":"ping","version":1}\n'))
      socket.on('data', chunk => {
        response += chunk.toString('utf8')
        if (Buffer.byteLength(response) > MAX_BYTES) return finish(false)
        if (!response.endsWith('\n')) return
        try {
          const value = JSON.parse(response)
          finish(value && Object.keys(value).sort().join(',') === 'type,version' && value.type === 'pong' && value.version === 1)
        } catch { finish(false) }
      })
      socket.on('timeout', () => finish(false))
      socket.on('error', () => finish(false))
      socket.on('end', () => finish(false))
    }
  } catch { process.exitCode = 1 }
  process.stdin.destroy()
}
process.stdin.on('data', accept)
process.stdin.on('end', () => { if (!completed) process.exitCode = 1 })
