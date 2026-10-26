import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, readdir } from 'node:fs/promises'

const account = 'b20c0ca9cab0c2b70e13d7cf724b89bd'
export async function liveCrmInstallation() {
 for (const key of ['CF_STAGE_TOKEN', 'CF_ROUTING_TOKEN', 'MAIL_API_KEY', 'MAIL_FROM', 'TEST_MAIL_TO']) assert.ok(process.env[key], key + ' required')
 const name = 'lodge-crm-i819-' + Date.now().toString(36), replyAddress = name + '@runeditrun.com'
 const api = async (path, options = {}, routing = false) => {
  const response = await fetch('https://api.cloudflare.com/client/v4/' + path, { ...options, headers: { authorization: 'Bearer ' + process.env[routing ? 'CF_ROUTING_TOKEN' : 'CF_STAGE_TOKEN'], ...options.headers } })
  const value = await response.json()
  if (!response.ok || !value.success) throw Error('Cloudflare request failed: HTTP ' + response.status + ' codes ' + value.errors?.map(e => e.code).join(','))
  return value.result
 }
 const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
 let database, route, zone, worker = false
 const cleanup = async () => {
  if (route) await api('zones/' + zone + '/email/routing/rules/' + route, { method: 'DELETE' }, true)
  if (worker) await api('accounts/' + account + '/workers/scripts/' + name, { method: 'DELETE' })
  if (database) await api('accounts/' + account + '/d1/database/' + database, { method: 'DELETE' })
 }
 try {
  const subdomain = (await api('accounts/' + account + '/workers/subdomain')).subdomain
  const origin = 'https://' + name + '.' + subdomain + '.workers.dev'
  database = (await api('accounts/' + account + '/d1/database', { method: 'POST', ...json({ name }) })).uuid
  for (const migration of (await readdir('./migrations/core')).filter(f => f.endsWith('.sql')).sort()) {
   await api('accounts/' + account + '/d1/database/' + database + '/query', { method: 'POST', ...json({ sql: await readFile('./migrations/core/' + migration, 'utf8') }) })
  }
  const bundle = await build({ entryPoints: ['src/lodge/crm/worker.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', conditions: ['workerd', 'worker', 'browser'], external: ['node:*'], target: 'es2023', logLevel: 'error' })
  const setupToken = crypto.randomUUID() + crypto.randomUUID(), secret = crypto.randomUUID() + crypto.randomUUID()
  const values = { AUTH_ORIGIN: origin, AUTH_LOCAL: 'false', OWNER_EMAIL: process.env.TEST_MAIL_TO, SESSION_SECRET: secret, INSTALLATION_KEY: crypto.randomUUID() + crypto.randomUUID(), SETUP_TOKEN: setupToken, MAIL_PROVIDER: 'sendgrid', MAIL_API_KEY: process.env.MAIL_API_KEY, MAIL_FROM: process.env.MAIL_FROM, CRM_REPLY_ADDRESS: replyAddress }
  const bindings = Object.entries(values).map(([binding, text]) => ({ name: binding, type: ['MAIL_API_KEY', 'SESSION_SECRET', 'INSTALLATION_KEY', 'SETUP_TOKEN'].includes(binding) ? 'secret_text' : 'plain_text', text }))
  bindings.push({ name: 'DB', type: 'd1', id: database })
  const upload = new FormData()
  upload.set('metadata', JSON.stringify({ main_module: 'worker.mjs', compatibility_date: '2026-09-08', compatibility_flags: ['nodejs_compat', 'global_fetch_strictly_public'], bindings }))
  upload.set('worker.mjs', new Blob([bundle.outputFiles[0].text], { type: 'application/javascript+module' }), 'worker.mjs')
  await api('accounts/' + account + '/workers/scripts/' + name, { method: 'PUT', body: upload }); worker = true
  await api('accounts/' + account + '/workers/scripts/' + name + '/subdomain', { method: 'POST', ...json({ enabled: true, previews_enabled: false }) })
  zone = (await api('zones?name=runeditrun.com', {}, true))[0].id
  route = (await api('zones/' + zone + '/email/routing/rules', { method: 'POST', ...json({ name, enabled: true, priority: 0, matchers: [{ type: 'literal', field: 'to', value: replyAddress }], actions: [{ type: 'worker', value: [name] }] }) }, true)).tag
  let cookie = ''
  const send = async (path, body, signed = true) => {
   const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual', headers: { origin, ...(signed ? { cookie } : {}), ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) }, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) })
   const text = await response.text(); let value; try { value = JSON.parse(text) } catch { value = text }
   return { status: response.status, headers: response.headers, text, value }
  }
  let bootstrap
  for (let n = 0; n < 12; n++) {
   bootstrap = await send('/auth/bootstrap', { token: setupToken, displayName: 'Controlled QA owner' }, false)
   if (bootstrap.status === 303) break
   if (![404, 503, 530].includes(bootstrap.status)) break
   await new Promise(resolve => setTimeout(resolve, 5000))
  }
  assert.equal(bootstrap.status, 303, 'The native installation must bootstrap')
  cookie = bootstrap.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const command = async (op, body) => { const r = await send('/api/lodge/command/' + op, body); assert.equal(r.status, 200, op + ' HTTP ' + r.status); return r.value }
  const state = async () => { const r = await send('/api/lodge/state'); assert.equal(r.status, 200); return r.value }
  const view = async () => { const r = await send('/api/lodge/crm?q=Bluebeam'); assert.equal(r.status, 200); return r.value }
  return { name, origin, replyAddress, send, command, state, view, cleanup, async startSchedule() { await api('accounts/' + account + '/workers/scripts/' + name + '/schedules', { method: 'PUT', ...json([{ cron: '* * * * *' }]) }) } }
 } catch (error) { await cleanup(); throw error }
}
