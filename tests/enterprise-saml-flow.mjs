import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { SignedXml } from 'xml-crypto'
import { businessHarness } from './harness.mjs'

const issuer = 'https://synthetic-lodge-1.example.test/saml', associationIssuer = 'https://synthetic-lodge-2.example.test'
const entryPoint = 'https://synthetic-lodge-3.example.test/sso'
const a = 'urn:oasis:names:tc:SAML:2.0:assertion', p = 'urn:oasis:names:tc:SAML:2.0:protocol'
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
async function certificate() {
  const dir = await mkdtemp(join(tmpdir(), 'lodge-saml-'))
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=synthetic-lodge-4'], { stdio: 'ignore' })
    return { key: await readFile(join(dir, 'key.pem'), 'utf8'), cert: await readFile(join(dir, 'cert.pem'), 'utf8') }
  } finally { await rm(dir, { recursive: true, force: true }) }
}
function sign(xml, name, keys) {
  const signer = new SignedXml({ privateKey: keys.key, publicCert: keys.cert, signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256', canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#' })
  signer.addReference({ xpath: `/*[local-name()='${name}']`, transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'], digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256' })
  signer.computeSignature(xml, { location: { reference: `/*[local-name()='${name}']/*[local-name()='Issuer']`, action: 'after' } })
  return signer.getSignedXml()
}

