import { writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'

export const name = 'eggs-bridge-probe'
export const inject = ['eggsBridgeExperiment']
export function apply(ctx) {
  const timer = setTimeout(async () => {
    let ok = false
    try {
      const response = await new Promise((resolve, reject) => {
        const socket = createConnection(ctx.eggsBridgeExperiment.path)
        let data = ''
        socket.setTimeout(3000)
        socket.on('connect', () => socket.write('{"type":"ping","version":1}\n'))
        socket.on('data', chunk => { data += chunk.toString('utf8') })
        socket.on('end', () => resolve(data))
        socket.on('error', reject)
        socket.on('timeout', () => socket.destroy(new Error('Timeout')))
      })
      ok = JSON.parse(response).type === 'pong' && ctx.eggsBridgeExperiment.pings() === 1
    } catch { /* Report only a boolean. */ }
    await writeFile(process.env.DSH_EGGS_BRIDGE_PROBE_OUTPUT, JSON.stringify({ ok }), { mode: 0o600 })
  }, 1000)
  return () => clearTimeout(timer)
}
