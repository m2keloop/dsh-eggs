import { defineTool } from '@deepseek-ai/dsh-tools'
import { runFakeClaim } from './runner.js'

export const name = 'eggs-p0-tool'
export const inject = ['tools']

// The P0 bundle only runs an in-memory fixture. It cannot claim real benefits.
export function registerEggTool(ctx, readCredential = async () => 'synthetic-p0') {
  ctx.tools.register(defineTool({
    name: 'egg_run',
    description: 'Run the isolated synthetic P0 claim fixture.',
    parameters: {
      claim_config_id: { type: 'string', required: true, description: 'P0 claim configuration identifier' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      return runFakeClaim({ claimConfigId: args.claim_config_id, readCredential, signal: exec.signal })
    },
  }))
}

export function apply(ctx) {
  registerEggTool(ctx)
}
