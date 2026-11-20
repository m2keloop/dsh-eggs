import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { chmod, lstat, unlink } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'

// Experimental fixed-message push; never accepts credentials, URLs or scripts.
export async function startSessionBridge(path) {
  if (!isAbsolute(path) || Buffer.byteLength(path) > 100) throw new Error('Invalid bridge path')
  const parent = await lstat(dirname(path))
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0 || (process.getuid && parent.uid !== process.getuid())) throw new Error('Bridge directory must be private')
  if (await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error })) throw new Error('Bridge path already exists')
  let peer, pending
  const connections = new Set()
  const server = createServer(socket => {
    if (peer) { socket.destroy(); return }
    connections.add(socket)
    socket.setTimeout(5000)
    socket.on('timeout', () => socket.destroy())
    let input = '', ready = false
    const fail = () => {
      connections.delete(socket)
      if (peer !== socket) return
      peer = undefined
      if (pending) { clearTimeout(pending.timer); pending.reject(new Error('Bridge disconnected')); pending = undefined }
    }
    socket.on('error', () => socket.destroy())
    socket.on('close', fail)
    socket.on('data', chunk => {
      input += chunk.toString('utf8')
      if (Buffer.byteLength(input) > 4096) { socket.destroy(); return }
      for (;;) {
        const index = input.indexOf('\n')
        if (index < 0) break
        const line = input.slice(0, index); input = input.slice(index + 1)
        try {
          const message = JSON.parse(line)
          if (!ready && message && Object.keys(message).sort().join(',') === 'type,version' && message.type === 'hello' && message.version === 1) {
            if (peer) throw new Error('Bridge busy')
            ready = true; peer = socket; socket.setTimeout(0); socket.write('{"type":"ready","version":1}\n'); continue
          }
          if (ready && pending && pending.kind === 'probe' && message && Object.keys(message).sort().join(',') === 'id,type,version' && message.type === 'ack' && message.version === 1 && message.id === pending.id) {
            clearTimeout(pending.timer); const resolve = pending.resolve; pending = undefined; resolve(true); continue
          }
          if (ready && pending && pending.kind === 'inspect' && message && message.type === 'inspect_result' && message.version === 1 && message.id === pending.id) {
            const keys = Object.keys(message).sort().join(',')
            const unavailable = message.status === 'unavailable' && keys === 'id,status,type,version'
            const ok = message.status === 'ok' && keys === 'challengeVisible,getVisible,id,libraryVisible,loggedIn,status,type,version' && ['yes', 'no', 'unknown'].includes(message.loggedIn) && typeof message.getVisible === 'boolean' && typeof message.libraryVisible === 'boolean' && typeof message.challengeVisible === 'boolean'
            if (!unavailable && !ok) throw new Error('Invalid result')
            clearTimeout(pending.timer); const resolve = pending.resolve; pending = undefined
            resolve(unavailable ? { status: 'unavailable' } : { status: 'ok', loggedIn: message.loggedIn, getVisible: message.getVisible, libraryVisible: message.libraryVisible, challengeVisible: message.challengeVisible })
            continue
          }
          throw new Error('Invalid message')
        } catch { socket.destroy(); return }
      }
    })
  })
  server.maxConnections = 2
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, resolve) })
  try { await chmod(path, 0o600) } catch (error) { await new Promise(resolve => server.close(resolve)); await unlink(path).catch(() => {}); throw error }
  const identity = await lstat(path)
  return {
    ready: () => Boolean(peer),
    async request(kind, timeout = 5000) {
      if (!['probe', 'inspect'].includes(kind)) throw new Error('Invalid bridge request')
      if (!peer || pending) throw new Error('Browser bridge unavailable')
      const id = randomUUID()
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { if (pending?.id === id) pending = undefined; reject(new Error('Browser probe timeout')) }, timeout)
        pending = { id, kind, timer, resolve, reject }
        peer.write(JSON.stringify({ type: kind, version: 1, id }) + '\n')
      })
    },
    async probe(timeout) { return this.request('probe', timeout) },
    async inspect(timeout) { return this.request('inspect', timeout) },
    async close() {
      for (const socket of connections) socket.destroy()
      await new Promise(resolve => server.close(resolve))
      const current = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error })
      if (current && current.isSocket() && current.dev === identity.dev && current.ino === identity.ino) await unlink(path)
    },
  }
}
