import { writeFile } from 'node:fs/promises'

export const name = 'eggs-bridge-push-probe'
export const inject = ['eggsBridgeExperiment']
export function apply(ctx) {
  let stopped = false
  const task = (async () => {
    const deadline = Date.now() + 45000
    while (!stopped && !ctx.eggsBridgeExperiment.session.ready() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
    if (stopped) return
    let ok = false
    try { ok = await ctx.eggsBridgeExperiment.session.probe(5000) } catch { /* Report only a boolean. */ }
    await writeFile(process.env.DSH_EGGS_BRIDGE_PUSH_OUTPUT, JSON.stringify({ ok }), { mode: 0o600 })
  })()
  return async () => { stopped = true; await task }
}
