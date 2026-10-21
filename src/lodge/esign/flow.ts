import type { State } from '../core/state'
import { can, managesVacancy, requireApplication, requireCan, requireManages } from '../core/access'
import { now, requireThat, text, uid, type Actor, type Data } from '../core/types'
import { approvedNow, versionOf } from '../records/approvals'
import { accept } from '../records/offers'
import { storeDocument } from '../records/documents'
import { isDesignated } from './disclosure'
import { LIMITS, event, expire, lapsed, notifyManagers, queueNotice, signerSeesOffer } from './envelope'
import { checkCode, endSigning, freshGate, issueCode, sessionFor, type Refusal } from './gate'
import { newToken, tokenHash } from './secrets'
import { certificatePdf, sealedPdf, digest } from './seal'
import { bytesToBase64 } from '../core/types'

// OFFER-005: the candidate's steps (code, verification, consent, withdrawal, signing), the employer's countersignature
// and completion. Each step returns `{ ok: false, status, message }` for a refusal; whatever it recorded before refusing
// (a wrong-code count, a lock) is saved by the caller either way.

export type Step<T = {}> = ({ ok: true } & T) | ({ ok: false } & Refusal)
const refuse = (status: number, message: string): Step<never> => ({ ok: false, status, message })

export interface Edge { ip: string; ua: string }
const bind = (e: Data, purpose: 'sign' | 'copy' = 'sign') => ({ envelope: e.id, linkVersion: e.linkVersion, recipient: e.recipient, purpose })

/** The in-flight envelope a link token names, or undefined (a voided, finished or unknown link resolves to nothing). */
export async function byLink(s: State, token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return undefined
  const hash = await tokenHash(token)
  const found = s.all('esign-envelope').find(e => e.linkHash === hash)
  return found ? s.get('esign-envelope', found.id) : undefined
}

/** The completed envelope a copy-link token names. */
export async function byCopyLink(s: State, token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return undefined
  const hash = await tokenHash(token)
  const found = s.all('esign-envelope').find(e => e.copy?.linkHash === hash && e.status === 'completed')
  return found ? s.get('esign-envelope', found.id) : undefined
}

/** A link past its expiry refuses viewing, codes and signing; `settle` records the expiry (a write) when the caller can save. */
export function usable(s: State, e: Data, settle: boolean): Step {
  if (lapsed(e)) { if (settle) expire(s, e); return refuse(410, 'This signing link has expired. Ask the employer to send a new signing request.') }
  if (e.status !== 'active') return refuse(409, 'This signing request is no longer open.')
  return { ok: true }
}

export async function requestCode(s: State, e: Data, secret: string): Promise<Step<{ code: string; to: string }>> {
  const live = usable(s, e, true); if (!live.ok) return live
  const out = await issueCode(e.gate, bind(e), secret)
  if (out.lockedNow) { s.put('esign-envelope', e.id, { ...e, gate: out.gate }); event(s, e, 'esign-locked', { codesIssued: e.gate.issued }); notifyManagers(s, e, 'A signing link was locked after too many codes', 'Send a new signing request to continue.') }
  if (out.refusal) return refuse(out.refusal.status, out.refusal.message)
  s.put('esign-envelope', e.id, { ...e, gate: out.gate })
  event(s, e, 'esign-code-sent', { purpose: 'sign', number: out.gate.issued })
  return { ok: true, code: out.code!, to: e.recipient }
}

export async function verifyCode(s: State, e: Data, secret: string, code: unknown): Promise<Step<{ token: string; expires: string }>> {
  const live = usable(s, e, true); if (!live.ok) return live
  const out = await checkCode(e.gate, bind(e), secret, code, e.expiresAt)
  const failed = out.gate.incorrect > e.gate.incorrect
  const verified = out.token ? { verifiedAt: now(), verifiedEmail: e.recipient } : {}
  s.put('esign-envelope', e.id, { ...e, gate: out.gate, ...verified })
  if (failed) event(s, e, 'esign-code-failed', { incorrect: out.gate.incorrect })
  if (out.refusal) return refuse(out.refusal.status, out.refusal.message)
  event(s, e, 'esign-verified', { email: e.recipient })
  return { ok: true, token: out.token!, expires: out.gate.sessions.at(-1).expiresAt }
}

async function verified(s: State, e: Data, cookie: string | undefined, signing = true): Promise<Step<{ done: boolean }>> {
  const session = await sessionFor(e.gate, cookie)
  if (!session) return refuse(403, 'Verify your email with a code first.')
  if (signing && session.done) return refuse(409, 'You have already signed this offer.')
  return { ok: true, done: !!session.done }
}

