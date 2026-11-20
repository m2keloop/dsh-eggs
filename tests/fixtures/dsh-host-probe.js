import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createEggSchedule } from '../../src/integration/scheduler.js'

export const name = 'eggs-host-probe'
export const inject = ['eggs', 'tools', 'agentPresets', 'agentLoop', 'schedule', 'typertGateway', 'eggsPanel']

export function apply(ctx) {
  const timer = setTimeout(async () => {
    let stage = 'resolve'
    try {
      const preset = await ctx.agentPresets.resolve('eggs-runner')
      stage = 'agent'
      const agent = await ctx.agentLoop.create(`eggs-probe-${randomUUID()}`, { provider: 'eggs-probe', model: 'eggs-probe' })
      stage = 'mount'
      await ctx.agentPresets.mount(agent.ctx, 'eggs-runner')
      const names = ctx.tools.schemas(agent).map(tool => tool.name)
      stage = 'config'
      const config = await ctx.eggs.create()
      stage = 'schedule'
      const schedule = await createEggSchedule(ctx, config.claim_config_id, 604800)
      stage = 'view'
      const saved = await ctx.schedule.view({ id: schedule.schedule_id })
      stage = 'remote'
      const peer = { id: 'eggs-probe', ctx, principal: { kind: 'owner' }, signal: new AbortController().signal, interactions: 'none', async dispose() {} }
      const catalog = await ctx.typertGateway.invoke({ namespace: 'eggsPanel', method: 'catalog', args: {}, peer })
      let viewerDenied = false, invalidDenied = false
      try { await ctx.typertGateway.invoke({ namespace: 'eggsPanel', method: 'catalog', args: {}, peer: { ...peer, principal: { kind: 'viewer' } } }) } catch { viewerDenied = true }
      try { await ctx.typertGateway.invoke({ namespace: 'eggsPanel', method: 'create', args: { benefitId: 'epic-free-games', secret: 'synthetic' }, peer }) } catch { invalidDenied = true }
      const result = {
        service: Boolean(ctx.eggs),
        tools: ['egg_catalog', 'egg_list', 'egg_create', 'egg_run'].every(name => Boolean(ctx.tools.get(name))) && !ctx.tools.get('egg_connect') && !ctx.tools.get('egg_schedule'),
        preset: preset.id === 'eggs-runner' && !preset.error,
        scopedTools: names.length === 1 && names[0] === 'egg_run',
        schedule: saved.target.create.agentPreset === 'eggs-runner',
        remote: Array.isArray(catalog) && catalog.some(item => item.id === 'epic-free-games'),
        viewerDenied, invalidDenied,
      }
      await writeFile(process.env.DSH_EGGS_PROBE_OUTPUT, JSON.stringify(result), { mode: 0o600 })
    } catch (error) {
      await writeFile(process.env.DSH_EGGS_PROBE_OUTPUT, JSON.stringify({ service: false, stage, error: error.code ?? error.name }), { mode: 0o600 })
    }
  }, 1000)
  return () => clearTimeout(timer)
}
