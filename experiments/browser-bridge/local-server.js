import { createServer } from 'node:net'
import { chmod, lstat, unlink } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'

// Experimental ping-only socket. The owning process must hold the data writer lock.
export async function startLocalBridge(path, { onPing = () => {} } = {}) {
  if (!isAbsolute(path) || Buffer.byteLength(path) > 100) throw new Error('Invalid bridge path')
  const parent = await lstat(dirname(path))
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0 || (process.getuid && parent.uid !== process.getuid())) throw new Error('Bridge directory must be private')
  const existing = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  if (existing) throw new Error('Bridge path already exists')
  const server = createServer(socket => {
    socket.setTimeout(2000)
    let input = '', finished = false
    socket.on('timeout', () => socket.destroy())
    socket.on('error', () => socket.destroy())
    socket.on('data', chunk => {
      if (finished) return
      input += chunk.toString('utf8')
      if (Buffer.byteLength(input) > 4096) { finished = true; socket.destroy(); return }
      const newline = input.indexOf('\n')
      if (newline < 0) return
      finished = true
      try {
        if (newline !== input.length - 1) throw new Error('Invalid message')
        const message = JSON.parse(input.slice(0, newline))
        if (!message || Array.isArray(message) || typeof message !== 'object' || Object.keys(message).sort().join(',') !== 'type,version' || message.type !== 'ping' || message.version !== 1) throw new Error('Invalid message')
        onPing()
        socket.end('{"type":"pong","version":1}\n')
      } catch { socket.destroy() }
    })
  })
  server.maxConnections = 16
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, resolve) })
  try { await chmod(path, 0o600) } catch (error) { await new Promise(resolve => server.close(resolve)); await unlink(path).catch(() => {}); throw error }
  const identity = await lstat(path)
  let closed = false
  return async () => {
    if (closed) return
    closed = true
    await new Promise(resolve => server.close(resolve))
    const current = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    if (current && current.isSocket() && current.dev === identity.dev && current.ino === identity.ino) await unlink(path)
  }
}