export async function agree(s: State, e: Data, cookie: string | undefined, input: { version: unknown; box: unknown }, edge: Edge): Promise<Step> {
  const live = usable(s, e, true); if (!live.ok) return live
  const who = await verified(s, e, cookie); if (!who.ok) return who

  if (input.box !== 'yes') return refuse(400, 'Tick the box to agree to sign electronically.')
  if (String(input.version) !== String(e.disclosure.version)) return refuse(409, 'The disclosure changed. Read it again.')
  s.put('esign-envelope', e.id, { ...e, consent: { version: e.disclosure.version, fingerprint: e.disclosure.fingerprint, email: e.recipient, at: now(), ip: edge.ip, ua: edge.ua } })
  event(s, e, 'esign-consent', { version: e.disclosure.version, fingerprint: e.disclosure.fingerprint })
  return { ok: true }
}

/** Withdrawing consent stops the envelope; the offer stays open and staff may continue on paper. */
export async function withdraw(s: State, e: Data, cookie: string | undefined): Promise<Step> {
  const live = usable(s, e, true); if (!live.ok) return live
  const who = await verified(s, e, cookie); if (!who.ok) return who
  s.put('esign-envelope', e.id, { ...e, status: 'withdrawn', linkHash: null, gate: { ...e.gate, current: null, sessions: [] }, endedAt: now(), consentWithdrawnAt: now() })
  event(s, e, 'esign-consent-withdrawn')
  notifyManagers(s, e, 'The candidate withdrew consent to sign electronically', 'The offer stays open; continue on paper or record it as signed outside Lodge.')
  return { ok: true }
}

/** The candidate adopts a typed name and signs the exact approved document: every check runs against the saved records now. */
export async function sign(s: State, e: Data, cookie: string | undefined, input: { name: unknown; hash: unknown }, edge: Edge): Promise<Step<{ again?: boolean }>> {
  if (e.signature && ['candidate-signed', 'completed'].includes(e.status)) {
    // A repeated submit never makes a second signature.
    const session = await sessionFor(e.gate, cookie)
    if (session && input.hash === e.documentSha256 && String(input.name ?? '').trim() === e.signature.name) return { ok: true, again: true }
    return refuse(409, 'You have already signed this offer.')
  }
  const live = usable(s, e, true); if (!live.ok) return live
  const who = await verified(s, e, cookie); if (!who.ok) return who
  if (e.consent?.fingerprint !== e.disclosure.fingerprint) return refuse(409, 'Agree to sign electronically before signing.')
  const name = String(input.name ?? '').trim()
  if (!name || name.length > 200) return refuse(400, 'Type your full name (up to 200 characters) to sign.')
  const offer = s.get('offer', e.offer), app = s.get('application', e.application)
  if (input.hash !== e.documentSha256 || input.hash !== offer.document?.sha256) return refuse(409, 'The offer changed since you opened it. Ask the employer for a new signing request.')
  if (offer.status !== 'draft' || app.status !== 'active' || !(await approvedNow(s, 'offer', offer)) || (await versionOf(s, 'offer', offer)) !== e.termsVersion) return refuse(409, 'This offer is no longer approved as you read it. Ask the employer for a new signing request.')
  const signed = { ...e, signature: { name, at: now(), ip: edge.ip, ua: edge.ua, hash: e.documentSha256 }, gate: endSigning(e.gate) }
  event(s, e, 'esign-signed', { sha256: e.documentSha256 })
  if (e.countersign.required) {
    s.put('esign-envelope', e.id, { ...signed, status: 'candidate-signed' })
    s.put('notification', uid(), { to: e.countersign.signer, kind: 'esign', title: 'Countersign an offer signed by the candidate', application: e.application, offer: e.offer, reason: '', at: now() })
    notifyManagers(s, e, 'The candidate signed; awaiting countersignature')
    return { ok: true }
  }
  await complete(s, signed, null)
  return { ok: true }
}

/** Why an actor may not countersign now, or null. The designation, humanity, access and sign-in age are all read at this moment. */
function countersignRefusal(s: State, a: Actor, e: Data, signInAt: number, grants: (m: Data) => Actor['grants']): Refusal | null {
  if (a.agent) return { status: 403, message: 'Agent members cannot countersign' }
  if (e.countersign.signer !== a.email) return { status: 403, message: 'Only the designated countersigner can countersign this offer' }
  if (!isDesignated(s, a.email)) return { status: 403, message: 'You are not a designated offer signer' }
  if (!signerSeesOffer(s, a.email, s.get('vacancy', e.vacancy), grants) || !can(s, a, s.get('vacancy', e.vacancy), 'offers') || !managesVacancy(a, s.get('vacancy', e.vacancy))) return { status: 403, message: 'You cannot see this offer' }
  if (Date.now() - signInAt > LIMITS.stepUp) return { status: 403, message: 'Sign in again before countersigning: your sign-in is older than 15 minutes.' }
  return null
}

