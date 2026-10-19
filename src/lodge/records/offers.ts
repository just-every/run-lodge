import type { State } from '../core/state'
import { requireApplication, requireManages } from '../core/access'
import { currency, date, money, now, oneOf, optionalText, requireThat, text, uid, type Actor, type Data } from '../core/types'
import { approvedNow, requestApproval, versionOf } from './approvals'
import { storeDocument } from './documents'
import { cancelTasks } from './tasks'
import { fill, namedOpening } from './openings'

// Flow 11: an offer record, its approval packet, the approval bound to the
// exact terms, and the recorded outcome. Accepting records the hire and opens
// an HR handoff export. An offer record is not executed employment paperwork.

export function offer(s: State, a: Actor, b: Data) {
  const app = requireApplication(s, a, b.application)
  const vacancy = s.get('vacancy', app.vacancy)
  requireManages(a, vacancy)
  requireThat(app.status === 'active', 'This application is closed', 409)
  const fields = {
    application: app.id, title: text(b.title ?? vacancy.title, 'Job title', 160),
    salary: { currency: currency(b.salary?.currency), amount: money(b.salary?.amount, 'Salary'), period: oneOf(b.salary?.period, ['year', 'month', 'hour'] as const, 'Pay period') },
    startDate: date(b.startDate, 'Start date'), terms: optionalText(b.terms, 'Other terms', 8000),
    // REQ-001: the opening this offer fills once accepted; part of the approved terms.
    opening: namedOpening(vacancy, b.opening),
  }
  if (b.id) {
    const current = s.get('offer', b.id)
    requireThat(current.application === app.id && current.status === 'draft', 'Only a draft offer can change', 409)
    const record = s.put('offer', current.id, { ...current, ...fields, editedAt: now() })
    s.audit(a, 'offer-edited', 'offer:' + current.id)
    return record
  }
  // scan() fences the whole offer set, so two drafts racing for one application cannot both commit.
  requireThat(!s.scan('offer').some(o => o.application === app.id && o.status === 'draft'), 'This application already has a draft offer', 409)
  const record = s.put('offer', uid(), { ...fields, status: 'draft', createdBy: a.email, createdAt: now() })
  s.audit(a, 'offer-drafted', 'offer:' + record.id)
  return record
}

/** Out-of-range pay is not refused, but the approver sees it plainly in the packet. */
export function rangeCheck(vacancy: Data, o: Data) {
  const c = vacancy.compensation
  if (!c) return 'The vacancy has no approved range'
  if (c.currency !== o.salary.currency || c.period !== o.salary.period) return `The approved range is in ${c.currency} per ${c.period}`
  if (o.salary.amount < c.min || o.salary.amount > c.max) return 'Outside the approved range'
  return null
}

export async function requestOfferApproval(s: State, a: Actor, b: Data) {
  const o = s.get('offer', b.id)
  const app = requireApplication(s, a, o.application)
  requireManages(a, s.get('vacancy', app.vacancy))
  requireThat(o.status === 'draft', 'This offer is closed', 409)
  return requestApproval(s, a, 'offer', o, b.approver)
}

export async function outcome(s: State, a: Actor, b: Data) {
  const o = s.get('offer', b.id)
  const app = requireApplication(s, a, o.application)
  const vacancy = s.get('vacancy', app.vacancy)
  requireManages(a, vacancy)
  requireThat(o.status === 'draft', 'This offer already has an outcome', 409)
  const result = oneOf(b.outcome, ['accepted', 'declined', 'withdrawn'] as const, 'Outcome')
  // A closed application keeps its close; only withdrawing its leftover draft is still allowed.
  if (result !== 'withdrawn') requireThat(app.status === 'active', 'This application is closed', 409)
  const reason = text(b.reason, 'Reason or note', 2000)
  // Making or accepting an offer needs the approval to match these exact terms now.
  if (result !== 'withdrawn') requireThat(await approvedNow(s, 'offer', o), 'The offer needs a current approval of these exact terms', 409)
  if (result === 'accepted') return accept(s, a, o, app, vacancy, reason)
  const record = s.put('offer', o.id, { ...o, status: result, outcomeReason: reason, outcomeBy: a.email, outcomeAt: now() })
  s.audit(a, 'offer-' + result, 'offer:' + o.id, { reason })
  return record
}

/** Acceptance records the hire: the application closes as hired, the named opening fills and its tasks are canceled. */
function accept(s: State, a: Actor, o: Data, app: Data, vacancy: Data, reason: string, extra: Data = {}) {
  const filled = fill(vacancy, o, app.id)
  const record = s.put('offer', o.id, { ...o, status: 'accepted', outcomeReason: reason, outcomeBy: a.email, outcomeAt: now(), ...extra })
  s.put('application', app.id, { ...app, status: 'hired', closedAt: now() })
  s.put('vacancy', vacancy.id, { ...filled, hires: (vacancy.hires ?? 0) + 1 })
  s.put('stage-event', uid(), { application: app.id, from: app.stage, to: 'hired', reason: 'Offer accepted: ' + reason, actor: a.email, at: now() })
  cancelTasks(s, app.id, 'Application hired')
  s.audit(a, 'offer-accepted', 'offer:' + o.id, { reason, ...(extra.signature ? { signature: 'outside', sha256: extra.signature.sha256 } : {}) })
  return record
}

export const OUTSIDE_LABEL = 'accepted, signed outside Lodge (not provider-verified)'
export const SIGNING_METHODS = ['hris', 'paper', 'other-tool'] as const

/**
 * OFFER-006: someone who runs the job uploads the original signed outside Lodge and attests it is the signed
 * version of the approved offer, naming the method and any differences. The bytes and their SHA-256 are bound to
 * the approved terms' version; the offer reads "accepted, signed outside Lodge (not provider-verified)" and the
 * hire is recorded, as an accepted outcome is. Only an offer whose exact terms are approved now can be signed.
 */
export async function signedOutside(s: State, a: Actor, b: Data) {
  const o = s.get('offer', b.id)
  const app = requireApplication(s, a, o.application)
  const vacancy = s.get('vacancy', app.vacancy)
  requireManages(a, vacancy)
  requireThat(o.status === 'draft', 'This offer already has an outcome', 409)
  requireThat(app.status === 'active', 'This application is closed', 409)
  requireThat(await approvedNow(s, 'offer', o), 'Only an offer whose exact terms are approved now can be recorded as signed', 409)
  requireThat(b.attest === true, 'Attest that the file is the signed version of the approved offer')
  const method = oneOf(b.method, SIGNING_METHODS, 'How it was signed')
  const differences = optionalText(b.differences, 'Differences from the approved offer', 2000)
  const doc = await storeDocument(s, { candidate: app.candidate, application: app.id, name: b.name, mediaType: b.mediaType, base64: b.base64, kind: 'offer', source: 'signed original uploaded by ' + a.email })
  const signature = { kind: 'outside', label: OUTSIDE_LABEL, method, differences, document: doc.id, sha256: doc.sha256, termsVersion: await versionOf(s, 'offer', o), attestedBy: a.email, attestedAt: now(), providerVerified: false }
  s.audit(a, 'document-added', 'document:' + doc.id, { kind: doc.kind, restricted: doc.restricted })
  return accept(s, a, o, app, vacancy, `signed outside Lodge (${method})${differences ? '; differences: ' + differences : ''}`, { signature })
}
