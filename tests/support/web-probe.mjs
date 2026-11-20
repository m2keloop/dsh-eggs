import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

// A fresh DSH_HOME and a fresh browser context must be supplied by the caller.
// Only fixed flags are emitted; never return page contents or local URLs.
const binary = process.env.DSH_EGGS_TEST_DSH_BIN
const browserPath = process.env.DSH_EGGS_TEST_BROWSER
if (!binary || !browserPath || !process.env.DSH_HOME) throw new Error('Missing isolated test configuration')
const demo = process.env.DSH_EGGS_TEST_DEMO === '1'
const args = [binary, '--profile', 'web', ...(process.env.DSH_EGGS_TEST_DEMO_PATCH ? ['--patch', process.env.DSH_EGGS_TEST_DEMO_PATCH] : []), '--port', '0', '--no-open']
const processHandle = spawn(process.execPath, args, { env: process.env })
let output = '', browser, page, stage = 'host'
processHandle.stdout.on('data', value => { output += value.toString(); if (output.length > 500_000) output = output.slice(-500_000) })
processHandle.stderr.on('data', value => { output += value.toString(); if (output.length > 500_000) output = output.slice(-500_000) })
try {
  let url
  for (let i = 0; i < 150 && !url; i++) {
    await new Promise(resolve => setTimeout(resolve, 200))
    url = output.match(/dsh web:\s*(https?:\/\/[^\s]+)/)?.[1]
  }
  if (!url) throw new Error('Host did not start')
  stage = 'browser'
  browser = await chromium.launch({ headless: true, executablePath: browserPath })
  page = await browser.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
  await page.waitForTimeout(3000)
  const welcome = page.getByRole('dialog').getByRole('button', { name: /^(继续|Continue)$/ })
  if (await welcome.first().isVisible().catch(() => false)) await welcome.first().click()
  const later = page.getByRole('button', { name: /^(稍后配置|Configure later)$/ })
  await later.first().waitFor({ state: 'visible', timeout: 2000 }).catch(() => {})
  if (await later.first().isVisible().catch(() => false)) await later.first().click()
  const close = page.getByRole('button', { name: '关闭', exact: true })
  if (await close.first().isVisible().catch(() => false)) await close.first().click()
  stage = 'account-menu'
  await page.getByRole('button', { name: '账号菜单' }).click({ timeout: 10000 })
  stage = 'settings-choice'
  await page.getByRole('menuitem', { name: /^设置/ }).click({ timeout: 10000 })
  stage = 'panel'
  await page.getByText('福利领取', { exact: true }).first().click({ timeout: 15000 })
  const before = await page.locator('[data-claim-id]').count()
  if (demo) {
    const card = page.getByText('合成测试福利', { exact: true }).locator('..')
    await card.getByLabel('测试地区').selectOption('US')
    await card.getByRole('button', { name: '添加', exact: true }).click({ timeout: 10000 })
  } else await page.getByRole('button', { name: '添加', exact: true }).click({ timeout: 10000 })
  await page.waitForFunction(n => document.querySelectorAll('[data-claim-id]').length === n + 1, before, { timeout: 10000 })
  const row = page.locator('[data-claim-id]').last()
  if (demo) {
    stage = 'connect'
    await row.getByRole('button', { name: '连接 / 重新登录', exact: true }).click({ timeout: 10000 })
    await page.getByRole('status').filter({ hasText: '已保存登录会话' }).waitFor({ timeout: 10000 })
  }
  stage = 'run'
  await row.getByRole('button', { name: '立即领取', exact: true }).click({ timeout: 10000 })
  await page.getByRole('status').filter({ hasText: demo ? /领取结果已核验/ : /登录状态失效/ }).waitFor({ timeout: 10000 })
  stage = 'history'
  await row.getByRole('button', { name: '查看执行记录', exact: true }).click({ timeout: 10000 })
  await page.getByRole('status').filter({ hasText: '已读取本地执行记录。' }).waitFor({ timeout: 10000 })
  const history = await row.getByText(demo ? /领取结果已核验/ : /登录状态失效/).count() > 0
  if (demo) {
    stage = 'update-settings'
    await row.getByLabel('测试地区').selectOption('CN')
    await row.getByRole('button', { name: '保存福利设置', exact: true }).click({ timeout: 10000 })
    await page.getByRole('status').filter({ hasText: '福利设置已保存。' }).waitFor({ timeout: 10000 })
  }
  stage = 'schedule'
  await row.getByRole('button', { name: '每 24 小时领取', exact: true }).click({ timeout: 10000 })
  await page.getByRole('status').filter({ hasText: /已创建|任务已存在/ }).waitFor({ timeout: 10000 })
  stage = 'delete'
  page.once('dialog', dialog => dialog.accept())
  await row.getByRole('button', { name: '删除配置', exact: true }).click({ timeout: 10000 })
  await page.waitForFunction(n => document.querySelectorAll('[data-claim-id]').length === n, before, { timeout: 10000 })
  const state = { hostStarted: true, panel: true, created: true, ...(demo ? { connected: true, verified: true, settingsUpdated: true } : { authRequired: true }), history, schedule: true, deleted: true }
  process.stdout.write(JSON.stringify(state) + '\n')
} catch {
  const diagnostics = page ? {
    accountMenu: await page.getByRole('button', { name: '账号菜单' }).count().catch(() => 0),
    menuVisible: await page.getByRole('button', { name: '账号菜单' }).isVisible().catch(() => false),
    menuEnabled: await page.getByRole('button', { name: '账号菜单' }).isEnabled().catch(() => false),
    menuItems: await page.getByRole('menuitem').count().catch(() => 0),
    settingsText: await page.getByText(/设置|settings/i).count().catch(() => 0),
    dialogs: await page.getByRole('dialog').count().catch(() => 0),
    welcomeText: await page.getByText(/欢迎|welcome|开始使用/i).count().catch(() => 0),
  } : {}
  process.stdout.write(JSON.stringify({ ok: false, stage, ...diagnostics }) + '\n'); process.exitCode = 1
}
finally { if (browser) await browser.close(); processHandle.kill('SIGKILL') }
