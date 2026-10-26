import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { businessHarness } from './harness.mjs'

export const enterpriseBindings = { ENTERPRISE_OKTA_ISSUER: 'https://synthetic-lodge.okta.com', ENTERPRISE_OKTA_CLIENT_ID: 'synthetic-lodge-1', ENTERPRISE_OKTA_CLIENT_SECRET: 'synthetic-lodge-2', ENTERPRISE_OIDC_SECRET: 'synthetic-lodge-3-independent-transaction-secret', ENTERPRISE_SCIM_TOKEN: 'synthetic-lodge-4-provisioning-credential', MAIL_PROVIDER: 'sendgrid', MAIL_API_KEY: 'synthetic-lodge-10' }

export async function enterpriseFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const issuer = enterpriseBindings.ENTERPRISE_OKTA_ISSUER, edge = { subject: 'synthetic-lodge-5', nonce: '', audience: enterpriseBindings.ENTERPRISE_OKTA_CLIENT_ID }
  const key = { ...publicKey.export({ format: 'jwk' }), kid: 'synthetic-lodge-6', alg: 'RS256', use: 'sig' }
  const h = await businessHarness({ bindings: enterpriseBindings, outboundService: async request => {
    const url = new URL(request.url)
    if (url.origin !== issuer) return new Response('Unexpected provider', { status: 502 })
    if (url.pathname === '/.well-known/openid-configuration') return Response.json({ issuer, authorization_endpoint: issuer + '/oauth2/v1/authorize', token_endpoint: issuer + '/oauth2/v1/token', jwks_uri: issuer + '/oauth2/v1/keys', response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_basic'], code_challenge_methods_supported: ['S256'], authorization_response_iss_parameter_supported: true })
    if (url.pathname === '/oauth2/v1/keys') return Response.json({ keys: [key] })
    if (url.pathname === '/oauth2/v1/token') {
      const seconds = Math.floor(Date.now() / 1000), encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
      const raw = encode({ alg: 'RS256', kid: key.kid }) + '.' + encode({ iss: issuer, sub: edge.subject, aud: edge.audience, nonce: edge.nonce, iat: seconds, exp: seconds + 300, email: 'untrusted-email@example.test', email_verified: true })
      return Response.json({ token_type: 'Bearer', access_token: 'synthetic-lodge-7', id_token: raw + '.' + sign('RSA-SHA256', Buffer.from(raw), privateKey).toString('base64url') })
    }
    return new Response('Unknown provider route', { status: 404 })
  } })
  const scim = async (method, path = '', body, authorized = true) => {
    const r = await h.mf.dispatchFetch(h.origin + '/scim/v2/Users' + path, { method, headers: { 'content-type': 'application/scim+json', ...(authorized ? { authorization: 'Bearer ' + enterpriseBindings.ENTERPRISE_SCIM_TOKEN } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const text = await r.text(); let value; try { value = JSON.parse(text) } catch { value = text }
    return { status: r.status, value }
  }
  const login = async (subject = 'synthetic-lodge-5', wrongAudience = false) => {
    const begin = await h.send('/auth/oidc/lodge-okta/start', { returnTo: '/app' })
    assert.equal(begin.status, 303, begin.text)
    const url = new URL(begin.headers.get('location')); edge.subject = subject; edge.nonce = url.searchParams.get('nonce'); edge.audience = wrongAudience ? 'synthetic-lodge-8' : enterpriseBindings.ENTERPRISE_OKTA_CLIENT_ID
    const path = '/auth/oidc/lodge-okta/callback?code=synthetic-lodge-9&state=' + encodeURIComponent(url.searchParams.get('state')) + '&iss=' + encodeURIComponent(issuer)
    return h.send(path, undefined, begin.cookie)
  }
  return { ...h, scim, login, edge }
}

export async function enterpriseJob(h, title = 'Field supervisor') {
  const v = await h.command('vacancy', { title, location: 'Brooklyn, NY', manager: 'owner@example.test', headcount: 1, description: 'Lead safe field operations.', compensation: { currency: 'USD', min: 8000000, max: 10000000, period: 'year' } })
  await h.command('rubric', { id: v.id, criteria: [{ name: 'Safety', description: 'Practical evidence' }] })
  await h.command('interview-plan', { id: v.id, plan: [{ name: 'Site walk', stageName: 'Interview' }] })
  const approval = await h.command('request-vacancy-approval', { id: v.id, approver: 'owner@example.test' })
  await h.command('decide-approval', { id: approval.id, decision: 'approved', version: approval.version, reason: 'Approved role' })
  return h.command('publish', { id: v.id })
}

export async function checkEnterprise() {
  const h = await enterpriseFixture()
  try {
    assert.equal((await h.scim('POST', '', { externalId: 'synthetic-lodge-5', userName: 'worker@example.test' })).status, 404)
    assert.equal((await h.send('/enterprise/settings', { enabled: true }, h.owner)).status, 200)
    assert.equal((await h.scim('GET', '', undefined, false)).status, 401)
    assert.equal((await h.scim('POST', '', { externalId: 'synthetic-lodge-5', userName: 'owner@example.test' })).status, 409)
    assert.equal((await h.scim('POST', '', { externalId: 'synthetic-lodge-5', userName: 'worker@example.test', displayName: 'Morgan Field', active: true })).status, 201)
    assert.equal((await h.scim('GET', '?filter=' + encodeURIComponent('userName eq "worker@example.test"'))).value.totalResults, 1)
    const bad = await h.login('synthetic-lodge-5', true); assert.equal(bad.status, 400)
    const unknown = await h.login('synthetic-lodge-unknown'); assert.ok(unknown.status >= 400)
    const signed = await h.login(); assert.equal(signed.status, 303, signed.text)
    const cookie = signed.cookie
    const audit = await h.send('/api/lodge/audit', undefined, h.owner)
    assert.ok(audit.value.events.some(e => e.action === 'enterprise-provider-request' && e.endpoint === 'token' && e.outcome === 'response-received'))
    assert.ok(!JSON.stringify(audit.value.events).includes('synthetic-lodge-7'), 'provider tokens stay out of the audit')
    assert.equal((await h.state(cookie)).actor.email, 'worker@example.test', 'untrusted token email cannot select a different member')
    await h.command('referral-alerts', { enabled: true }, cookie)
    const job = await enterpriseJob(h)
    const referral = await h.command('referral-submit', { vacancy: job.id, name: 'Consented Prospect', email: 'prospect@example.test', confirmed: true, consentNote: 'Permission explicitly recorded', resume: { name: 'consented.txt', mediaType: 'text/plain', base64: Buffer.from('Consented experience').toString('base64') } }, cookie)
    assert.ok((await h.state()).referralReviews.some(r => r.id === referral.id))
    await h.command('member', { email: 'worker@example.test', name: 'Morgan Field', roles: ['manager'] })
    await h.command('hiring-team', { id: job.id, recruiters: ['worker@example.test'], coordinators: [], hiringManagers: [], sourcers: [], interviewers: [] })
    const person = await h.command('candidate', { name: 'Retained Candidate', email: 'retained@example.test', source: 'Referral', consentBasis: 'referral', vacancy: job.id })
    const task = await h.command('task', { kind: 'task', application: person.application.id, owner: 'worker@example.test', note: 'Arrange reference call', due: '2027-01-05' })
    const proposal = await h.command('propose', { workflow: 'prepare-vacancy', summary: 'Prepare the next field coordinator role', intake: 'An owner-reviewed future staffing need', approver: 'owner@example.test', changes: [{ op: 'vacancy', input: { title: 'Field coordinator proposal', location: 'Brooklyn, NY', headcount: 1, manager: 'worker@example.test', compensation: { currency: 'USD', min: 7000000, max: 8500000, period: 'year' } } }] }, cookie)
    const before = (await h.state()).referralReviews.find(r => r.id === referral.id)
    const mailCount = async () => (await h.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first()).n
    const alertCount = async () => (await h.db.prepare("SELECT COUNT(*) AS n FROM l_records WHERE kind='referral-job-alert' AND json_extract(value,'$.to')=?").bind('worker@example.test').first()).n
    assert.ok(await mailCount() > 0, 'an opted-in active employee received the job email')
    const mailedBefore = await mailCount(), alertsBefore = await alertCount()
    const put = await h.scim('PUT', '/synthetic-lodge-5', { userName: 'worker@example.test', displayName: 'Morgan Field', active: false }); assert.equal(put.status, 200)
    for (const path of ['/api/lodge/state', '/api/lodge/referral/export', '/api/lodge/search?q=Retained', '/api/lodge/download/candidate/' + person.candidate.id]) assert.ok([401, 403].includes((await h.send(path, undefined, cookie)).status), path)
    assert.ok([401, 403].includes((await h.send('/api/lodge/command/referral-alerts', { enabled: true }, cookie)).status))
    const after = await h.state(), transferred = after.tasks.find(t => t.id === task.id)
    assert.equal(transferred.owner, 'owner@example.test'); assert.equal(transferred.createdBy, task.createdBy)
    assert.equal(transferred.history.at(-1).from, 'worker@example.test')
    assert.deepEqual(after.referralReviews.find(r => r.id === referral.id), before, 'deprovisioning preserves frozen recruiter history')
    assert.equal((await h.send('/api/lodge/command/decide-proposal', { id: proposal.id, decision: 'approved', reason: 'Former owner is suspended' }, h.owner)).status, 409, 'deprovisioned pending work cannot be approved')
    await enterpriseJob(h, 'New role after suspension')
    assert.equal(await mailCount(), mailedBefore, 'no referral email after deprovisioning')
    assert.equal(await alertCount(), alertsBefore, 'no new portal alert after deprovisioning')
    assert.ok((await h.login()).status >= 400)
    assert.equal((await h.scim('PATCH', '/synthetic-lodge-5', { Operations: [{ op: 'replace', path: 'active', value: true }] })).status, 200)
    assert.equal((await h.send('/api/lodge/state', undefined, cookie)).status, 401, 'reactivation never revives old sessions')
    const next = await h.login(); assert.equal(next.status, 303, next.text)
    await h.send('/enterprise/settings', { enabled: false }, h.owner)
    assert.equal((await h.send('/api/lodge/state', undefined, next.cookie)).status, 401)
    await h.restart()
    assert.equal((await h.send('/api/lodge/state', undefined, cookie)).status, 401)
  } finally { await h.close() }
}
