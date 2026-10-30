import { isCompliance } from '../core/access'
import { workspaceRecords } from '../views/workspace'
import { vacancyCompliance } from './grants'
import { Hono } from 'hono'
import { createAuthHandler } from '../../modules/operator-auth/index.mjs'
import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { actorFor, load, save, signedIn } from '../core/store'
import { Fault, requireThat, type Data } from '../core/types'
import { esc, page } from '../http/public'
import { configured, oidcConfigured, samlConfigured, enterpriseAuth, enterpriseControl, providerId } from './config'
import { samlResponse } from './saml'
import { provision, scimAuthorized, scimUser } from './scim'

export const enterprisePages = new Hono<{ Bindings: Bindings }>()
enterprisePages.use('*', async (c, next) => { await next(); c.header('cache-control', 'no-store'); c.header('referrer-policy', 'same-origin'); c.header('x-content-type-options', 'nosniff') })
enterprisePages.onError((e, c) => {
  const fault = e instanceof Fault ? e : new Fault(500, 'Enterprise identity request failed')
  if (c.req.path.startsWith('/scim/')) return c.json({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: String(fault.status), detail: fault.message }, fault.status as 400)
  return c.req.path.startsWith('/api/') ? c.json({ error: fault.message }, fault.status as 400) : page('Enterprise identity', `<h1>Enterprise identity</h1><p role="alert">${esc(fault.message)}</p><p><a href="/enterprise/settings">Identity settings</a></p>`, fault.status)
})
async function input(request: Request): Promise<Data> {
  requireThat(Number(request.headers.get('content-length') ?? 0) <= 65536, 'Request too large', 413)
  const raw = await request.text(); requireThat(raw.length <= 65536, 'Request too large', 413)
  let value: any; try { value = JSON.parse(raw) } catch { throw new Fault(400, 'Send a JSON object') }
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 'Send a JSON object')
  return value
}
async function owner(request: Request, env: Bindings) {
  const s = await load(env.DB), a = actorFor(await signedIn(request, env), s)
  requireThat(a.owner && !a.agent, 'Only the owner manages enterprise identity', 403)
  return { s, a }
}
enterprisePages.get('/enterprise/signin', async c => {
  requireThat(configured(c.env), 'Employer identity is not configured', 503)
  const s = await load(c.env.DB); requireThat(s.find('enterprise-settings', 'main')?.enabled, 'Employer identity is disabled', 403)
  const response = await page('Employer sign-in', `<h1>Employer sign-in</h1>${oidcConfigured(c.env) ? `<form action="/auth/oidc/${providerId}/start" method="post"><input type="hidden" name="returnTo" value="/app"><button type="submit">Continue with employer Okta</button></form>` : ''}${samlConfigured(c.env) ? '<form method="post" action="/enterprise/saml/start"><input type="hidden" name="returnTo" value="/app"><button>Continue with employer SAML</button></form>' : ''}<p><a href="/signin">Native sign-in</a></p>`)
  // Browser form policy also covers the start route's redirect to the pinned IdP.
  const origins = [oidcConfigured(c.env) && c.env.ENTERPRISE_OKTA_ISSUER, samlConfigured(c.env) && c.env.ENTERPRISE_SAML_ENTRY_POINT].filter(Boolean).map(value => new URL(value as string).origin)
  requireThat(origins.every(origin => origin.startsWith('https://')), 'Secure employer sign-in required', 503)
  response.headers.set('content-security-policy', response.headers.get('content-security-policy')!.replace("form-action 'self'", "form-action 'self' " + [...new Set(origins)].join(' ')))
  return response
})
enterprisePages.get('/enterprise/compliance', async c => {
  const s = await load(c.env.DB), a = actorFor(await signedIn(c.req.raw, c.env), s)
  requireThat(isCompliance(a), 'A human compliance grant is required', 403)
  const view = await workspaceRecords(s, a, c.env)
  return page('Compliance records', `<h1>Compliance records</h1><p><a href="/app">Back to Lodge</a></p>${view.vacancies.length ? view.vacancies.map((v: Data) => {
    const onJob = (id: string) => s.find('application', id)?.vacancy === v.id
    const documents = view.documents.filter((d: Data) => d.restricted && onJob(d.application))
    const answers = view.restricted.filter((m: Data) => onJob(m.application))
    return `<section><h2>${esc(v.title)}</h2><h3>Restricted originals</h3>${documents.length ? documents.map((d: Data) => `<p><a href="/api/lodge/view/document/${encodeURIComponent(d.id)}">${esc(d.name)}</a></p>`).join('') : '<p>No restricted originals.</p>'}<h3>Monitoring and accommodation</h3>${answers.length ? answers.map((m: Data) => `<article><h4>${m.type === 'accommodation' ? 'Accommodation request' : 'Voluntary monitoring answer'}</h4><p>${esc(m.answer)}</p></article>`).join('') : '<p>No restricted answers.</p>'}</section>`
  }).join('') : '<p>No compliance jobs assigned.</p>'}`)
})
enterprisePages.get('/enterprise/settings', async c => {
  const { s } = await owner(c.req.raw, c.env), settings = s.find('enterprise-settings', 'main')
  const members = s.all('member').filter(m => m.enterprise?.issuer === c.env.ENTERPRISE_OKTA_ISSUER)
  const compliance = s.all('member').filter(m => m.active && !m.agent && m.roles.includes('compliance'))
  const grants = `<section><h2>Compliance access</h2><p>Compliance reviewers see restricted originals and monitoring answers only for jobs explicitly assigned here.</p>${s.all('vacancy').map(v => `<details><summary>${esc(v.title)}</summary><form method="post" action="/enterprise/compliance"><input type="hidden" name="id" value="${esc(v.id)}"><fieldset><legend>Compliance reviewers for ${esc(v.title)}</legend>${compliance.length ? compliance.map(m => `<label><input type="checkbox" name="people" value="${esc(m.email)}"${(v.compliancePeople ?? []).includes(m.email) ? ' checked' : ''}> ${esc(m.name)}</label>`).join('') : '<p>Add a compliance reviewer under Hiring team first.</p>'}</fieldset><button>Apply compliance grants</button></form></details>`).join('')}</section>`
  return page('Enterprise identity', `<h1>Enterprise identity</h1><p><a href="/app">Back to Settings</a> · <a href="/enterprise/compliance">Open compliance records</a></p><section><h2>Employer Okta</h2><p>${configured(c.env) ? 'Connection configured' : 'Connection secrets need installation setup'}. ${settings?.enabled ? 'Enabled' : 'Disabled'}.</p><form method="post" action="/enterprise/settings"><input type="hidden" name="enabled" value="${settings?.enabled ? 'false' : 'true'}"><button>${settings?.enabled ? 'Disable employer sign-in' : 'Enable employer sign-in'}</button></form><p><a href="/enterprise/signin">Open employer sign-in</a></p><details><summary>Provisioning and role grants</summary><p>Provisioning creates employee referral access only. Grant hiring roles in Settings. Existing identities and email changes require owner review. Suspension revokes sessions and credentials, stops pending owned work and keeps submission history.</p><p>Set the employer callback to the installation origin followed by <code>/auth/oidc/${providerId}/callback</code>. The provisioning base is <code>/scim/v2</code>. For SAML, use the installation origin followed by <code>/enterprise/saml/callback</code> for the callback and <code>/enterprise/saml</code> for the SP entity. Sign both the response and assertion, and configure persistent NameID as the stable provisioned subject. Token email is never an account association.</p></details></section>${grants}<section><h2>Provisioned members</h2>${members.length ? members.map(m => `<article><h3>${esc(m.name)}</h3><p>${esc(m.email)} · ${m.active ? 'Active' : 'Suspended'} · ${esc(m.roles.join(', '))}</p></article>`).join('') : '<p>No provisioned members yet.</p>'}</section>`)
})
enterprisePages.post('/enterprise/compliance', async c => {
  const { s, a } = await owner(c.req.raw, c.env), form = await c.req.formData()
  vacancyCompliance(s, a, { id: form.get('id'), people: form.getAll('people') })
  await save(c.env.DB, s, a)
  return c.redirect('/enterprise/settings', 303)
})
enterprisePages.post('/enterprise/settings', async c => {
  const { s, a } = await owner(c.req.raw, c.env)
  requireThat(configured(c.env), 'Configure connection secrets before enabling identity', 409)
  const b = c.req.header('content-type')?.includes('application/json') ? await input(c.req.raw) : Object.fromEntries((await c.req.formData()).entries())
  requireThat([true, false, 'true', 'false'].includes(b.enabled), 'Choose whether enterprise identity is enabled')
  const enabled = b.enabled === true || b.enabled === 'true'
  await (await enterpriseControl(c.env)).setIdentitySettings(c.req.raw, { idpSignIn: enabled })
  s.put('enterprise-settings', 'main', { enabled, issuer: c.env.ENTERPRISE_OKTA_ISSUER })
  s.audit(a, enabled ? 'enterprise-identity-enabled' : 'enterprise-identity-disabled', 'business:main', { issuer: c.env.ENTERPRISE_OKTA_ISSUER })
  await save(c.env.DB, s, a)
  return c.req.header('content-type')?.includes('application/json') ? c.json({ enabled }) : c.redirect('/enterprise/settings', 303)
})
enterprisePages.all('/enterprise/saml/*', async c => {
  requireThat(samlConfigured(c.env), 'Employer SAML is not configured', 503)
  return await samlResponse(c.req.raw, c.env, { issuer: c.env.ENTERPRISE_SAML_ISSUER!, associationIssuer: c.env.ENTERPRISE_OKTA_ISSUER!, entryPoint: c.env.ENTERPRISE_SAML_ENTRY_POINT!, certificate: c.env.ENTERPRISE_SAML_CERTIFICATE! }) ?? c.notFound()
})
enterprisePages.all('/auth/oidc/lodge-okta/*', async c => {
  requireThat(oidcConfigured(c.env), 'Employer identity is not configured', 503)
  const s = await load(c.env.DB)
  requireThat(s.find('enterprise-settings', 'main')?.enabled && s.get('enterprise-settings', 'main').issuer === c.env.ENTERPRISE_OKTA_ISSUER, 'Employer identity is disabled', 403)
  return await createAuthHandler(await enterpriseAuth(c.env))(c.req.raw) ?? c.notFound()
})
enterprisePages.use('/scim/v2/*', async (c, next) => { await scimAuthorized(c.req.raw, c.env); await next() })
enterprisePages.get('/scim/v2/ServiceProviderConfig', c => c.json({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'], patch: { supported: true }, bulk: { supported: false }, filter: { supported: true, maxResults: 100 }, changePassword: { supported: false }, sort: { supported: false }, etag: { supported: false }, authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Bearer credential', description: 'Installation-specific provisioning credential' }] }))
enterprisePages.get('/scim/v2/Users', async c => {
  const s = await load(c.env.DB), filter = c.req.query('filter')
  const match = filter?.match(/^userName eq "([^"\\]+)"$/)
  requireThat(!filter || match, 'Only an exact userName filter is supported')
  const all = s.all('member').filter(m => m.enterprise?.issuer === c.env.ENTERPRISE_OKTA_ISSUER && (!match || m.email === match[1].toLowerCase()))
  const start = Number(c.req.query('startIndex') ?? 1), count = Number(c.req.query('count') ?? 100)
  requireThat(Number.isSafeInteger(start) && start >= 1 && Number.isSafeInteger(count) && count >= 0 && count <= 100, 'Invalid page')
  const resources = all.slice(start - 1, start - 1 + count).map(scimUser)
  return c.json({ schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'], totalResults: all.length, startIndex: start, itemsPerPage: resources.length, Resources: resources })
})
enterprisePages.get('/scim/v2/Users/:id', async c => {
  const s = await load(c.env.DB), m = s.all('member').find(m => m.enterprise?.issuer === c.env.ENTERPRISE_OKTA_ISSUER && m.enterprise.subject === c.req.param('id'))
  requireThat(m, 'Provisioned member not found', 404); return c.json(scimUser(m))
})
enterprisePages.post('/scim/v2/Users', async c => {
  const result = await provision(c.env, await input(c.req.raw))
  c.header('location', runtimeBindings(c.env).AUTH_ORIGIN + '/scim/v2/Users/' + encodeURIComponent(result.member.enterprise.subject))
  return c.json(scimUser(result.member), result.created ? 201 : 200)
})
enterprisePages.put('/scim/v2/Users/:id', async c => c.json(scimUser((await provision(c.env, await input(c.req.raw), c.req.param('id'))).member)))
enterprisePages.patch('/scim/v2/Users/:id', async c => {
  const b = await input(c.req.raw), values: Data = {}
  requireThat(Array.isArray(b.Operations) && b.Operations.length > 0 && b.Operations.length <= 20, 'Send bounded patch operations')
  for (const op of b.Operations) {
    requireThat(['replace', 'add'].includes(String(op.op).toLowerCase()), 'Only replace or add is supported')
    if (!op.path) { requireThat(op.value && Object.keys(op.value).every(k => ['active', 'displayName', 'userName', 'name'].includes(k)), 'Unsupported patch'); Object.assign(values, op.value) }
    else { requireThat(['active', 'displayName', 'userName', 'name'].includes(op.path), 'Unsupported patch path'); values[op.path] = op.value }
  }
  return c.json(scimUser((await provision(c.env, values, c.req.param('id'))).member))
})
enterprisePages.delete('/scim/v2/Users/:id', async c => { await provision(c.env, { active: false }, c.req.param('id')); return c.body(null, 204) })
