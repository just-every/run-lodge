const form = document.querySelector('form')
const error = document.querySelector('#error')
const field = name => form.elements.namedItem(name)
let sourceTab
function ordinary(value) {
  const url = new URL(value)
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) || url.username || url.password) throw new Error('Open an ordinary secure web page first.')
  if (/(^|\.)linkedin\.com$/i.test(url.hostname) || ['mail.google.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com'].includes(url.hostname)) throw new Error('LinkedIn and inbox capture are not supported.')
  url.search = ''; url.hash = ''
  return url
}
async function initialize() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    sourceTab = tab.id
    field('sourceURL').value = ordinary(tab.url).href
  } catch (e) { error.textContent = e.message; form.querySelectorAll('button').forEach(b => { if (b.id !== 'cancel') b.disabled = true }) }
}
document.querySelector('#selection').addEventListener('click', async () => {
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: sourceTab }, func: () => window.getSelection()?.toString() ?? '' })
    field('name').value = String(result).slice(0, 160)
  } catch { error.textContent = 'Select visible text on an ordinary web page, or type the details.' }
})
document.querySelector('#cancel').addEventListener('click', () => { form.reset(); window.close() })
form.addEventListener('submit', async event => {
  event.preventDefault(); error.textContent = ''
  try {
    const installation = ordinary(field('installation').value)
    if (installation.pathname !== '/') throw new Error('Use the installation origin without a page path.')
    const payload = { captureId: crypto.randomUUID(), sourceURL: ordinary(field('sourceURL').value).href }
    for (const name of ['name', 'email', 'phone', 'location', 'headline']) payload[name] = field(name).value
    const target = new URL('/app?capture=1', installation.origin)
    target.hash = 'lodge-capture=' + encodeURIComponent(JSON.stringify(payload))
    await chrome.tabs.create({ url: target.href })
    form.reset(); window.close()
  } catch (e) { error.textContent = e.message }
})
initialize()