/** The employer's designated signer countersigns; the sealed PDF and certificate follow and the hire is recorded. */
export async function countersign(s: State, a: Actor, b: Data, edge: Edge, signInAt: number, grants: (m: Data) => Actor['grants']): Promise<Step<{ envelope: Data }>> {
  const e = s.get('esign-envelope', b.id, 'signing request')
  const offer = s.get('offer', e.offer)
  const app = requireApplication(s, a, offer.application); requireManages(a, s.get('vacancy', app.vacancy)); requireCan(s, a, s.get('vacancy', app.vacancy), 'offers')
  requireThat(e.status === 'candidate-signed' && e.countersign.required, 'This offer is not waiting for countersignature', 409)
  const refusal = countersignRefusal(s, a, e, signInAt, grants)
  if (refusal) return { ok: false, ...refusal }
  const name = text(b.name, 'Your full name', 200)
  if (b.hash !== e.documentSha256 || offer.document?.sha256 !== e.documentSha256) return refuse(409, 'The offer changed since you opened it')
  if (offer.status !== 'draft' || app.status !== 'active' || !(await approvedNow(s, 'offer', offer)) || (await versionOf(s, 'offer', offer)) !== e.termsVersion) return refuse(409, 'This offer is no longer approved as signed')
  const done = { ...e, countersignature: { name, email: a.email, at: now(), ip: edge.ip, ua: edge.ua, signInAt: new Date(signInAt).toISOString(), designation: e.countersign.designation } }
  event(s, e, 'esign-countersigned', {}, a)
  return { ok: true, envelope: await complete(s, done, a) }
}

/** Completion is Lodge's own stored signatures read back from the saved record: seal, certificate, hire, handoff record, copy link. */
async function complete(s: State, e: Data, by: Actor | null): Promise<Data> {
  const offer = s.get('offer', e.offer), app = s.get('application', e.application), vacancy = s.get('vacancy', e.vacancy)
  const completedAt = now(), withTime = { ...e, completedAt }
  const sealed = await sealedPdf(s, withTime, offer), sealedSha = await digest(sealed)
  const certificate = await certificatePdf(s, withTime, offer, sealedSha), certificateSha = await digest(certificate)
  const store = (name: string, bytes: Uint8Array) => storeDocument(s, { candidate: e.candidate, application: app.id, name, mediaType: 'application/pdf', base64: bytesToBase64(bytes), kind: 'offer', source: 'Lodge native e-signature ' + e.id })
  const sealedDoc = await store('signed-offer.pdf', sealed), certDoc = await store('signature-certificate.pdf', certificate)
  for (const d of [sealedDoc, certDoc]) s.put('document', d.id, { ...d, esign: e.id })
  const copyToken = newToken()
  const record = s.put('esign-envelope', e.id, {
    ...withTime, status: 'completed', endedAt: completedAt, gate: { ...e.gate, current: null },
    sealed: { document: sealedDoc.id, sha256: sealedSha, certificate: certDoc.id, certificateSha256: certificateSha, at: completedAt },
    copy: { linkHash: await tokenHash(copyToken), gate: freshGate() },
  })
  event(s, e, 'esign-completed', { sealedSha256: sealedSha, certificateSha256: certificateSha }, by)
  const signature = { kind: 'native', label: 'accepted, signed in Lodge (native e-signature)', envelope: e.id, document: sealedDoc.id, sha256: sealedSha, certificate: certDoc.id, certificateSha256: certificateSha, approvedSha256: offer.document.sha256, termsVersion: e.termsVersion, completedAt, providerVerified: false }
  accept(s, by, offer, app, vacancy, 'signed in Lodge (native e-signature)', { signature })
  queueNotice(s, record, 'completion', { copyToken })
  return record
}

/** Copy link: the same code rules under their own counters, then a 24-hour browser session. */
export async function requestCopyCode(s: State, e: Data, secret: string): Promise<Step<{ code: string; to: string }>> {
  const out = await issueCode(e.copy.gate, bind(e, 'copy'), secret)
  if (out.refusal) { if (out.lockedNow) { s.put('esign-envelope', e.id, { ...e, copy: { ...e.copy, gate: out.gate } }); event(s, e, 'esign-copy-locked') } return refuse(out.refusal.status, out.refusal.message) }
  s.put('esign-envelope', e.id, { ...e, copy: { ...e.copy, gate: out.gate } })
  event(s, e, 'esign-code-sent', { purpose: 'copy', number: out.gate.issued })
  return { ok: true, code: out.code!, to: e.recipient }
}

export async function verifyCopyCode(s: State, e: Data, secret: string, code: unknown): Promise<Step<{ token: string }>> {
  const out = await checkCode(e.copy.gate, bind(e, 'copy'), secret, code, null)
  s.put('esign-envelope', e.id, { ...e, copy: { ...e.copy, gate: out.gate } })
  if (out.gate.incorrect > e.copy.gate.incorrect) event(s, e, 'esign-code-failed', { purpose: 'copy', incorrect: out.gate.incorrect })
  if (out.refusal) return refuse(out.refusal.status, out.refusal.message)
  event(s, e, 'esign-copy-verified')
  return { ok: true, token: out.token! }
}

export const copySession = (e: Data, cookie: string | undefined) => sessionFor(e.copy.gate, cookie)

