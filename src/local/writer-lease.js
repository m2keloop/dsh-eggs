import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { tryLockExclusive } from '@deepseek-ai/node-addon-system/flock'

// Keep the lock file in a stable directory; it must never be removed while a writer may exist.
export async function acquireWriterLease(path) {
  if (process.platform === 'win32') throw Object.assign(new Error('Writer lease is not supported on Windows yet'), { code: 'UNSUPPORTED_PLATFORM' })
  const file = await open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600)
  try {
    try {
      await tryLockExclusive(file.fd)
    } catch (error) {
      if (error?.code === 'EAGAIN' || error?.code === 'EWOULDBLOCK') throw Object.assign(new Error('Data directory is already in use'), { code: 'WRITER_BUSY' })
      throw error
    }
    const [opened, current] = await Promise.all([file.stat({ bigint: true }), lstat(path, { bigint: true })])
    if (!current.isFile() || opened.dev !== current.dev || opened.ino !== current.ino) throw new Error('Writer lock path changed')
    let released = false
    return { async release() { if (!released) { released = true; await file.close() } } }
  } catch (error) {
    await file.close()
    throw error
  }
}