/** Synthetic IdP at the protocol boundary; every response is real signed XML. */
export async function samlFixture() {
  const keys = await certificate(), wrongKeys = await certificate()
  const bindings = { ENTERPRISE_OKTA_ISSUER: associationIssuer, ENTERPRISE_SAML_ISSUER: issuer, ENTERPRISE_SAML_ENTRY_POINT: entryPoint, ENTERPRISE_SAML_CERTIFICATE: keys.cert, ENTERPRISE_SCIM_TOKEN: 'synthetic-lodge-5-provisioning-credential' }
  const h = await businessHarness({ bindings })
  let serial = 0
  const scim = async (method, path = '', body) => {
    const r = await h.mf.dispatchFetch(h.origin + '/scim/v2/Users' + path, { method, headers: { 'content-type': 'application/scim+json', authorization: 'Bearer ' + bindings.ENTERPRISE_SCIM_TOKEN }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, text: await r.text() }
  }
  const post = async (path, values, cookie = '', origin = h.origin) => {
    const r = await h.mf.dispatchFetch(h.origin + path, { method: 'POST', redirect: 'manual', headers: { origin, cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values).toString() })
    return { status: r.status, text: await r.text(), headers: r.headers, cookie: r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') }
  }
  const begin = async () => {
    const r = await post('/enterprise/saml/start', { returnTo: '/app' })
    assert.equal(r.status, 303, r.text)
    const destination = new URL(r.headers.get('location'))
    assert.equal(destination.origin + destination.pathname, entryPoint)
    const xml = inflateRawSync(Buffer.from(destination.searchParams.get('SAMLRequest'), 'base64')).toString()
    const requestId = xml.match(/\bID="([^"]+)"/)[1]
    assert.equal(destination.searchParams.get('RelayState'), requestId)
    return { ...r, requestId }
  }
  const response = (transaction, changes = {}) => {
    const id = ++serial, now = Date.now(), issue = new Date(now - 1000).toISOString(), before = new Date(now - 10000).toISOString(), after = new Date(now + 120000).toISOString()
    const v = { issuer, audience: h.origin + '/enterprise/saml', recipient: h.origin + '/enterprise/saml/callback', destination: h.origin + '/enterprise/saml/callback', subject: 'synthetic-lodge-6', requestId: transaction.requestId, before, after, assertionId: 'synthetic-lodge-assertion-' + id, responseId: 'synthetic-lodge-response-' + id, ...changes }
    const assertion = `<saml:Assertion xmlns:saml="${a}" ID="${esc(v.assertionId)}" Version="2.0" IssueInstant="${issue}"><saml:Issuer>${esc(v.issuer)}</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">${esc(v.subject)}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${esc(v.requestId)}" Recipient="${esc(v.recipient)}" NotOnOrAfter="${esc(v.after)}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${esc(v.before)}" NotOnOrAfter="${esc(v.after)}"><saml:AudienceRestriction><saml:Audience>${esc(v.audience)}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${issue}" SessionIndex="synthetic-lodge-7"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>owner@example.test</saml:AttributeValue></saml:Attribute><saml:Attribute Name="roles"><saml:AttributeValue>admin</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion>`
    let signed = changes.unsigned ? assertion : sign(assertion, 'Assertion', changes.wrongCertificate ? wrongKeys : keys)
    if (changes.tamper) signed = signed.replace('synthetic-lodge-6</saml:NameID>', 'synthetic-lodge-8</saml:NameID>')
    if (changes.wrapping) signed = assertion.replace('<saml:Assertion ', '<saml:Assertion ').replace(`ID="${esc(v.assertionId)}"`, 'ID="synthetic-lodge-wrapper"') + signed
    const envelope = `<samlp:Response xmlns:samlp="${p}" xmlns:saml="${a}" ID="${esc(v.responseId)}" Version="2.0" IssueInstant="${issue}" Destination="${esc(v.destination)}" InResponseTo="${esc(v.requestId)}"><saml:Issuer>${esc(v.issuer)}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${signed}</samlp:Response>`
    return sign(envelope, 'Response', keys)
  }
  const callback = (transaction, xml, cookie = transaction.cookie) => post('/enterprise/saml/callback', { RelayState: transaction.requestId, SAMLResponse: Buffer.from(xml).toString('base64') }, cookie, entryPoint)
  return { ...h, scim, post, begin, response, callback, async enable() { const r = await h.send('/enterprise/settings', { enabled: true }, h.owner); assert.equal(r.status, 200, r.text) } }
}

export async function checkEnterpriseSaml() {
  const h = await samlFixture()
  try {
    assert.equal((await h.post('/enterprise/saml/start', {})).status, 403)
    await h.enable()
    assert.equal((await h.post('/enterprise/saml/start', {}, '', entryPoint)).status, 403)
    assert.equal((await h.scim('POST', '', { externalId: 'synthetic-lodge-6', userName: 'worker@example.test', displayName: 'Synthetic Lodge' })).status, 201)
    const start = await h.begin(), xml = h.response(start)
    assert.ok((await h.callback(start, xml, '')).status >= 400, 'a valid assertion needs the initiating browser')
    await h.restart()
    const signed = await h.callback(start, xml)
    assert.equal(signed.status, 303, signed.text)
    const state = await h.state(signed.cookie)
    const audit = await h.send('/api/lodge/audit', undefined, h.owner)
    assert.ok(audit.value.events.some(e => e.action === 'saml-identity-started') && audit.value.events.some(e => e.action === 'saml-identity-confirmed'))
    assert.ok(!JSON.stringify(audit.value.events).includes('SAMLResponse'), 'signed assertions stay out of recruiting audit')
    assert.equal(state.actor.email, 'worker@example.test', 'NameID association chooses the provisioned subject, never asserted email')
    assert.deepEqual(state.actor.roles, ['employee'], 'asserted role claims grant no privileges')
    assert.ok((await h.callback(start, xml)).status >= 400, 'the response is one use after a Worker restart')
    const repeat = await h.begin()
    assert.ok((await h.callback(repeat, h.response(repeat, { assertionId: 'synthetic-lodge-assertion-1' }))).status >= 400, 'a signed assertion ID cannot be replayed in another request')
    const repeatedResponse = await h.begin()
    assert.ok((await h.callback(repeatedResponse, h.response(repeatedResponse, { responseId: 'synthetic-lodge-response-1' }))).status >= 400, 'a signed response ID cannot be reused for another assertion')
    const race = await h.begin(), racingXml = h.response(race)
    const racing = await Promise.all([h.callback(race, racingXml), h.callback(race, racingXml)])
    assert.deepEqual(racing.map(r => r.status).sort(), [303, 400], 'concurrent callbacks consume the response exactly once')
    for (const changes of [
      { audience: 'synthetic-lodge-other-audience' }, { issuer: 'https://synthetic-lodge-other.example.test' }, { recipient: h.origin + '/wrong' }, { destination: h.origin + '/wrong' },
      { requestId: '_synthetic-lodge-unknown-request' }, { after: new Date(Date.now() - 10000).toISOString() }, { before: new Date(Date.now() + 60000).toISOString() },
      { subject: 'owner@example.test' }, { subject: 'synthetic-lodge-unprovisioned' }, { wrongCertificate: true }, { unsigned: true }, { tamper: true }, { wrapping: true },
    ]) {
      const transaction = await h.begin(), result = await h.callback(transaction, h.response(transaction, changes))
      assert.ok(result.status >= 400 && result.status < 500, JSON.stringify(changes) + ': ' + result.text)
      assert.ok(!result.cookie.includes('oa_'), 'refused assertions issue no native session')
    }
    const pending = await h.begin()
    assert.equal((await h.scim('PATCH', '/synthetic-lodge-6', { Operations: [{ op: 'replace', path: 'active', value: false }] })).status, 200)
    assert.ok((await h.callback(pending, h.response(pending))).status >= 400)
    assert.equal((await h.send('/api/lodge/state', undefined, signed.cookie)).status, 401, 'SCIM suspension revokes a SAML native session')
    assert.equal((await h.scim('PATCH', '/synthetic-lodge-6', { Operations: [{ op: 'replace', path: 'active', value: true }] })).status, 200)
    const policyChanged = await h.begin()
    assert.equal((await h.send('/enterprise/settings', { enabled: false }, h.owner)).status, 200)
    await h.enable()
    assert.ok((await h.callback(policyChanged, h.response(policyChanged))).status >= 400, 'disable and re-enable invalidate pending SAML requests')
    const active = await h.begin(), activeSession = await h.callback(active, h.response(active))
    assert.equal(activeSession.status, 303, activeSession.text)
    await h.send('/enterprise/settings', { enabled: false }, h.owner)
    assert.equal((await h.send('/api/lodge/state', undefined, activeSession.cookie)).status, 401, 'the native provider switch revokes SAML sessions')
  } finally { await h.close() }
}
