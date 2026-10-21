import type { State } from '../core/state'
import { can, hiringManagers, managesVacancy, requireApplication, requireCan, requireManages } from '../core/access'
import { integer, now, optionalText, requireThat, text, uid, type Actor, type Data } from '../core/types'
import { approvedNow, versionOf } from '../records/approvals'
import { disclosureHistory, disclosureText, isDesignated } from './disclosure'
import { newToken, tokenHash } from './secrets'
import { sha256 } from '../core/types'

// OFFER-005: one Lodge-native signing envelope per offer. The record never holds a plain link token, session
// token or code: only their hashes (gate.ts). Every step is an append-only audit event without secrets.

export const LIMITS = { codeTtl: 600_000, codeGap: 60_000, codeCap: 10, tries: 5, session: 86_400_000, stepUp: 900_000 }
export const LABELS: Record<string, string> = {
  active: 'out for native signature', 'candidate-signed': 'signed by candidate, awaiting countersignature',
  completed: 'accepted, signed in Lodge (native e-signature)', voided: 'signing request voided', withdrawn: 'candidate withdrew electronic consent', expired: 'signing link expired',
}
export const IN_FLIGHT = new Set(['active', 'candidate-signed'])

export const lapsed = (e: Data, at = Date.now()) => e.status === 'active' && Date.parse(e.expiresAt) <= at
export const envelopesOf = (s: State, offer: string) => s.all('esign-envelope').filter(e => e.offer === offer)

/** The candidate's side acts as an opaque envelope id; staff acts as themselves. */
export function event(s: State, e: Data, action: string, detail: Data = {}, a: Actor | null = null) {
  const record = 'offer:' + e.offer
  if (a) return s.audit(a, action, record, { envelope: e.id, ...detail })
  s.put('audit', uid(), { at: now(), actor: 'envelope:' + e.id, email: 'envelope:' + e.id, action, record, envelope: e.id, ...detail })
}

/** In-app items for the sender and the job's hiring managers. */
export function notifyManagers(s: State, e: Data, title: string, reason = '') {
  const vacancy = s.get('vacancy', e.vacancy)
  for (const to of new Set([e.sentBy, ...hiringManagers(vacancy)])) s.put('notification', uid(), { to, kind: 'esign', title, application: e.application, offer: e.offer, reason, at: now() })
}

/** Terms-free mail waiting for the transactional sender; the row is claimed before sending and never resent blindly. */
export function queueNotice(s: State, e: Data, kind: 'void' | 'completion', extra: Data = {}) {
  s.put('esign-notice', uid(), { kind, envelope: e.id, offer: e.offer, application: e.application, candidate: e.candidate, to: e.recipient, businessName: e.businessName, contact: e.contact, status: 'pending', at: now(), ...extra })
}

/** Ends the live material (link, code, sessions); the record stays as offer history until erasure. */
function close(s: State, e: Data, status: string, patch: Data = {}) {
  return s.put('esign-envelope', e.id, { ...e, status, linkHash: null, gate: { ...e.gate, current: null, sessions: [] }, endedAt: now(), ...patch })
}

/** Void in the same transaction as the change that triggered it. A candidate signature awaiting countersignature goes too. */
export function voidEnvelope(s: State, e: Data, reason: string, a: Actor | null = null) {
  requireThat(IN_FLIGHT.has(e.status), 'This signing request is no longer active', 409)
  const next = close(s, e, 'voided', { voidReason: reason, voidedBy: a?.email ?? 'automatic' })
  event(s, e, 'esign-voided', { reason, ...(e.signature ? { candidateSignatureVoided: true } : {}) }, a)
  queueNotice(s, e, 'void')
  return next
}

export function expire(s: State, e: Data) {
  const next = close(s, e, 'expired')
  event(s, e, 'esign-expired')
  return next
}

/** Voids every in-flight envelope whose offer, application or candidate moved on; called for each save. */
export async function settleEnvelopes(s: State) {
  for (const e of s.all('esign-envelope')) {
    if (!IN_FLIGHT.has(e.status)) continue
    if (lapsed(e)) { expire(s, e); continue }
    const offer = s.all('offer').find(o => o.id === e.offer)
    if (!offer) continue
    const app = s.all('application').find(x => x.id === e.application), person = s.all('candidate').find(c => c.id === e.candidate)
    const reason = offer.status !== 'draft' ? 'offer-outcome-recorded'
      : app?.status !== 'active' ? 'application-closed'
      : !person || person.deleted || person.email?.toLowerCase() !== e.recipient ? 'candidate-email-changed'
      : (await versionOf(s, 'offer', offer)) !== e.termsVersion ? 'offer-edited' : ''
    if (reason) voidEnvelope(s, e, reason)
  }
}

