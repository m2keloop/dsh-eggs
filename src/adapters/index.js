import { EpicAdapter } from './epic/adapter.js'

// Repository-reviewed adapters are registered here; no remote code is loaded.
export function builtInAdapters() {
  return { 'epic-free-games': { name: 'Epic 免费游戏', adapter: new EpicAdapter() } }
}
