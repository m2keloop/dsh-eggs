import { validateSettingFields } from './settings.js'
const BENEFIT_ID = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/

// Validates the stable registration surface, not an adapter's behavior or
// safety. Adapter code runs with the same privileges as the DSH Host.
export function validateAdapterEntry(id, entry) {
  if (typeof id !== 'string' || id.length > 80 || !BENEFIT_ID.test(id)) throw new Error('Invalid benefit identifier')
  if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 100) throw new Error('Invalid benefit name')
  const authentication = entry.authentication ?? 'session'
  if (!['session', 'none'].includes(authentication)) throw new Error('Invalid authentication mode')
  if (!entry.adapter || typeof entry.adapter !== 'object') throw new Error('Invalid adapter')
  for (const method of ['authenticate', 'discover', 'verify', 'submit', ...(authentication === 'session' ? ['connect'] : [])]) {
    if (typeof entry.adapter[method] !== 'function') throw new Error(`Missing adapter method: ${method}`)
  }
  return { name: entry.name, authentication, settings: validateSettingFields(entry.settings), adapter: entry.adapter }
}
