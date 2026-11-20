export const name = 'eggs-runner-scope'
export const inject = ['tools', 'eggs']

export function apply(ctx) {
  ctx.tools.restrict({ allow: ['egg_run'] })
  ctx.tools.guard(execution => execution.name === 'egg_run' ? undefined : 'Tool not allowed in the eggs runner')
}
