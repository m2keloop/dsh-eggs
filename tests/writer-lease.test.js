import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { acquireWriterLease } from '../src/local/writer-lease.js'

test('writer lease excludes other processes and can be reacquired after release', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-eggs-writer-'))
  const path = join(root, 'writer.lock')
  let lease
  try {
    lease = await acquireWriterLease(path)
    await assert.rejects(acquireWriterLease(path), { code: 'WRITER_BUSY' })
    const moduleUrl = new URL('../src/local/writer-lease.js', import.meta.url).href
    const childCode = `import {acquireWriterLease} from ${JSON.stringify(moduleUrl)}; try { const l = await acquireWriterLease(process.argv[1]); await l.release(); process.exit(0) } catch (e) { process.exit(e.code === 'WRITER_BUSY' ? 23 : 24) }`
    const contender = () => spawnSync(process.execPath, ['--input-type=module', '-e', childCode, path], { timeout: 5000, encoding: 'utf8' })
    assert.equal(contender().status, 23)
    await lease.release()
    lease = undefined
    assert.equal(contender().status, 0)
  } finally {
    if (lease) await lease.release()
    await rm(root, { recursive: true, force: true })
  }
})

test('writer lease rejects a symbolic link as the lock file', { skip: process.platform === 'win32' }, async () => {
  const { symlink, writeFile } = await import('node:fs/promises')
  const root = await mkdtemp(join(tmpdir(), 'dsh-eggs-writer-'))
  try {
    await writeFile(join(root, 'target'), '')
    await symlink(join(root, 'target'), join(root, 'writer.lock'))
    await assert.rejects(acquireWriterLease(join(root, 'writer.lock')))
  } finally { await rm(root, { recursive: true, force: true }) }
})
