import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { startLocalBridge } from '../experiments/browser-bridge/local-server.js'
import { startSessionBridge } from '../experiments/browser-bridge/session-server.js'

// Chromium for Testing 146+ discovers native hosts in the isolated user-data dir.
test('isolated browser extension can ping only when its native origin is allowed', { skip: !process.env.DSH_EGGS_TEST_CHROMIUM_CFT || process.platform === 'win32', timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'eb-'))
  const profile = join(root, 'profile')
  const extension = fileURLToPath(new URL('../experiments/browser-bridge/', import.meta.url))
  const host = fileURLToPath(new URL('../experiments/browser-bridge/native-host.js', import.meta.url))
  const sessionHost = fileURLToPath(new URL('../experiments/browser-bridge/session-host.js', import.meta.url))
  let context, stop, session, pings = 0
  try {
    const socket = join(root, 'bridge.sock')
    stop = await startLocalBridge(socket, { onPing: () => { pings++ } })
    const sessionSocket = join(root, 'session.sock')
    session = await startSessionBridge(sessionSocket)
    context = await chromium.launchPersistentContext(profile, {
      headless: true, executablePath: process.env.DSH_EGGS_TEST_CHROMIUM_CFT,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    })
    let worker = context.serviceWorkers()[0]
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 })
    const id = new URL(worker.url()).hostname
    assert.match(id, /^[a-p]{32}$/)
    const hostDir = join(profile, 'NativeMessagingHosts')
    await mkdir(hostDir, { recursive: true, mode: 0o700 })
    const launcher = join(root, 'launcher.mjs')
    await writeFile(launcher, `#!${process.execPath}\nprocess.env.DSH_EGGS_TEST_BRIDGE_SOCKET = ${JSON.stringify(socket)}\nawait import(${JSON.stringify(pathToFileURL(host).href)})\n`, { mode: 0o700 })
    const file = join(hostDir, 'com.dsh_eggs.bridge.json')
    const manifest = { name: 'com.dsh_eggs.bridge', description: 'Isolated test', path: launcher, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`] }
    await writeFile(file, JSON.stringify(manifest), { mode: 0o600 })
    const page = await context.newPage()
    await page.goto(`chrome-extension://${id}/popup.html`)
    const button = page.getByRole('button', { name: '测试本地连接' })
    await button.click()
    await page.getByText('本地连接正常。这个实验尚不能登录或领取。').waitFor({ timeout: 10000 })
    assert.equal(pings, 1)
    manifest.allowed_origins = ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/']
    await writeFile(file, JSON.stringify(manifest), { mode: 0o600 })
    await button.click()
    await page.getByText('连接失败：请检查实验扩展及本地通信程序是否已配置。').waitFor({ timeout: 10000 })
    assert.equal(pings, 1)
    const sessionLauncher = join(root, 'session-launcher.mjs')
    await writeFile(sessionLauncher, `#!${process.execPath}\nprocess.env.DSH_EGGS_TEST_SESSION_SOCKET = ${JSON.stringify(sessionSocket)}\nawait import(${JSON.stringify(pathToFileURL(sessionHost).href)})\n`, { mode: 0o700 })
    await writeFile(join(hostDir, 'com.dsh_eggs.session.json'), JSON.stringify({ name: 'com.dsh_eggs.session', description: 'Isolated session test', path: sessionLauncher, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`] }), { mode: 0o600 })
    await page.getByRole('button', { name: '测试接收任务' }).click()
    await page.getByText('已连接，等待测试任务。').waitFor({ timeout: 10000 })
    assert.equal(await session.probe(), true)
    assert.deepEqual(await session.inspect(), { status: 'unavailable' })
  } finally { if (context) await context.close(); if (session) await session.close(); if (stop) await stop(); await rm(root, { recursive: true, force: true }) }
})
