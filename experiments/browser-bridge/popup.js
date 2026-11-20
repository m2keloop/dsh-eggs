'use strict'
const button = document.getElementById('ping')
const status = document.getElementById('status')
button.addEventListener('click', async () => {
  button.disabled = true
  status.textContent = '正在连接本地程序…'
  try {
    const reply = await chrome.runtime.sendNativeMessage('com.dsh_eggs.bridge', { type: 'ping', version: 1 })
    status.textContent = reply?.type === 'pong' && reply?.version === 1 ? '本地连接正常。这个实验尚不能登录或领取。' : '本地程序返回了无法识别的结果。'
  } catch {
    status.textContent = '连接失败：请检查实验扩展及本地通信程序是否已配置。'
  } finally { button.disabled = false }
})
const push = document.getElementById('push')
push.addEventListener('click', async () => {
  push.disabled = true
  status.textContent = '正在建立本地测试连接…'
  try {
    const result = await chrome.runtime.sendMessage({ type: 'start_probe' })
    status.textContent = result?.status === 'ready' ? '已连接，等待测试任务。' : '连接失败：请检查实验程序是否已配置。'
  } catch { status.textContent = '连接失败：请检查实验程序是否已配置。' }
  finally { push.disabled = false }
})
const inspect = document.getElementById('inspect')
inspect.addEventListener('click', async () => {
  inspect.disabled = true
  status.textContent = '正在检查当前页面…'
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const url = new URL(tab?.url || '')
    if (url.protocol !== 'https:' || !['store.epicgames.com', 'www.epicgames.com'].includes(url.hostname) || url.username || url.password || !Number.isInteger(tab.id)) {
      status.textContent = '请先在当前标签页打开 Epic 官方页面。'
      return
    }
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
      if (location.protocol !== 'https:' || !['store.epicgames.com', 'www.epicgames.com'].includes(location.hostname)) return { allowed: false }
      const raw = document.querySelector('egs-navigation')?.getAttribute('isloggedin')
      const panels = Array.from(document.querySelectorAll('section[class*="_sidebar_"]'))
      const buttons = panels.flatMap(panel => Array.from(panel.querySelectorAll('button'))).map(node => (node.innerText || '').trim().toLowerCase())
      return {
        allowed: true,
        loggedIn: raw === 'true' ? 'yes' : raw === 'false' ? 'no' : 'unknown',
        getVisible: buttons.includes('get'),
        libraryVisible: buttons.includes('in library'),
        challengeVisible: Boolean(document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[src*="hcaptcha.com"], iframe[src*="recaptcha"]')),
      }
    } })
    const value = result?.result
    if (!value?.allowed || !['yes', 'no', 'unknown'].includes(value.loggedIn) || typeof value.getVisible !== 'boolean' || typeof value.libraryVisible !== 'boolean' || typeof value.challengeVisible !== 'boolean') {
      status.textContent = '无法确认当前页面状态。'; return
    }
    // Register only this user-invoked tab; a closed or cross-origin tab fails closed.
    await chrome.runtime.sendMessage({ type: 'register_tab', tabId: tab.id })
    const login = { yes: '已登录', no: '未登录', unknown: '无法确认登录状态' }[value.loggedIn]
    status.textContent = `${login}；领取按钮：${value.getVisible ? '可见' : '未发现'}；已在库标记：${value.libraryVisible ? '可见' : '未发现'}；安全验证：${value.challengeVisible ? '可见' : '未发现'}。`
  } catch { status.textContent = '检查失败，请在当前标签页打开 Epic 官方页面后重试。' }
  finally { inspect.disabled = false }
})