/** The sender's choices at send: expiry in days, required countersignature and its designated signer. */
export interface SendInput { id?: string; offer?: string; days?: unknown; countersign?: unknown; signer?: unknown }

function sendRights(s: State, a: Actor, offer: Data) {
  const app = requireApplication(s, a, offer.application)
  const vacancy = s.get('vacancy', app.vacancy)
  requireManages(a, vacancy)
  requireCan(s, a, vacancy, 'offers')
  return { app, vacancy }
}

/** Whether a member can see this offer today (the OFFER-006 meaning of offer rights), judged from their saved record. */
export function signerSeesOffer(s: State, who: string, vacancy: Data, grants: (m: Data) => Actor['grants']) {
  const m = s.find('member', who)
  if (!m?.active || m.agent) return false
  const asActor: Actor = { id: who, email: who, name: m.name, session: '', version: 0, owner: m.owner === true, roles: m.owner ? ['admin', 'manager', 'interviewer', 'approver'] : m.roles, agent: false, seePrivate: m.seePrivate === true, grants: m.owner ? undefined : grants(m), memberships: [] }
  return managesVacancy(asActor, vacancy) && can(s, asActor, vacancy, 'offers')
}

/**
 * Staff send an approved offer for native signature. Only a person with offer-management rights, only an offer with no
 * outcome on an active application whose exact document and terms hash is approved now and whose reviewed template
 * version chooses the native path; one in-flight envelope per offer. Returns the link token once, for the invitation.
 */
export async function createEnvelope(s: State, a: Actor, b: SendInput, grants: (m: Data) => Actor['grants']) {
  requireThat(!a.agent, 'Agent members cannot send an offer for signature', 403)
  const offer = s.get('offer', b.offer ?? b.id)
  const { app, vacancy } = sendRights(s, a, offer)
  requireThat(offer.status === 'draft', 'This offer already has an outcome', 409)
  requireThat(app.status === 'active', 'This application is closed', 409)
  requireThat(offer.document?.signing?.native === true, 'This offer’s template version does not use Lodge-native signature', 409)
  requireThat(await approvedNow(s, 'offer', offer), 'Only an offer whose exact document and terms are approved now can be sent for signature', 409)
  for (const e of envelopesOf(s, offer.id)) if (e.status === 'active' && lapsed(e)) expire(s, e)
  requireThat(!envelopesOf(s, offer.id).some(e => IN_FLIGHT.has(e.status)), 'This offer already has an active signing request; void it first', 409)
  const disclosure = disclosureHistory(s).at(-1)
  requireThat(disclosure, 'Review the electronic signature disclosure first', 409)
  const candidate = s.get('candidate', app.candidate)
  requireThat(candidate.email && !candidate.deleted, 'The candidate has no email address to send to', 409)
  const days = b.days === undefined || b.days === '' ? 7 : integer(b.days, 'Days until the link expires', 1, 30)
  const template = offer.document.signing
  const required = template.countersign === true || b.countersign === true || b.countersign === 'true'
  let signer: string | null = null
  if (required) {
    signer = text(b.signer ?? template.signer, 'Countersigner').toLowerCase()
    requireThat(isDesignated(s, signer), 'The countersigner must be a designated offer signer', 409)
    requireThat(signerSeesOffer(s, signer, vacancy, grants), 'The countersigner cannot see this offer', 409)
  }
  const business = s.get('business', 'main')
  const sender = { name: a.name, email: a.email }
  const contact = { name: disclosure.contactName || sender.name, email: disclosure.contactEmail || sender.email }
  const shown = disclosureText(disclosure, business.name, sender)
  const token = newToken(), id = uid(), at = now()
  const envelope = s.put('esign-envelope', id, {
    offer: offer.id, application: app.id, candidate: candidate.id, vacancy: vacancy.id, status: 'active',
    recipient: candidate.email.toLowerCase(), recipientName: candidate.name, businessName: business.name, contact,
    sentBy: a.email, sentAt: at, expiresAt: new Date(Date.parse(at) + days * 86_400_000).toISOString(), linkVersion: 1, linkHash: await tokenHash(token),
    termsVersion: await versionOf(s, 'offer', offer), documentSha256: offer.document.sha256, template: offer.document.template,
    countersign: { required, signer, designation: signer ? designationOf(s, signer) : null, moves: [] },
    disclosure: { version: disclosure.version, templateFingerprint: disclosure.fingerprint, text: shown, fingerprint: await sha256(shown) },
    gate: { issued: 0, incorrect: 0, locked: false, current: null, sessions: [] },
  })
  event(s, envelope, 'esign-sent', { expiresAt: envelope.expiresAt, countersign: required ? signer : null }, a)
  return { envelope, token }
}

