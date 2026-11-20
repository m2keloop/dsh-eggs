'use strict'
const status = document.getElementById('status')
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
    const login = { yes: '已登录', no: '未登录', unknown: '无法确认登录状态' }[value.loggedIn]
    status.textContent = `${login}；领取按钮：${value.getVisible ? '可见' : '未发现'}；已在库标记：${value.libraryVisible ? '可见' : '未发现'}；安全验证：${value.challengeVisible ? '可见' : '未发现'}。`
  } catch { status.textContent = '检查失败，请在当前标签页打开 Epic 官方页面后重试。' }
  finally { inspect.disabled = false }
})
