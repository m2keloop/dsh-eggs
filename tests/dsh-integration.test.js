import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import ScheduleService from '@deepseek-ai/dsh-schedule'
import { registerEggTool } from '../src/p0/plugin.js'
import { open, readEnvelope, seal, writeEnvelope } from '../src/p0/vault.js'
import { defineTool } from '@deepseek-ai/dsh-tools'

async function filesUnder(root) {
  const files = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...await filesUnder(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

test('native schedule delivers to a real agent which calls egg_run without exposing the synthetic credential', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-eggs-integration-'))
  const secret = process.env.DSH_EGGS_P0_MARKER ?? `synthetic-${randomBytes(24).toString('hex')}`
  const key = randomBytes(32)
  const binding = { instanceId: 'p0_instance', claimConfigId: 'claim_p0' }
  const credentialFile = join(root, 'credentials.enc')
  await writeEnvelope(credentialFile, seal({ token: secret }, key, binding))
  const requests = []
  let calls = 0
  let forbiddenCalls = 0
  class FakeModel extends LlmAdapter {
    async *stream(options) {
      requests.push(JSON.stringify(options))
      if (requests.length <= 2) {
        const name = requests.length === 1 ? 'egg_run' : 'forbidden_tool'
        const args = JSON.stringify(requests.length === 1 ? { claim_config_id: 'claim_p0' } : {})
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: `p0-call-${requests.length}`, name, argumentsDelta: args }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: `p0-call-${requests.length}`, name, arguments: args } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'done' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
  }
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: join(root, 'schedule') })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(ScheduleService)
    await ctx.plugin({ name: 'p0-forbidden', inject: ['tools'], apply(scope) {
      scope.tools.register(defineTool({ name: 'forbidden_tool', description: 'Must not be accessible.', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() { forbiddenCalls++; return 'forbidden' } }))
    } })
    ctx.llm.registerAdapter(['p0-mock'], new FakeModel())
    const agent = await ctx.agentLoop.create('p0-session', { provider: 'p0-mock', model: 'p0-mock' })
    await agent.ctx.plugin({ name: 'p0-egg-tool', inject: ['tools'], apply(scope) {
      scope.tools.restrict({ allow: [] })
      scope.tools.guard(execution => execution.name === 'egg_run' ? undefined : 'P0 tool denied')
      registerEggTool(scope, async () => { calls++; return open(await readEnvelope(credentialFile), key, binding).token })
    } })
    ctx.on('schedule/resolve-agent', async () => agent)
    const task = await ctx.schedule.create({ title: 'P0 fixture', prompt: 'Use egg_run with claim_p0.', timing: { kind: 'after', after_seconds: 1 }, target: { kind: 'session', sessionId: agent.session.id } }, agent.session.id)
    const deadline = Date.now() + 15000
    while (calls === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(calls, 1, 'scheduled tool was not executed')
    await agent.whenIdle()
    await ctx.sessions.flush(agent.session)
    let history
    while (Date.now() < deadline) {
      history = await ctx.schedule.history({ id: task.id, limit: 10 })
      if (JSON.stringify(history).includes('p0-session')) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal(JSON.stringify(history).includes('p0-session'), true, 'delivery receipt was not persisted')
    const events = JSON.stringify(agent.session.snapshotEvents())
    assert.equal(events.includes('FAKE_CLAIM_VERIFIED'), true)
    assert.equal(events.includes(secret), false)
    assert.equal(forbiddenCalls, 0, 'restricted tool must not run')
    assert.equal(requests.length >= 3, true, 'mock must attempt the forbidden tool')
    assert.equal(events.includes('forbidden_tool'), true, 'the denied call must be present in the test session')
    assert.equal(requests[0].includes('forbidden_tool'), false, 'forbidden tool must not be advertised')
    assert.equal(requests[0].includes('egg_run'), true, 'egg_run must be advertised')
    assert.equal(requests.some(request => request.includes(process.cwd())), false, 'workspace path must not enter the mock model request')
    assert.equal(requests.some(request => request.includes(root)), false, 'temporary data path must not enter the mock model request')
    assert.equal(requests.every(request => !request.includes(secret)), true)
    for (const file of await filesUnder(root)) assert.equal((await readFile(file)).includes(Buffer.from(secret)), false)
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