const designationOf = (s: State, who: string) => {
  const member = s.find('member', who)
  const row = (s.find('esign-signers', 'main')?.signers ?? []).find((x: Data) => x.email === who)
  return { email: who, name: member?.name ?? who, designatedBy: row?.designatedBy ?? 'owner', at: row?.at ?? member?.createdAt ?? now() }
}
export { designationOf }

/** An explicit void by an offer-management member, with a reason. */
export function esignVoid(s: State, a: Actor, b: Data) {
  requireThat(!a.agent, 'Agent members cannot void a signing request', 403)
  const e = s.get('esign-envelope', b.id, 'signing request')
  sendRights(s, a, s.get('offer', e.offer))
  return voidEnvelope(s, e, 'voided: ' + text(b.reason, 'Reason for voiding', 1000), a)
}

/** Before countersigning, offer-management may move the countersignature to another designated signer; the document is unchanged. */
export function esignMoveSigner(s: State, a: Actor, b: Data, grants: (m: Data) => Actor['grants']) {
  requireThat(!a.agent, 'Agent members cannot move a countersignature', 403)
  const e = s.get('esign-envelope', b.id, 'signing request')
  const { vacancy } = sendRights(s, a, s.get('offer', e.offer))
  requireThat(IN_FLIGHT.has(e.status) && e.countersign.required, 'This signing request has no countersignature to move', 409)
  const to = text(b.signer, 'Countersigner').toLowerCase()
  requireThat(isDesignated(s, to), 'The countersigner must be a designated offer signer', 409)
  requireThat(signerSeesOffer(s, to, vacancy, grants), 'The countersigner cannot see this offer', 409)
  const from = e.countersign.signer
  const record = s.put('esign-envelope', e.id, { ...e, countersign: { ...e.countersign, signer: to, designation: designationOf(s, to), moves: [...e.countersign.moves, { from, to, by: a.email, at: now() }] } })
  event(s, e, 'esign-signer-moved', { from, to }, a)
  if (e.status === 'candidate-signed') s.put('notification', uid(), { to, kind: 'esign', title: 'Countersign an offer signed by the candidate', application: e.application, offer: e.offer, reason: optionalText(b.note, 'Note', 500), at: now() })
  return record
}

/** What staff and the access export may read: no hash, token or code, and no IP or user agent for an agent. */
export function envelopeView(e: Data, agent: boolean): Data {
  const view: Data = { id: e.id, status: lapsed(e) ? 'expired' : e.status, label: LABELS[lapsed(e) ? 'expired' : e.status] }
  if (agent) return view
  return {
    ...view, recipient: e.recipient, sentBy: e.sentBy, sentAt: e.sentAt, expiresAt: e.expiresAt, businessName: e.businessName, contact: e.contact,
    invitation: e.invitation ?? null, termsVersion: e.termsVersion, documentSha256: e.documentSha256, template: e.template,
    countersign: e.countersign, disclosure: { version: e.disclosure.version, fingerprint: e.disclosure.fingerprint }, locked: e.gate.locked, incorrectCodes: e.gate.incorrect, codesIssued: e.gate.issued,
    verifiedAt: e.verifiedAt ?? null, consent: e.consent ?? null, signature: e.signature ?? null, countersignature: e.countersignature ?? null, sealed: e.sealed ?? null,
    voidReason: e.voidReason ?? null, endedAt: e.endedAt ?? null,
  }
}
