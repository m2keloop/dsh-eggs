import { join } from 'node:path'
import { LocalStore } from '../local/store.js'
import { systemKeyProvider } from '../local/key-provider.js'
import { builtInAdapters } from '../adapters/index.js'
import { EggService } from '../egg-service.js'

export const name = 'eggs-host'
export const inject = ['profileContext']

export async function apply(ctx) {
  const keys = await systemKeyProvider()
  const store = await LocalStore.open(join(ctx.profileContext.home, 'eggs', 'default'), keys)
  const dispose = ctx.provide('eggs', new EggService({ store, adapters: builtInAdapters() }))
  return async () => { await dispose(); await store.close() }
}
