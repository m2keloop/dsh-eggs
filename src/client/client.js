// DSH lazy client bundle: no cookies, passwords or account identifiers enter this UI.
window.__ModuleLoader__.load({ id: 'dsh-eggs-p0', factory: require => {
  const React = require('react')
  const h = React.createElement
  const codec = { mode: 'strict', typeSymbol: 'dsh-eggs-p0#safe-value', create: () => undefined }
  const parameters = { catalog: [], list: [], create: ['benefitId'], connect: ['id'], run: ['id'], schedule: ['id', 'seconds'], deleteClaim: ['id'], freeOffers: ['country'] }
  const contribution = { package: 'dsh-eggs-p0', descriptors: Object.entries(parameters).map(([method, args]) => ({
    id: `dsh-eggs-p0#eggsPanel/${method}`, namespace: 'eggsPanel', service: 'eggsPanel', method,
    invocation: { kind: 'direct' }, parameters: args.map(name => ({ name, wire: name, source: 'json', codec })), result: codec,
    ...(['connect', 'run'].includes(method) ? { cancellation: { parameter: 'signal' } } : {}),
  })) }
  const messages = {
    ready: '已保存登录会话。有效性将在执行时再次检查。', created: '已创建。', already_exists: '相同周期的任务已存在，可在 DSH 任务页面管理。', deleted: '配置及其本地会话已删除；请在 DSH 任务页面删除关联定时任务。', success: '领取结果已核验。',
    no_offers: '当前没有符合条件的免费游戏。', unknown: '无法确认领取结果，请在 Epic 游戏库核验。',
    user_action_required: '领取需要人工处理，请打开 Epic 商城检查提示和订单。',
    auth_required: '登录状态失效，需要重新连接。', access_blocked: 'Epic 暂时拒绝访问，请稍后重试。',
    key_unavailable: '系统凭据库不可用，请解锁后重试。', failed: '操作未完成，请稍后重试。',
    KEY_UNAVAILABLE: '系统凭据库不可用，请解锁后重试。', AUTH_REQUIRED: '未能确认登录，请重新尝试。',
    ACCESS_BLOCKED: 'Epic 暂时拒绝访问，请稍后重试。', ACCOUNT_MISMATCH: '登录的账号与此配置原来的账号不同，请新建配置。',
    CHALLENGE_REQUIRED: 'Epic 安全验证未完成，请使用日常浏览器处理；当前自动浏览器可能不被支持。',
    invalid_country: '请输入两位英文字母的国家或地区代码。', offers_ready: '已更新当前免费游戏。',
  }
  function Panel({ api }) {
    const [benefits, setBenefits] = React.useState([])
    const [claims, setClaims] = React.useState([])
    const [busy, setBusy] = React.useState(false)
    const [status, setStatus] = React.useState('')
    const [country, setCountry] = React.useState('')
    const [offers, setOffers] = React.useState(null)
    const refresh = React.useCallback(async () => {
      const [a, b] = await Promise.all([api.catalog(), api.list()])
      if (!a.ok || !b.ok) { setStatus('无法读取本地福利配置。'); return }
      setBenefits(a.value); setClaims(b.value)
    }, [api])
    React.useEffect(() => { void refresh().catch(() => setStatus('无法连接本地插件。')) }, [refresh])
    const perform = async (operation, notice) => {
      setBusy(true); setStatus(notice || '')
      try {
        const response = await operation()
        if (!response.ok) setStatus('无法连接本地插件。')
        else { setStatus(messages[response.value.code] || messages[response.value.status] || '操作未完成，请稍后重试。'); await refresh() }
      } catch { setStatus('操作未完成，请稍后重试。') }
      finally { setBusy(false) }
    }
    const button = (label, action) => h('button', { type: 'button', disabled: busy, onClick: action, style: { marginRight: '8px', marginTop: '8px' } }, label)
    return h('section', { style: { padding: '24px', maxWidth: '760px', lineHeight: 1.6 } },
      h('h2', null, '福利领取'),
      h('p', null, '实验版本：插件的 Epic 登录和自动领取尚未打通，请勿用于真实账号。'),
      h('p', null, '登录和执行在运行 DSH 的电脑上进行；会话快照加密存放在本地。'),
      h('p', null, h('a', { href: 'https://store.epicgames.com/zh-CN/free-games', target: '_blank', rel: 'noopener noreferrer' }, '在浏览器中打开 Epic 免费游戏')),
      h('h3', null, '当前免费游戏'),
      h('p', null, '输入两位国家或地区代码查询，显示结果不代表你的账号一定符合领取条件。'),
      h('input', { value: country, placeholder: '例如 CN 或 US', maxLength: 2, disabled: busy, 'aria-label': '国家或地区代码', onChange: event => { setCountry(event.target.value.toUpperCase()); setOffers(null) } }),
      button('查询', () => { void perform(async () => {
        if (!/^[A-Z]{2}$/.test(country)) return { ok: true, value: { status: 'invalid_country' } }
        const response = await api.freeOffers(country)
        if (!response.ok) { setOffers(null); return response }
        setOffers(response.value.status === 'ok' ? response.value.items : null)
        return { ok: true, value: { status: response.value.status === 'ok' ? 'offers_ready' : 'failed' } }
      }) }),
      offers && offers.length === 0 ? h('p', null, '当前未发现符合条件的限时免费游戏。') : null,
      ...(offers || []).map((offer, index) => h('p', { key: index }, h('a', { href: offer.url, target: '_blank', rel: 'noopener noreferrer' }, offer.title || 'Epic 免费游戏'), ` · 截止：${new Date(offer.expiresAt).toLocaleString()}`)),
      h('h3', null, '福利目录'),
      ...benefits.map(item => h('div', { key: item.id }, h('span', null, item.name), button('添加', () => perform(() => api.create(item.id))))),
      h('h3', null, '我的领取配置'),
      claims.length === 0 ? h('p', null, '还没有配置。') : null,
      ...claims.map(item => h('div', { key: item.id, 'data-claim-id': item.id, style: { borderBottom: '1px solid #8885', padding: '12px 0' } },
        h('strong', null, item.label), h('p', null, item.connected ? '已保存会话（尚未检查是否有效）' : '尚未连接'),
        item.lastRun ? h('p', null, `最近执行：${new Date(item.lastRun.finishedAt).toLocaleString()} · ${messages[item.lastRun.status] || '状态未知'}`) : null,
        button('连接 / 重新登录', () => perform(() => api.connect(item.id), '请在打开的 Epic 官方页面中登录；完成后返回此处。')),
        button('立即领取', () => perform(() => api.run(item.id), '正在检查领取状态，请稍候。')),
        button('每 24 小时领取', () => perform(() => api.schedule(item.id, 86400), '正在创建 DSH 原生任务。')),
        button('删除配置', () => { if (window.confirm('删除此配置及其本地登录会话？已创建的 DSH 定时任务需要在任务页面另行删除。')) void perform(() => api.remove(item.id)) }))),
      h('p', { role: 'status', 'aria-live': 'polite' }, status),
      h('p', null, '定时任务可在 DSH 的任务页面管理；DSH 运行且模型调用领取工具时才会执行。'))
  }
  async function apply(ctx) {
    const disposeRemote = await ctx.remote.$mount(contribution)
    const ui = ctx.inject(['remote.eggsPanel'], scope => {
      const api = {
        catalog: () => scope.remote.eggsPanel.catalog(), list: () => scope.remote.eggsPanel.list(),
        create: id => scope.remote.eggsPanel.create(id), connect: id => scope.remote.eggsPanel.connect(id),
        run: id => scope.remote.eggsPanel.run(id), schedule: (id, seconds) => scope.remote.eggsPanel.schedule(id, seconds),
        remove: id => scope.remote.eggsPanel.deleteClaim(id),
        freeOffers: country => scope.remote.eggsPanel.freeOffers(country),
      }
      scope.slots.inject('settings.section', () => scope.slots.register({
        name: 'settings.section', id: 'eggs', order: 20, label: () => '福利领取', inject: () => ({ api }),
      }, Panel))
    })
    try { await ui } catch (error) { await ui.dispose(); await disposeRemote(); throw error }
    return async () => { await ui.dispose(); await disposeRemote() }
  }
  return { inject: ['slots', 'remote'], apply }
} })
