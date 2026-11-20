import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'

// OS-level semantics probe; the production Node lock binding remains unimplemented.
test('a kernel lock excludes a second process and is released after process termination', { skip: process.platform === 'win32', timeout: 10000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-eggs-lock-'))
  const path = join(root, 'writer.lock')
  const holderCode = 'import fcntl,sys,time; f=open(sys.argv[1],"a+"); fcntl.flock(f,fcntl.LOCK_EX); print("ready",flush=True); time.sleep(60)'
  const contenderCode = 'import fcntl,sys; f=open(sys.argv[1],"a+"); fcntl.flock(f,fcntl.LOCK_EX | fcntl.LOCK_NB)'
  const holder = spawn('/usr/bin/python3', ['-c', holderCode, path], { stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    const [data] = await once(holder.stdout, 'data')
    assert.equal(data.toString().trim(), 'ready')
    assert.throws(() => execFileSync('/usr/bin/python3', ['-c', contenderCode, path], { stdio: 'pipe', timeout: 3000 }))
    holder.kill('SIGKILL')
    await once(holder, 'exit')
    execFileSync('/usr/bin/python3', ['-c', contenderCode, path], { stdio: 'pipe', timeout: 3000 })
  } finally {
    if (holder.exitCode === null && holder.signalCode === null) holder.kill('SIGKILL')
    await rm(root, { recursive: true, force: true })
  }
})
