// This is a native DSH Schedule, not a second scheduler or a copied rule.
export async function createEggSchedule(ctx, id, everySeconds, signal) {
  if (typeof id !== 'string' || !/^claim_[a-f0-9]{32}$/.test(id)) throw new Error('Invalid configuration')
  if (!Number.isSafeInteger(everySeconds) || everySeconds < 3600 || everySeconds > 604800) throw new Error('Invalid interval')
  const config = await ctx.eggs.store.getClaim(id)
  const runtime = ctx.eggs.runtimes.get(config.benefitId)
  if (!runtime) throw new Error('Unknown benefit')
  return runtime.withEffect(`config:${id}`, async () => {
    await ctx.eggs.store.getClaim(id)
    const prompt = `Call egg_run with claim_config_id ${id}; report the returned status.`
    const existing = (await ctx.schedule.catalog()).find(task => task.prompt === prompt && task.kind === 'every' && task.everySeconds === everySeconds && task.status !== 'ended')
    if (existing) return { status: 'already_exists', schedule_id: existing.id }
    const task = await ctx.schedule.create({
      title: '福利自动领取', prompt,
      timing: { kind: 'every', every_seconds: everySeconds },
      target: { kind: 'new_once', create: { agentPreset: 'eggs-runner' } },
    }, undefined, signal)
    return { status: 'created', schedule_id: task.id }
  })
}
