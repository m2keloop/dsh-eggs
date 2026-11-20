import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { startSessionBridge } from '../../experiments/browser-bridge/session-server.js'

export async function createBrowserSession(root, executablePath) {
  const socket = join(root, 'session.sock'), profile = join(root, 'chrome')
  const extension = fileURLToPath(new URL('../../experiments/browser-bridge/', import.meta.url))
  const host = fileURLToPath(new URL('../../experiments/browser-bridge/session-host.js', import.meta.url))
  const session = await startSessionBridge(socket)
  let context
  try {
    context = await chromium.launchPersistentContext(profile, { headless: true, executablePath, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] })
    let worker = context.serviceWorkers()[0]
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 })
    const id = new URL(worker.url()).hostname
    if (!/^[a-p]{32}$/.test(id)) throw new Error('Invalid extension ID')
    const dir = join(profile, 'NativeMessagingHosts'); await mkdir(dir, { recursive: true, mode: 0o700 })
    const launcher = join(root, 'session-launcher.mjs')
    await writeFile(launcher, `#!${process.execPath}\nprocess.env.DSH_EGGS_TEST_SESSION_SOCKET = ${JSON.stringify(socket)}\nawait import(${JSON.stringify(pathToFileURL(host).href)})\n`, { mode: 0o700 })
    await writeFile(join(dir, 'com.dsh_eggs.session.json'), JSON.stringify({ name: 'com.dsh_eggs.session', description: 'Isolated test', path: launcher, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`] }), { mode: 0o600 })
    const page = await context.newPage(); await page.goto(`chrome-extension://${id}/popup.html`)
    await page.getByRole('button', { name: '测试接收任务' }).click()
    await page.getByText('已连接，等待测试任务。').waitFor({ timeout: 10000 })
    return { session, async close() { await context.close(); await session.close() } }
  } catch (error) { if (context) await context.close(); await session.close(); throw error }
}
