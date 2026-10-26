// Live Okta API resources and cleanup; importing this module performs no provider requests.
import { randomBytes } from 'node:crypto'

class LiveFailure extends Error {}
const check = (condition, label) => { if (!condition) throw new LiveFailure(label) }
const secret = () => randomBytes(32).toString('base64url')
const report = message => console.log(`enterprise-live: ${message}`)
const resources = { users: [], app: null }

function configuration() {
  const origin = new URL(process.env.OKTA_ORG_URL ?? '')
  check(origin.protocol === 'https:' && !origin.username && !origin.password && origin.pathname === '/' && !origin.search && !origin.hash, 'invalid org origin')
  check(process.env.OKTA_API_TOKEN, 'admin API token required')
  check(process.env.LODGE_CHROMIUM && process.env.HOME, 'current headless-shell executable and real HOME required')
  return { origin: origin.origin, token: process.env.OKTA_API_TOKEN }
}

async function okta(config, path, { method = 'GET', body, statuses = [200] } = {}) {
  const response = await fetch(config.origin + path, {
    method, redirect: 'manual', signal: AbortSignal.timeout(30000),
    headers: { accept: 'application/json', authorization: `SSWS ${config.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const raw = await response.text()
  if (!statuses.includes(response.status)) {
    let problem; try { problem = JSON.parse(raw) } catch {}
    const code = /^E[0-9]{7}$/.test(problem?.errorCode) ? ' ' + problem.errorCode : ''
    const summaries = (problem?.errorCauses ?? []).map(cause => cause.errorSummary).filter(value => typeof value === 'string').join(' ')
    const fields = ['name', 'ssoAcsUrl', 'audience', 'subjectNameIdTemplate', 'userNameTemplate', 'credentials', 'signOnMode'].filter(field => new RegExp('\\b' + field + '\\b').test(summaries))
    throw new LiveFailure(`Okta HTTP ${response.status}${code}${fields.length ? ' fields: ' + fields.join(', ') : ''}`)
  }
  return raw ? JSON.parse(raw) : null
}

async function createPerson(config, run, role) {
  const login = `lodge-live-${run}-${role}@example.com`, password = `Aa9!${secret()}`
  const user = await okta(config, '/api/v1/users?activate=true', { method: 'POST', body: {
    profile: { firstName: 'Lodge', lastName: `Live ${role}`, email: login, login }, credentials: { password: { value: password } },
  } })
  check(typeof user?.id === 'string', 'user creation returned no ID')
  resources.users.push(user.id)
  check(user.status === 'ACTIVE', 'temporary user is not active')
  return { id: user.id, login, password, name: `Live ${role}` }
}

async function cleanup(config) {
  let failed = false
  const attempt = async fn => { try { await fn() } catch { failed = true } }
  if (resources.app) await attempt(async () => {
    const path = `/api/v1/apps/${encodeURIComponent(resources.app)}`
    await okta(config, path + '/lifecycle/deactivate', { method: 'POST', statuses: [200, 204, 404] })
    await okta(config, path, { method: 'DELETE', statuses: [200, 204, 404] })
    await okta(config, path, { statuses: [404] })
  })
  await Promise.all(resources.users.map(id => attempt(async () => {
    const path = `/api/v1/users/${encodeURIComponent(id)}`
    let user = await okta(config, path, { statuses: [200, 404] })
    if (user?.id && user.status !== 'DEPROVISIONED') {
      await okta(config, path + '/lifecycle/deactivate?sendEmail=false', { method: 'POST', statuses: [200, 204] })
      for (let poll = 0; poll < 15; poll++) {
        user = await okta(config, path)
        if (user.status === 'DEPROVISIONED') break
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      check(user.status === 'DEPROVISIONED', 'user deactivation incomplete')
    }
    if (user?.id) await okta(config, path + '?sendEmail=false', { method: 'DELETE', statuses: [200, 204] })
    await okta(config, path, { statuses: [404] })
  })))
  check(!failed, 'temporary provider resource cleanup failed')
}

export { LiveFailure, check, configuration, okta, createPerson, resources, secret, report, cleanup }
