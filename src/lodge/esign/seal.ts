import type { State } from '../core/state'
import { businessZone, times } from '../core/time'
import { sha256, type Data } from '../core/types'
import { pdf } from './pdf'

// OFFER-005 seal: the approved document's bytes plus a signature page, with a separate completion certificate. Both are
// tamper-evident by their recorded SHA-256, and neither claims to be a PKI digital signature.

export const SEAL_LABEL = 'Tamper-evident by recorded SHA-256 fingerprint; not a PKI digital signature.'
export const AUTHORITY_LABEL = 'Lodge records the employer’s designation and does not verify signing authority.'

const stampOf = (s: State) => {
  const zone = businessZone(s.find('business', 'main')), t = times(zone)
  return { zone, at: (iso: string) => `${iso} UTC / ${t.stamped(iso)}` }
}

function party(at: (iso: string) => string, e: Data) {
  const sig = e.signature, consent = e.consent, counter = e.countersignature
  const lines = [
    `Party 1: ${e.recipientName}`, 'Role: candidate', `Verified email: ${e.verifiedEmail ?? e.recipient}`,
    'Authentication method: emailed one-time code', `Authentication result: verified ${at(e.verifiedAt)}; incorrect codes on record: ${e.gate.incorrect}`,
    `Consent version: ${consent.version}`, `Consent fingerprint: ${consent.fingerprint}`, `Consent time: ${at(consent.at)}`, `Consent IP address: ${consent.ip}`, `Consent user agent: ${consent.ua}`,
    `Adopted name: ${sig.name}`, `Signed: ${at(sig.at)}`, `Signing IP address: ${sig.ip}`, `Signing user agent: ${sig.ua}`,
  ]
  if (counter) lines.push('', `Party 2: ${counter.name}`, `Role: countersigner for ${e.businessName}`, `Verified email: ${counter.email}`,
    'Authentication method: Lodge native session', `Authentication result: signed in ${at(counter.signInAt)}`,
    `Adopted name: ${counter.name}`, `Countersigned: ${at(counter.at)}`, `Countersigning IP address: ${counter.ip}`, `Countersigning user agent: ${counter.ua}`,
    `Signed for ${e.businessName} by ${counter.name}, designated offer signer (designated by ${counter.designation.designatedBy}, ${counter.designation.at.slice(0, 10)});`, AUTHORITY_LABEL)
  return lines
}

/** The approved bytes (their text) and a signature page. */
export async function sealedPdf(s: State, e: Data, offer: Data) {
  const { at } = stampOf(s)
  const sig = e.signature, counter = e.countersignature
  return pdf([
    { title: `Offer document: approved text, SHA-256 ${offer.document.sha256}`, lines: [offer.document.text] },
    { title: 'Electronic signatures', lines: [
      `Signed electronically in Lodge for ${e.businessName}.`, `Approved document SHA-256: ${offer.document.sha256}`, '',
      `Candidate: ${sig.name}`, `Role: candidate`, `Signed: ${at(sig.at)}`,
      ...(counter ? ['', `Employer: ${counter.name}`, `Role: countersigner for ${e.businessName}`, `Countersigned: ${at(counter.at)}`] : []),
      '', SEAL_LABEL] },
  ])
}

export async function certificatePdf(s: State, e: Data, offer: Data, sealedSha: string) {
  const { at } = stampOf(s)
  return pdf([{ title: 'Lodge electronic signature completion certificate', lines: [
    `Envelope: ${e.id}`, `Employer legal name: ${e.businessName}`, `Sent by: ${e.sentBy} at ${at(e.sentAt)}`, `Link expiry: ${at(e.expiresAt)}`,
    `Approved terms version: ${e.termsVersion}`, `Offer template: ${e.template.name}, version ${e.template.version}`,
    `Approved document SHA-256: ${offer.document.sha256}`, `Sealed PDF SHA-256: ${sealedSha}`, '',
    ...party(at, e), '', SEAL_LABEL, `Completed: ${at(e.completedAt)}`,
  ] }])
}

export const digest = (bytes: Uint8Array) => sha256(bytes)
