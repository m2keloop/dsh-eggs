// Explicit Remote contract for the experimental DSH client. No credential fields cross it.
import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'

const pkg = 'dsh-eggs-p0'
const string = () => z.string().min(1).max(100)
const number = () => z.number().int().min(3600).max(604800)
const result = () => z.object({ status: z.string(), code: z.string().optional(), count: z.number().optional(), claim_config_id: z.string().optional(), schedule_id: z.string().optional() }).strict()
const settingFields = () => z.array(z.object({ key: z.string().max(32), label: z.string().max(80), choices: z.array(z.object({ value: z.string().max(50), label: z.string().max(80) }).strict()).max(50), defaultValue: z.string().max(50) }).strict()).max(8)
const catalog = () => z.array(z.object({ id: z.string(), name: z.string(), settings: settingFields().optional() }).strict())
const settings = () => z.record(z.string().max(32), z.string().max(50))
const claims = () => z.array(z.object({ id: z.string(), benefitId: z.string(), label: z.string(), connected: z.boolean(), authentication: z.literal('none').optional(), settings: settings().optional(), settingsInvalid: z.literal(true).optional(), lastRun: z.object({ status: z.string(), count: z.number(), finishedAt: z.string() }).strict().optional() }).strict())
const history = () => z.object({ status: z.enum(['ok', 'failed']), items: z.array(z.object({ status: z.string(), count: z.number().int().nonnegative(), finishedAt: z.string() }).strict()).max(50) }).strict()
const country = () => z.string().regex(/^[A-Z]{2}$/)
const offers = () => z.object({ status: z.enum(['ok', 'failed']), items: z.array(z.object({ title: z.string().max(200), url: z.string().regex(/^https:\/\/store\.epicgames\.com\/en-US\/p\/[A-Za-z0-9/-]+$/), expiresAt: z.string() }).strict()).max(50) }).strict()
const codec = (create) => ({ mode: 'strict', typeSymbol: `${pkg}#safe-value`, create })
const param = (name, create, acceptsUndefined = false) => ({ name, source: 'json', codec: codec(create), strictCodec: codec(create), ...(acceptsUndefined ? { acceptsUndefined: true } : {}) })
const method = (parameters, create) => ({ service: 'eggsPanel', invocation: { kind: 'direct' }, parameters, result: codec(create) })
const info = createTypertRemoteInfo({ package: pkg, methods: {
  'eggsPanel/catalog': method([], catalog),
  'eggsPanel/list': method([], claims),
  'eggsPanel/create': method([param('benefitId', string), param('settings', settings, true)], result),
  'eggsPanel/connect': { ...method([param('id', string)], result), cancellation: { parameter: 'signal' } },
  'eggsPanel/run': { ...method([param('id', string)], result), cancellation: { parameter: 'signal' } },
  'eggsPanel/deleteClaim': method([param('id', string)], result),
  'eggsPanel/freeOffers': method([param('country', country)], offers),
  'eggsPanel/history': method([param('id', string)], history),
  'eggsPanel/updateSettings': method([param('id', string), param('settings', settings)], result),
  'eggsPanel/schedule': method([param('id', string), param('seconds', number)], result),
} }, z)
export const TYPERT = { package: pkg, face: 'host', schemas: [], get invocations() { return info.descriptors }, model: { services: [], events: [], objects: [] } }
