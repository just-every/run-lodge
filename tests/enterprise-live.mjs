// Opt-in live Okta proof. Run only through the owner's credential injector.
// Okta authentication is real. SCIM requests below are sent by this harness;
// this does not establish Okta-originated provisioning delivery.
import { randomBytes } from 'node:crypto'
import { chromium } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { businessHarness } from './harness.mjs'
import { LiveFailure, check, configuration, okta, createPerson, resources, secret, report, cleanup } from './enterprise-live-provider.mjs'
import { signIn } from './enterprise-live-browser.mjs'

let stage = 'configuration'

function appDefinition(label, callback) {
  return { name: 'oidc_client', label, signOnMode: 'OPENID_CONNECT',
    credentials: { oauthClient: { token_endpoint_auth_method: 'client_secret_basic' } },
    settings: { oauthClient: { application_type: 'web', redirect_uris: [callback], response_types: ['code'], grant_types: ['authorization_code'], consent_method: 'TRUSTED' } } }
}

async function scim(h, token, path, { method = 'GET', body, statuses = [200] } = {}) {
  const response = await h.mf.dispatchFetch(h.origin + '/scim/v2/' + path, { method, redirect: 'manual', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/scim+json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  check(statuses.includes(response.status), `SCIM HTTP ${response.status}`)
  return response.status === 204 ? null : response.json()
}

async function openJob(h) {
  const vacancy = await h.command('vacancy', { title: 'Live enterprise referral role', manager: 'owner@example.test', location: 'New York, NY', headcount: 1, description: 'Coordinate safe construction work.', compensation: { currency: 'USD', min: 8000000, max: 10000000, period: 'year' } })
  await h.command('rubric', { id: vacancy.id, criteria: [{ name: 'Safety', description: 'Evidence of safe site work' }] })
  await h.command('interview-plan', { id: vacancy.id, plan: [{ name: 'Site walk', stageName: 'Interview', durationMinutes: 45 }] })
  const request = await h.command('request-vacancy-approval', { id: vacancy.id, approver: 'owner@example.test' })
  const approval = (await h.state()).approvals.find(a => a.id === request.id)
  await h.command('decide-approval', { id: request.id, version: approval.currentVersion, decision: 'approved', reason: 'Live journey plan reviewed' })
  return h.command('publish', { id: vacancy.id })
}

async function deprovision(h, config, token, person, cookie) {
  // Provider suspension is real and happens first. There is deliberately no
  // claim that it pushes to this fixture: the SCIM request is explicit below.
  await okta(config, `/api/v1/users/${encodeURIComponent(person.id)}/lifecycle/suspend`, { method: 'POST', statuses: [200, 204] })
  const suspended = await okta(config, `/api/v1/users/${encodeURIComponent(person.id)}`)
  check(suspended.status === 'SUSPENDED', 'provider suspension not witnessed')
  const local = await scim(h, token, `Users/${encodeURIComponent(person.id)}`, { method: 'PATCH', body: { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', value: { active: false } }] } })
  check(local.active === false, 'local deprovision not witnessed')
  check((await h.send('/auth/session', undefined, cookie)).status === 401, 'old native session remains usable')
  check((await h.send('/api/lodge/state', undefined, cookie)).status === 401, 'old Lodge access remains usable')
}

async function main() {
  const config = configuration(), run = `${Date.now()}-${randomBytes(5).toString('hex')}`
  let h, browser, failure
  try {
    stage = 'isolated browser launch'
    // Inherit the real process HOME. No Chrome channel, persistent profile,
    // owner browser session, saved cookies, tracing or screenshots are used.
    browser = await chromium.launch({ headless: true, executablePath: process.env.LODGE_CHROMIUM, args: ['--use-mock-keychain', '--password-store=basic'] })
    stage = 'temporary provider resources'
    const appBody = appDefinition(`Lodge live ${run}`, 'http://127.0.0.1:1/auth/oidc/lodge-okta/callback')
    const app = await okta(config, '/api/v1/apps?activate=true', { method: 'POST', body: appBody })
    check(typeof app?.id === 'string', 'application creation returned no ID'); resources.app = app.id
    check(app.credentials?.oauthClient?.client_id && app.credentials?.oauthClient?.client_secret, 'application client credentials absent')
    // allSettled ensures every successfully created resource is recorded before
    // finally starts cleanup, even if the other concurrent request fails.
    const people = await Promise.allSettled(['recruiter', 'employee'].map(role => createPerson(config, run, role)))
    check(people.every(p => p.status === 'fulfilled'), 'temporary user creation failed')
    const [recruiter, employee] = people.map(p => p.value), token = secret()
    stage = 'local installation'
    h = await businessHarness({ bindings: { ENTERPRISE_OKTA_ISSUER: config.origin, ENTERPRISE_OKTA_CLIENT_ID: app.credentials.oauthClient.client_id, ENTERPRISE_OKTA_CLIENT_SECRET: app.credentials.oauthClient.client_secret, ENTERPRISE_OIDC_SECRET: secret(), ENTERPRISE_SCIM_TOKEN: token } })
    await okta(config, `/api/v1/apps/${encodeURIComponent(app.id)}`, { method: 'PUT', body: {
      ...app,
      settings: { ...app.settings, oauthClient: { ...app.settings.oauthClient, redirect_uris: [h.origin + '/auth/oidc/lodge-okta/callback'] } },
    } })
    const settings = await h.send('/enterprise/settings', { enabled: true }, h.owner)
    check(settings.status === 200 && settings.value.enabled === true, 'owner enablement failed')
    stage = 'public SCIM provisioning'
    check((await h.send('/scim/v2/Users')).status === 401, 'SCIM accepted an unauthenticated request')
    for (const person of [recruiter, employee]) {
      await okta(config, `/api/v1/apps/${encodeURIComponent(app.id)}/users`, { method: 'POST', body: { id: person.id } })
      const provisioned = await scim(h, token, 'Users', { method: 'POST', statuses: [201], body: { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], externalId: person.id, userName: person.login, displayName: person.name, active: true } })
      check(provisioned.id === person.id && provisioned.active === true, 'SCIM identity was not preserved')
      const found = await scim(h, token, 'Users?' + new URLSearchParams({ filter: `userName eq "${person.login}"`, startIndex: '1', count: '100' }))
      check(found.totalResults === 1 && found.Resources[0].id === person.id, 'SCIM unique filter failed')
    }
    await h.command('member', { email: recruiter.login, name: recruiter.name, roles: ['manager'] })
    stage = 'live recruiter authentication'
    const recruiterCookie = await signIn(browser, h, config, recruiter)
    stage = 'live employee authentication'
    const employeeCookie = await signIn(browser, h, config, employee)
    report('real Okta authorization-code callbacks issued native recruiter and employee sessions')
    stage = 'owned task and frozen referral creation'
    const task = await h.command('task', { kind: 'task', owner: recruiter.login, note: 'Review the staffing plan', due: '2027-04-01' }, recruiterCookie)
    check((await h.state(recruiterCookie)).tasks.some(t => t.id === task.id && t.owner === recruiter.login), 'owned task not visible')
    const vacancy = await openJob(h), resume = Buffer.from('Consented original referral resume for live lifecycle proof').toString('base64')
    const referral = await h.command('referral-submit', { vacancy: vacancy.id, name: 'Live Referral Candidate', email: `lodge-referral-${run}@example.test`, confirmed: true, consentNote: 'Candidate expressly agreed to this referral and sharing this resume.', resume: { name: 'original.txt', mediaType: 'text/plain', base64: resume } }, employeeCookie)
    const frozen = (await h.state(employeeCookie)).referrals.submissions.find(r => r.id === referral.id)
    check(frozen?.files?.length === 1, 'frozen referral original absent')
    stage = 'provider suspension and explicit local SCIM deprovision'
    await deprovision(h, config, token, recruiter, recruiterCookie)
    await deprovision(h, config, token, employee, employeeCookie)
    const after = await h.state(), reassigned = after.tasks.find(t => t.id === task.id)
    check(reassigned?.owner === 'owner@example.test' && reassigned.createdBy === recruiter.login && reassigned.history.some(e => e.from === recruiter.login && e.to === 'owner@example.test'), 'task ownership and history did not survive deprovision')
    const review = after.referralReviews.find(r => r.id === referral.id)
    check(review, 'referral submission history was removed')
    check((await h.send('/api/lodge/referral/export', undefined, employeeCookie)).status !== 200, 'suspended employee export remains accessible')
    check((await h.send('/api/lodge/referral/file/' + frozen.files[0].id, undefined, employeeCookie)).status !== 200, 'suspended employee resume remains accessible')
    // Owner reconciliation and export proves originals remain usable after the
    // submitter's access is revoked, without reading fixture internals.
    const accepted = await h.command('referral-review', { id: referral.id, outcome: 'accepted', reason: 'Permission and original resume reviewed after submitter suspension' })
    const exported = await h.send('/api/lodge/download/candidate/' + accepted.candidate, undefined, h.owner)
    check(exported.status === 200 && exported.value.referrals.some(r => r.id === referral.id && r.files.some(f => f.base64 === resume)), 'frozen referral original did not survive deprovision')
    report('provider suspension followed by explicit SCIM deprovision revoked both sessions; task history and frozen referral originals survived')
    report('scope: SCIM requests were harness-originated; Okta-originated provisioning push remains unproven')
  } catch (error) { failure = stage + (error instanceof LiveFailure ? ` (${error.message})` : '') } finally {
    try { await cleanup(config); report('temporary Okta application and users deleted; absence verified') } catch { failure = failure ? `${failure}; cleanup` : 'cleanup'; report('FAILED temporary provider cleanup') }
    try { await browser?.close() } catch { failure = failure ? `${failure}; browser cleanup` : 'browser cleanup' }
    try { await h?.close() } catch { failure = failure ? `${failure}; local cleanup` : 'local cleanup' }
  }
  if (failure) { report(`FAILED at ${failure}`); process.exitCode = 1 }
  else report('PASS')
}

// Never print provider bodies, raw exceptions, passwords, session tokens,
// cookies, temporary user email addresses, or client and admin credentials.
export { LiveFailure, configuration, okta, createPerson, resources, secret, report, cleanup, signIn }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { report(`FAILED at ${stage}`); process.exitCode = 1 })
}
