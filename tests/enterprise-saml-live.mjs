// Opt-in real Okta SAML browser proof. Run through the credential injector.
// SCIM calls are harness-originated; provider provisioning push is not proven.
import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { DOMParser } from '@xmldom/xmldom'
import { businessHarness } from './harness.mjs'
import { LiveFailure, configuration, okta, createPerson, resources, secret, report, cleanup, signIn } from './enterprise-live.mjs'

class SamlLiveFailure extends Error {}
const check = (condition, message) => { if (!condition) throw new SamlLiveFailure(message) }
const callbackPath = '/enterprise/saml/callback'
const metadataNs = 'urn:oasis:names:tc:SAML:2.0:metadata'
const signatureNs = 'http://www.w3.org/2000/09/xmldsig#'

// Custom SAML creation and metadata retrieval are documented Management APIs.
// https://github.com/okta/okta-management-openapi-spec/blob/master/dist/current/management-minimal.yaml
function appDefinition(label, origin) {
  const callback = origin + callbackPath
  return { label, signOnMode: 'SAML_2_0',
    credentials: { userNameTemplate: { type: 'CUSTOM', template: 'user.getInternalProperty("id")' } },
    settings: { signOn: {
      ssoAcsUrl: callback, audience: origin + '/enterprise/saml', recipient: callback, destination: callback,
      idpIssuer: 'http://www.okta.com/${org.externalKey}', subjectNameIdTemplate: '${user.userName}',
      subjectNameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
      responseSigned: true, assertionSigned: true, signatureAlgorithm: 'RSA_SHA256', digestAlgorithm: 'SHA256',
      requestCompressed: true, honorForceAuthn: true, allowMultipleAcsEndpoints: false, samlAssertionLifetimeSeconds: 300,
      authnContextClassRef: 'urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport', assertionEncryption: { enabled: false },
    } },
  }
}

