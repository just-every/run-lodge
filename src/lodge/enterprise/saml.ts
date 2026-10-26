import { identityAudit } from './audit'
import { Buffer } from 'node:buffer'
import { SAML, ValidateInResponseTo } from '@node-saml/node-saml'
import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { load } from '../core/store'
import { Fault, requireThat } from '../core/types'
import { providerId } from './config'
import { samlEnvelope, samlSubject } from './saml-xml'

export interface EnterpriseSamlConfig {
  issuer: string
  associationIssuer: string
  entryPoint: string
  certificate: string
  entityId?: string
}
const startPath = '/enterprise/saml/start', callbackPath = '/enterprise/saml/callback'
const lifetime = 300000
const securityHeaders = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' }
const hash = async (value: string) => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex')
const random = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
type Transaction = { request_id: string; browser_hash: string; config_hash: string; generation: number; created_at: number; expires_at: number }

async function body(request: Request) {
  requireThat(request.headers.get('content-type')?.split(';')[0] === 'application/x-www-form-urlencoded', 'Send a form', 415)
  const reader = request.body?.getReader(); requireThat(reader, 'Send a form')
  let size = 0, value = ''
  const decoder = new TextDecoder('utf-8', { fatal: true })
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break
      size += chunk.value.length
      if (size > 262144) { await reader.cancel(); throw new Fault(413, 'Request too large') }
      value += decoder.decode(chunk.value, { stream: true })
    }
    value += decoder.decode()
  } finally { reader.releaseLock() }
  return new URLSearchParams(value)
}
function cookieName(env: Bindings) { return env.AUTH_LOCAL === 'true' ? 'lodge_saml_' + new URL(env.AUTH_ORIGIN).port : '__Host-lodge_saml' }
function cookie(env: Bindings, value: string, age = 300) {
  return `${cookieName(env)}=${value}; Path=/; HttpOnly; Max-Age=${age}; SameSite=None; Secure`
}
function browserBinding(request: Request, env: Bindings) {
  const values = (request.headers.get('cookie') ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(cookieName(env) + '='))
  requireThat(values.length === 1, 'SAML browser correlation required')
  const value = values[0].slice(cookieName(env).length + 1)
  requireThat(/^[a-f0-9]{64}$/.test(value), 'SAML browser correlation required')
  return value
}
async function policy(env: Bindings, config: EnterpriseSamlConfig) {
  const [s, native] = await Promise.all([load(env.DB), env.DB.prepare('SELECT generation,idp_sign_in FROM oa_auth_settings WHERE singleton=1').first<{ generation: number; idp_sign_in: number }>()])
  requireThat(s.find('enterprise-settings', 'main')?.enabled && s.get('enterprise-settings', 'main').issuer === config.associationIssuer && native?.idp_sign_in === 1, 'Employer identity is disabled', 403)
  return { state: s, generation: native!.generation }
}

