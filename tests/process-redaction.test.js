import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

test('integration process output never contains its synthetic credential', { timeout: 30000 }, () => {
  const marker = 'synthetic-p0-process-redaction-marker'
  const child = spawnSync(process.execPath, ['--test', 'tests/dsh-integration.test.js'], {
    cwd: process.cwd(),
    env: { PATH: '/usr/bin:/bin', DSH_EGGS_P0_MARKER: marker },
    encoding: 'utf8',
    timeout: 25000,
  })
  assert.equal((child.stdout ?? '').includes(marker), false, 'marker leaked to stdout')
  assert.equal((child.stderr ?? '').includes(marker), false, 'marker leaked to stderr')
  assert.equal(child.status, 0, 'isolated integration process failed')
})
