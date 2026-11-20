'use strict'
// Serialized into the user-authorized current tab; it returns fixed flags only.
function inspectEpicPage() {
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
}
