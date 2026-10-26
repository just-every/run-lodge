import { DOMParser } from '@xmldom/xmldom'
type XmlElement = ReturnType<InstanceType<typeof DOMParser>['parseFromString']>['documentElement']
import { requireThat } from '../core/types'

const assertionNs = 'urn:oasis:names:tc:SAML:2.0:assertion'
const protocolNs = 'urn:oasis:names:tc:SAML:2.0:protocol'
const signatureNs = 'http://www.w3.org/2000/09/xmldsig#'
const denied = () => { throw new Error('SAML response refused') }
const check = (value: unknown) => requireThat(value, 'SAML response refused')
function children(parent: XmlElement, name: string, ns = assertionNs): XmlElement[] {
  return Array.from(parent.childNodes).filter(n => n.nodeType === 1 && (n as unknown as XmlElement).localName === name && (n as unknown as XmlElement).namespaceURI === ns) as unknown as XmlElement[]
}
function one(parent: XmlElement, name: string, ns = assertionNs) {
  const values = children(parent, name, ns); check(values.length === 1); return values[0]
}
function text(parent: XmlElement, name: string, ns = assertionNs) {
  const value = one(parent, name, ns)
  check(!Array.from(value.childNodes).some(n => n.nodeType === 1))
  return value.textContent ?? ''
}
function parse(xml: string, name: string, ns: string) {
  check(xml.length <= 180000 && !/<!DOCTYPE|<!ENTITY/i.test(xml))
  const doc = new DOMParser({ errorHandler: { warning: denied, error: denied, fatalError: denied } }).parseFromString(xml, 'text/xml')
  const root = doc.documentElement
  check(root.localName === name && root.namespaceURI === ns)
  check(Array.from(doc.childNodes).filter(n => n.nodeType === 1).length === 1)
  // Reject ambiguous IDs before the maintained signature verifier receives XML.
  const ids = new Set<string>()
  for (const element of Array.from(doc.getElementsByTagName('*'))) for (const attr of Array.from(element.attributes)) if (/^id$/i.test(attr.localName)) {
    check(attr.name === 'ID' && /^[A-Za-z_][A-Za-z0-9._-]{0,254}$/.test(attr.value) && !ids.has(attr.value)); ids.add(attr.value)
  }
  return root
}
function instant(value: string) {
  check(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value))
  const result = Date.parse(value); check(Number.isFinite(result)); return result
}
function issue(element: XmlElement) {
  const at = instant(element.getAttribute('IssueInstant') ?? '')
  check(at <= Date.now() && at > Date.now() - 300000)
  check(element.getAttribute('Version') === '2.0' && element.hasAttribute('ID'))
}
function signature(element: XmlElement) {
  const signedInfo = one(one(element, 'Signature', signatureNs), 'SignedInfo', signatureNs)
  check(one(signedInfo, 'CanonicalizationMethod', signatureNs).getAttribute('Algorithm') === 'http://www.w3.org/2001/10/xml-exc-c14n#')
  check(one(signedInfo, 'SignatureMethod', signatureNs).getAttribute('Algorithm') === 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256')
  const reference = one(signedInfo, 'Reference', signatureNs)
  check(reference.getAttribute('URI') === '#' + element.getAttribute('ID'))
  check(one(reference, 'DigestMethod', signatureNs).getAttribute('Algorithm') === 'http://www.w3.org/2001/04/xmlenc#sha256')
  const transforms = children(one(reference, 'Transforms', signatureNs), 'Transform', signatureNs)
  check(transforms.length === 2 && transforms[0].getAttribute('Algorithm') === 'http://www.w3.org/2000/09/xmldsig#enveloped-signature' && transforms[1].getAttribute('Algorithm') === 'http://www.w3.org/2001/10/xml-exc-c14n#')
}

/** Envelope shape checks supplement Node-SAML, which verifies both signatures. */
export function samlEnvelope(xml: string, issuer: string, callback: string, requestId: string) {
  const root = parse(xml, 'Response', protocolNs)
  issue(root); signature(root)
  check(root.getAttribute('Destination') === callback && root.getAttribute('InResponseTo') === requestId)
  check(text(root, 'Issuer') === issuer)
  check(one(one(root, 'Status', protocolNs), 'StatusCode', protocolNs).getAttribute('Value') === 'urn:oasis:names:tc:SAML:2.0:status:Success')
  check(children(root, 'EncryptedAssertion').length === 0)
  const assertion = one(root, 'Assertion'); signature(assertion)
  check(root.getElementsByTagNameNS(assertionNs, 'Assertion').length === 1)
  return root.getAttribute('ID')!
}

/** Only call on the verified assertion XML returned by Node-SAML. */
export function samlSubject(xml: string, issuer: string, callback: string, entityId: string, requestId: string) {
  const assertion = parse(xml, 'Assertion', assertionNs)
  issue(assertion)
  check(text(assertion, 'Issuer') === issuer)
  const subject = one(assertion, 'Subject'), nameId = text(subject, 'NameID')
  check(/^[A-Za-z0-9._-]{1,255}$/.test(nameId))
  const confirmation = one(subject, 'SubjectConfirmation')
  check(confirmation.getAttribute('Method') === 'urn:oasis:names:tc:SAML:2.0:cm:bearer')
  const data = one(confirmation, 'SubjectConfirmationData')
  check(data.getAttribute('Recipient') === callback && data.getAttribute('InResponseTo') === requestId)
  check(instant(data.getAttribute('NotOnOrAfter') ?? '') > Date.now())
  if (data.hasAttribute('NotBefore')) check(instant(data.getAttribute('NotBefore')!) <= Date.now())
  const conditions = one(assertion, 'Conditions')
  check(instant(conditions.getAttribute('NotBefore') ?? '') <= Date.now() && instant(conditions.getAttribute('NotOnOrAfter') ?? '') > Date.now())
  const audiences = children(conditions, 'AudienceRestriction')
  check(audiences.length > 0 && audiences.every(a => children(a, 'Audience').some(e => e.textContent === entityId)))
  const authn = one(assertion, 'AuthnStatement')
  check(instant(authn.getAttribute('AuthnInstant') ?? '') <= Date.now())
  if (authn.hasAttribute('SessionNotOnOrAfter')) check(instant(authn.getAttribute('SessionNotOnOrAfter')!) > Date.now())
  return { subject: nameId, assertionId: assertion.getAttribute('ID')! }
}