/** Seed-owned SP. Only deployment configuration may supply these trust anchors. */
export async function samlResponse(request: Request, original: Bindings, config: EnterpriseSamlConfig): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== startPath && url.pathname !== callbackPath) return null
  const env = runtimeBindings(original)
  try {
    requireThat(request.method === 'POST', 'Use POST for SAML sign-in', 405)
    requireThat(url.origin === env.AUTH_ORIGIN && (!request.headers.has('host') || request.headers.get('host') === url.host), 'Invalid installation origin', 403)
    requireThat(env.AUTH_LOCAL === 'true' ? ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) : url.protocol === 'https:', 'SAML requires a secure installation', 503)
    requireThat(config.issuer && config.associationIssuer && config.certificate?.includes('-----BEGIN CERTIFICATE-----') && new URL(config.entryPoint).protocol === 'https:', 'Employer SAML is not configured', 503)
    const callback = env.AUTH_ORIGIN + callbackPath, entityId = config.entityId ?? env.AUTH_ORIGIN + '/enterprise/saml'
    const fingerprint = await hash(JSON.stringify([env.AUTH_ORIGIN, config.issuer, config.associationIssuer, config.entryPoint, config.certificate, entityId]))
    const live = await policy(env, config)
    if (url.pathname === startPath) {
      requireThat(request.headers.get('origin') === env.AUTH_ORIGIN && request.headers.get('sec-fetch-site') !== 'cross-site', 'Same-origin sign-in required', 403)
      const form = await body(request)
      requireThat([...form.keys()].every(k => k === 'returnTo') && form.getAll('returnTo').length <= 1 && (!form.has('returnTo') || form.get('returnTo') === '/app'), 'Invalid sign-in destination')
      const now = Date.now(), window = Math.floor(now / 900000)
      const limitKey = 'lodge-saml:' + await hash(request.headers.get('CF-Connecting-IP') ?? '')
      const limit = await env.DB.prepare('INSERT INTO oa_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=CASE WHEN oa_limits.window=excluded.window THEN oa_limits.count+1 ELSE 1 END RETURNING count').bind(limitKey, window).first<{ count: number }>()
      requireThat(limit && limit.count <= 30, 'Too many SAML sign-in attempts', 429)
      await env.DB.prepare('DELETE FROM oa_limits WHERE key LIKE ? AND window<?').bind('lodge-saml:%', window - 1).run()
      const requestId = '_' + random(), binding = random()
      await env.DB.prepare('DELETE FROM l_enterprise_saml_transactions WHERE expires_at<?').bind(now - 86400000).run()
      await env.DB.prepare('INSERT INTO l_enterprise_saml_transactions(request_id,browser_hash,config_hash,generation,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(requestId, await hash(binding), fingerprint, live.generation, now, now + lifetime).run()
      const location = await verifier(env, config, entityId, callback, requestId).getAuthorizeUrlAsync(requestId, undefined, {})
      await identityAudit(env, 'saml-identity-started', { provider: 'Okta', outcome: 'redirected' })
      return new Response(null, { status: 303, headers: { ...securityHeaders, location, 'set-cookie': cookie(env, binding) } })
    }
    const form = await body(request)
    requireThat([...form.keys()].every(k => ['RelayState', 'SAMLResponse'].includes(k)) && form.getAll('RelayState').length === 1 && form.getAll('SAMLResponse').length === 1, 'Invalid SAML form')
    const requestId = form.get('RelayState')!, encoded = form.get('SAMLResponse')!
    requireThat(/^_[a-f0-9]{64}$/.test(requestId) && encoded.length > 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded), 'Invalid SAML response')
    const bindingHash = await hash(browserBinding(request, env))
    const transaction = await env.DB.prepare('SELECT * FROM l_enterprise_saml_transactions WHERE request_id=? AND consumed_at IS NULL AND expires_at>?').bind(requestId, Date.now()).first<Transaction>()
    requireThat(transaction && transaction.browser_hash === bindingHash && transaction.config_hash === fingerprint && transaction.generation === live.generation, 'SAML correlation refused')
    const responseId = samlEnvelope(Buffer.from(encoded, 'base64').toString('utf8'), config.issuer, callback, requestId)
    const { profile, loggedOut } = await verifier(env, config, entityId, callback, requestId).validatePostResponseAsync({ SAMLResponse: encoded })
    requireThat(profile && !loggedOut && typeof profile.getAssertionXml === 'function', 'SAML assertion required')
    const principal = samlSubject(profile!.getAssertionXml!(), config.issuer, callback, entityId, requestId)
    const current = await policy(env, config)
    const members = current.state.all('member').filter(m => m.active && !m.owner && !m.agent && m.provisionedAt && m.enterprise?.issuer === config.associationIssuer && m.enterprise.subject === principal.subject)
    requireThat(members.length === 1 && current.generation === transaction!.generation, 'Active provisioned membership required', 403)
    requireThat(env.AUTH_LOCAL === 'true' || !/\.(?:localhost|test|invalid)$/.test(members[0].email.toLowerCase()), 'Reserved identity refused', 403)
    const consumed = await env.DB.prepare('UPDATE l_enterprise_saml_transactions SET consumed_at=?,assertion_key=?,response_key=? WHERE request_id=? AND consumed_at IS NULL AND browser_hash=? AND config_hash=? AND generation=? AND expires_at>? RETURNING request_id').bind(Date.now(), await hash(JSON.stringify([config.issuer, principal.assertionId])), await hash(JSON.stringify([config.issuer, responseId])), requestId, bindingHash, fingerprint, current.generation, Date.now()).first()
    requireThat(consumed, 'SAML response already consumed')
    // OA persists the canonical provisioning issuer and stable subject, preserving revocation.
    const result = await operatorAuth(env).admission.admit(request, { issuer: config.associationIssuer, subject: principal.subject, provider: providerId, associatedEmail: members[0].email, providerGeneration: current.generation }, { returnTo: '/app' })
    await identityAudit(env, 'saml-identity-confirmed', { provider: 'Okta', outcome: 'assertion-verified', operator: result.operator.id }, result.operator.email)
    const headers = new Headers({ ...securityHeaders, location: result.returnTo })
    headers.append('set-cookie', result.cookie); headers.append('set-cookie', cookie(env, '', 0))
    return new Response(null, { status: 303, headers })
  } catch (error) {
    const status = error instanceof Fault ? error.status : 400
    return Response.json({ error: error instanceof Fault ? error.message : 'SAML sign-in refused' }, { status, headers: securityHeaders })
  }
}

function verifier(env: Bindings, config: EnterpriseSamlConfig, entityId: string, callback: string, requestId: string) {
  return new SAML({ issuer: entityId, audience: entityId, idpIssuer: config.issuer, entryPoint: config.entryPoint, callbackUrl: callback, idpCert: config.certificate,
    wantAssertionsSigned: true, wantAuthnResponseSigned: true, signatureAlgorithm: 'sha256', digestAlgorithm: 'sha256', acceptedClockSkewMs: 0, maxAssertionAgeMs: lifetime,
    validateInResponseTo: ValidateInResponseTo.always, requestIdExpirationPeriodMs: lifetime, generateUniqueId: () => requestId, identifierFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent', allowCreate: false, disableRequestedAuthnContext: true,
    cacheProvider: {
      async saveAsync(_key, value) { return { value, createdAt: Date.now() } },
      async getAsync(key) {
        if (key !== requestId) return null
        const row = await env.DB.prepare('SELECT created_at FROM l_enterprise_saml_transactions WHERE request_id=? AND consumed_at IS NULL AND expires_at>?').bind(key, Date.now()).first<{ created_at: number }>()
        return row ? new Date(row.created_at).toISOString() : null
      },
      // Consumption follows verified XML and browser binding in one atomic D1 statement.
      async removeAsync() { return null },
    },
  })
}
