'use strict'
importScripts('inspect.js')
let port, authorizedTabId
function allowed(url) {
  try { const value = new URL(url); return value.protocol === 'https:' && !value.username && !value.password && ['store.epicgames.com', 'www.epicgames.com'].includes(value.hostname) } catch { return false }
}
function safeFlags(value) {
  return value && value.allowed === true && ['yes', 'no', 'unknown'].includes(value.loggedIn) && typeof value.getVisible === 'boolean' && typeof value.libraryVisible === 'boolean' && typeof value.challengeVisible === 'boolean'
}
async function inspectCurrent() {
  if (!Number.isInteger(authorizedTabId)) return null
  const tab = await chrome.tabs.get(authorizedTabId)
  if (!allowed(tab.url)) { authorizedTabId = undefined; return null }
  const [entry] = await chrome.scripting.executeScript({ target: { tabId: authorizedTabId }, func: inspectEpicPage })
  const value = entry?.result
  if (!safeFlags(value)) return null
  return { loggedIn: value.loggedIn, getVisible: value.getVisible, libraryVisible: value.libraryVisible, challengeVisible: value.challengeVisible }
}
// A browser-originated message may only come from this extension's own popup.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html') || !message) return false
  if (Object.keys(message).sort().join(',') === 'tabId,type' && message.type === 'register_tab' && Number.isInteger(message.tabId)) {
    chrome.tabs.get(message.tabId).then(tab => { if (allowed(tab.url)) { authorizedTabId = message.tabId; respond({ status: 'ready' }) } else respond({ status: 'failed' }) }).catch(() => respond({ status: 'failed' }))
    return true
  }
  if (Object.keys(message).join(',') !== 'type' || message.type !== 'start_probe') return false
  if (port) { respond({ status: 'ready' }); return false }
  let replied = false
  const finish = value => { if (!replied) { replied = true; respond(value) } }
  try {
    port = chrome.runtime.connectNative('com.dsh_eggs.session')
    const current = port
    current.onMessage.addListener(value => {
      if (value && Object.keys(value).sort().join(',') === 'type,version' && value.type === 'ready' && value.version === 1) { finish({ status: 'ready' }); return }
      if (value && Object.keys(value).sort().join(',') === 'id,type,version' && value.version === 1 && /^[a-f0-9-]{36}$/.test(value.id)) {
        if (value.type === 'probe') { current.postMessage({ type: 'ack', version: 1, id: value.id }); return }
        if (value.type === 'inspect') {
          const send = flags => { try { current.postMessage(flags ? { type: 'inspect_result', version: 1, id: value.id, status: 'ok', ...flags } : { type: 'inspect_result', version: 1, id: value.id, status: 'unavailable' }) } catch { /* The native channel has closed. */ } }
          void inspectCurrent().then(send, () => send(null))
          return
        }
      }
      current.disconnect()
    })
    current.onDisconnect.addListener(() => { if (port === current) port = undefined; finish({ status: 'failed' }) })
    return true
  } catch { port = undefined; finish({ status: 'failed' }); return false }
})