async function metadata(config, app) {
  const kid = app.credentials?.signing?.kid
  check(typeof kid === 'string' && kid.length > 0, 'temporary SAML signing key absent')
  const response = await fetch(config.origin + `/api/v1/apps/${encodeURIComponent(app.id)}/sso/saml/metadata?` + new URLSearchParams({ kid }), {
    redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { accept: 'text/xml', authorization: `SSWS ${config.token}` },
  })
  check(response.status === 200, `SAML metadata HTTP ${response.status}`)
  const xml = await response.text()
  check(xml.length < 524288 && !/<!DOCTYPE|<!ENTITY/i.test(xml), 'SAML metadata refused')
  const invalid = () => { throw new SamlLiveFailure('SAML metadata XML invalid') }
  const document = new DOMParser({ errorHandler: { warning: invalid, error: invalid, fatalError: invalid } }).parseFromString(xml, 'text/xml')
  const root = document.documentElement
  check(root.localName === 'EntityDescriptor' && root.namespaceURI === metadataNs, 'SAML metadata entity missing')
  const descriptor = root.getElementsByTagNameNS(metadataNs, 'IDPSSODescriptor')
  check(descriptor.length === 1, 'SAML metadata IdP descriptor ambiguous')
  const endpoints = Array.from(descriptor[0].getElementsByTagNameNS(metadataNs, 'SingleSignOnService')).filter(e => e.getAttribute('Binding') === 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect')
  const signing = Array.from(descriptor[0].getElementsByTagNameNS(metadataNs, 'KeyDescriptor')).filter(e => e.getAttribute('use') === 'signing')
  check(endpoints.length === 1 && signing.length === 1, 'SAML metadata trust anchors ambiguous')
  const certificates = signing[0].getElementsByTagNameNS(signatureNs, 'X509Certificate')
  check(certificates.length === 1, 'SAML metadata signing certificate ambiguous')
  const encoded = certificates[0].textContent.replace(/\s/g, ''), issuer = root.getAttribute('entityID'), entryPoint = endpoints[0].getAttribute('Location')
  check(issuer && entryPoint && new URL(entryPoint).origin === config.origin && new URL(entryPoint).protocol === 'https:', 'SAML metadata endpoint refused')
  check(encoded.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded), 'SAML metadata certificate invalid')
  return { issuer, entryPoint, certificate: '-----BEGIN CERTIFICATE-----\n' + encoded.match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----' }
}

async function scim(h, token, path, body, status) {
  const response = await h.mf.dispatchFetch(h.origin + '/scim/v2/' + path, { method: path === 'Users' ? 'POST' : 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/scim+json' }, body: JSON.stringify(body),
  })
  check(response.status === status, `public SCIM HTTP ${response.status}`)
  return response.json()
}

export async function runEnterpriseSamlLive() {
  let stage = 'configuration', config, browser, h, failure, ownsResources = false
  try {
    config = configuration()
    check(!resources.app && resources.users.length === 0, 'SAML journey needs an isolated process')
    ownsResources = true
    stage = 'isolated browser launch'
    browser = await chromium.launch({ headless: true, executablePath: process.env.LODGE_CHROMIUM, args: ['--use-mock-keychain', '--password-store=basic'] })
    const run = `${Date.now()}-${randomBytes(5).toString('hex')}`, label = `Lodge SAML live ${run}`
    stage = 'temporary SAML provider resources'
    const created = await Promise.allSettled([
      (async () => {
        const app = await okta(config, '/api/v1/apps?activate=true', { method: 'POST', body: appDefinition(label, 'http://127.0.0.1:1') })
        check(typeof app?.id === 'string', 'SAML application creation returned no ID')
        resources.app = app.id
        return app
      })(),
      createPerson(config, run, 'saml-employee'),
    ])
    const rejected = created.find(result => result.status === 'rejected')
    if (rejected) throw rejected.reason
    const [app, person] = created.map(result => result.value), anchors = await metadata(config, app), token = secret()
    stage = 'local SAML installation'
    h = await businessHarness({ bindings: { ENTERPRISE_OKTA_ISSUER: config.origin, ENTERPRISE_SAML_ISSUER: anchors.issuer,
      ENTERPRISE_SAML_ENTRY_POINT: anchors.entryPoint, ENTERPRISE_SAML_CERTIFICATE: anchors.certificate, ENTERPRISE_SCIM_TOKEN: token, ENTERPRISE_OIDC_SECRET: secret(),
    } })
    const definition = appDefinition(label, h.origin)
    const updated = await okta(config, `/api/v1/apps/${encodeURIComponent(app.id)}`, { method: 'PUT', body: {
      ...app, credentials: { ...app.credentials, ...definition.credentials }, settings: { ...app.settings, signOn: { ...app.settings.signOn, ...definition.settings.signOn } },
    } })
    const confirmed = await metadata(config, updated)
    check(confirmed.issuer === anchors.issuer && confirmed.entryPoint === anchors.entryPoint && confirmed.certificate === anchors.certificate, 'SAML trust anchors changed while configuring ACS')
    const enabled = await h.send('/enterprise/settings', { enabled: true }, h.owner)
    check(enabled.status === 200 && enabled.value.enabled === true, 'owner SAML enablement failed')
    stage = 'stable SAML subject assignment'
    await okta(config, `/api/v1/apps/${encodeURIComponent(app.id)}/users`, { method: 'POST', body: { id: person.id } })
    const assigned = await okta(config, `/api/v1/apps/${encodeURIComponent(app.id)}/users/${encodeURIComponent(person.id)}`)
    check(assigned.credentials?.userName === person.id, 'SAML application username is not the immutable provider user ID')
    stage = 'explicit public SCIM provisioning'
    check((await h.send('/scim/v2/Users')).status === 401, 'SCIM accepted an unauthenticated request')
    const provisioned = await scim(h, token, 'Users', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], externalId: person.id, userName: person.login, displayName: person.name, active: true }, 201)
    check(provisioned.id === person.id && provisioned.active === true, 'provisioned SAML subject was not preserved')
    stage = 'hosted Okta SAML browser authentication'
    // Do not inject correlation cookies or replay the IdP POST in this harness.
    // The secure correlation cookie must travel on the actual cross-site ACS POST.
    const cookie = await signIn(browser, h, config, person, { button: 'Continue with employer SAML', callback: callbackPath })
    const state = await h.state(cookie)
    check(state.actor.email === person.login && state.actor.roles.length === 1 && state.actor.roles[0] === 'employee' && !state.actor.owner && !state.actor.agent, 'SAML native admission changed employee authority')
    report('SAML: real Okta signed response and assertion issued a native employee session using the stable provisioned subject')
    stage = 'provider suspension and explicit SCIM deprovision'
    const userPath = `/api/v1/users/${encodeURIComponent(person.id)}`
    await okta(config, userPath + '/lifecycle/suspend', { method: 'POST', statuses: [200, 204] })
    check((await okta(config, userPath)).status === 'SUSPENDED', 'provider suspension not witnessed')
    const suspended = await scim(h, token, `Users/${encodeURIComponent(person.id)}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', value: { active: false } }] }, 200)
    check(suspended.active === false, 'SCIM suspension not witnessed')
    check((await h.send('/auth/session', undefined, cookie)).status === 401 && (await h.send('/api/lodge/state', undefined, cookie)).status === 401, 'SCIM suspension did not revoke the native SAML session')
    await h.restart()
    check((await h.send('/auth/session', undefined, cookie)).status === 401, 'SAML session revocation did not survive restart')
    report('SAML: provider suspension followed by explicit public SCIM deprovision revoked the native session durably')
    report('SAML scope: harness-originated SCIM; Okta-originated provisioning push and production TLS cookie behavior remain unproven')
  } catch (error) { failure = stage + (error instanceof SamlLiveFailure || error instanceof LiveFailure ? ` (${error.message})` : '') } finally {
    if (ownsResources) try {
      await cleanup(config)
      resources.app = null; resources.users.length = 0
      report('SAML: temporary Okta app and user deleted; absence verified')
    } catch { failure = failure ? `${failure}; provider cleanup` : 'provider cleanup'; report('SAML FAILED temporary provider cleanup') }
    try { await browser?.close() } catch { failure = failure ? `${failure}; browser cleanup` : 'browser cleanup' }
    try { await h?.close() } catch { failure = failure ? `${failure}; local cleanup` : 'local cleanup' }
  }
  if (failure) { report(`SAML FAILED at ${failure}`); process.exitCode = 1; return false }
  report('SAML PASS'); return true
}

// No provider bodies, raw exceptions, credentials, cookies, traces or screenshots.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runEnterpriseSamlLive().catch(() => { report('SAML FAILED before sanitized completion'); process.exitCode = 1 })
}
