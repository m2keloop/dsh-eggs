import { Remote, TypertRemoteService, principalOf } from '@deepseek-ai/dsh-typert-protocol'
import { createEggSchedule } from './scheduler.js'

const names = ['catalog', 'list', 'create', 'connect', 'run', 'schedule', 'deleteClaim', 'freeOffers', 'history', 'updateSettings']
const initializers = []

// This service returns only local metadata and status, never credential material.
export default class EggsPanel extends TypertRemoteService {
  static inject = ['eggs', 'schedule']
  constructor(ctx) { super(ctx, 'eggsPanel'); for (const init of initializers) init.call(this) }
  owner() { if (principalOf(this.ctx.invocation) !== undefined) throw new Error('Owner only') }
  async catalog() { this.owner(); return this.ctx.eggs.listBenefits() }
  async list() { this.owner(); return this.ctx.eggs.list() }
  async history(id) { this.owner(); try { return { status: 'ok', items: await this.ctx.eggs.history(id) } } catch { return { status: 'failed', items: [] } } }
  async updateSettings(id, settings) { this.owner(); try { return await this.ctx.eggs.updateSettings(id, settings) } catch { return { status: 'failed', code: 'SETTINGS_FAILED' } } }
  async freeOffers(country) {
    this.owner()
    try { return { status: 'ok', items: await this.ctx.eggs.listPublicOffers(country) } }
    catch { return { status: 'failed', items: [] } }
  }
  async create(benefitId, settings) {
    this.owner()
    try { return { status: 'created', ...await this.ctx.eggs.create(benefitId, settings) } } catch { return { status: 'failed', code: 'CREATE_FAILED' } }
  }
  async connect(id, signal) { this.owner(); return this.ctx.eggs.connect(id, signal) }
  async run(id, signal) { this.owner(); return this.ctx.eggs.run(id, signal) }
  async deleteClaim(id) { this.owner(); return this.ctx.eggs.remove(id) }
  async schedule(id, seconds) {
    this.owner()
    try { return await createEggSchedule(this.ctx, id, seconds) } catch { return { status: 'failed', code: 'SCHEDULE_CREATE_FAILED' } }
  }
}
for (const method of names) Remote(method)(EggsPanel.prototype[method], { name: method, private: false, static: false, addInitializer(fn) { initializers.push(fn) } })
