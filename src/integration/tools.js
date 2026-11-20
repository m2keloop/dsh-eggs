import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'eggs-tools'
export const inject = ['tools', 'eggs']
const output = { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'egg_catalog', description: 'List available benefit adapters.', parameters: {}, output,
    async execute() { return ctx.eggs.listBenefits() },
  }))
  ctx.tools.register(defineTool({
    name: 'egg_list', description: 'List local claim configurations and whether a local credential exists; this does not verify its validity.', parameters: {}, output,
    async execute() { try { return await ctx.eggs.list() } catch { return { status: 'failed', code: 'LIST_FAILED' } } },
  }))
  ctx.tools.register(defineTool({
    name: 'egg_create', description: 'Create a local claim configuration for an available benefit.',
    parameters: { benefit_id: { type: 'string', description: 'Benefit ID from egg_catalog; defaults to epic-free-games' } }, output,
    async execute(args) { try { return await ctx.eggs.create(args.benefit_id) } catch { return { status: 'failed', code: 'CREATE_FAILED' } } },
  }))
  ctx.tools.register(defineTool({
    name: 'egg_run', description: 'Run the configured Epic free-games claim and return a safe status.',
    parameters: { claim_config_id: { type: 'string', required: true, description: 'Local claim configuration ID' } }, output,
    async execute(args, exec) { return ctx.eggs.run(args.claim_config_id, exec.signal) },
  }))
}
