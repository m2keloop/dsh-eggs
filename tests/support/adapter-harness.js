import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalStore } from '../../src/local/store.js'
import { EggService } from '../../src/egg-service.js'

// Local synthetic test helper. It never accesses the user's credential store.
export async function withAdapterHarness(id, entry, test) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-eggs-adapter-'))
  const keys = new Map()
  const provider = {
    async get(instanceId) { return keys.get(instanceId) ?? null },
    async create(instanceId) { const key = randomBytes(32); keys.set(instanceId, key); return key },
  }
  let store
  try {
    store = await LocalStore.open(root, provider)
    const service = new EggService({ store, adapters: { [id]: entry } })
    const { claim_config_id: configId } = await service.create(id)
    return await test({ service, store, configId, root })
  } finally {
    if (store) await store.close()
    await rm(root, { recursive: true, force: true })
  }
}
