import { join } from 'node:path'
import { startLocalBridge } from './local-server.js'
import { startSessionBridge } from './session-server.js'

// Isolated P0 only: not included in the product bundle or exposed to the model.
export const name = 'eggs-bridge-experiment'
export const inject = ['eggs']
export async function apply(ctx) {
  const path = join(ctx.eggs.store.root, 'browser-bridge.sock')
  let pings = 0
  const stop = await startLocalBridge(path, { onPing: () => { pings++ } })
  try {
    const sessionPath = join(ctx.eggs.store.root, 'browser-session.sock')
    const session = await startSessionBridge(sessionPath)
    const dispose = ctx.provide('eggsBridgeExperiment', { path, pings: () => pings, sessionPath, session })
    return async () => { try { await dispose(); await session.close() } finally { await stop() } }
  } catch (error) { await stop(); throw error }
}
