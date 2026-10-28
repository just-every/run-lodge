import { suppressErasedCapture } from './capture'
import type { State } from '../core/state'
import { requireAdmin, requireCandidate } from '../core/access'
import { date, now, oneOf, optionalText, requireThat, text, uid, type Actor, type Data } from '../core/types'
import { removeDocument } from './documents'
import { mergedCandidates } from './candidate-lineage'
import { eraseSharedHoldText, linkedAudits } from './erasure-history'
import { forgetFill } from './openings'
import { closeOnErasure } from './privacy'

// Flow 12: retention review, legal holds, deletion with a receipt, and the
// candidate's own access, export, correction and deletion requests.

const today = () => new Date().toISOString().slice(0, 10)

export function holdsFor(s: State, candidateId: string) {
  const vacancies = new Set(s.all('application').filter(x => x.candidate === candidateId).map(x => x.vacancy))
  return s.all('hold').filter(h => h.status === 'active' && (h.candidate === candidateId || vacancies.has(h.vacancy)))
}

export function retentionReview(s: State) {
  const due: Data[] = [], held: Data[] = []
  for (const c of s.all('candidate')) {
    if (c.mergedInto || c.deleted || !c.retainUntil || c.retainUntil >= today()) continue
    const active = s.all('application').some(x => x.candidate === c.id && x.status === 'active')
    const holds = holdsFor(s, c.id)
    const row = { candidate: c.id, name: c.name, retainUntil: c.retainUntil, basis: c.consent?.basis, active }
    if (holds.length) held.push({ ...row, holds: holds.map(h => h.id) })
    else if (!active) due.push(row)
  }
  return { due, held }
}

export function hold(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const target = b.candidate ? { candidate: requireCandidate(s, a, b.candidate).id } : { vacancy: s.get('vacancy', b.vacancy).id }
  const record = s.put('hold', uid(), { ...target, reason: text(b.reason, 'Reason for the hold', 1000), status: 'active', placedBy: a.email, placedAt: now() })
  s.audit(a, 'hold-placed', 'hold:' + record.id, target)
  return record
}

export function releaseHold(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const h = s.get('hold', b.id)
  requireThat(h.status === 'active', 'This hold is already released', 409)
  const record = s.put('hold', h.id, { ...h, status: 'released', releasedBy: a.email, releasedAt: now(), releaseReason: text(b.reason, 'Reason', 1000) })
  s.audit(a, 'hold-released', 'hold:' + h.id)
  return record
}

export function extendRetention(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const c = requireCandidate(s, a, b.candidate)
  const record = s.put('candidate', c.id, { ...c, retainUntil: date(b.until, 'Keep until'), retentionNote: text(b.reason, 'Reason', 1000) })
  s.audit(a, 'retention-changed', 'candidate:' + c.id, { until: record.retainUntil })
  return record
}

/** Records that exist only because of this candidate, by kind. */
export function candidateRecords(s: State, candidateId: string) {
  const merged = mergedCandidates(s.scan('candidate'), candidateId)
  const candidateIds = new Set([candidateId, ...merged.map(person => person.id)])
  const apps = s.scan('application').filter(x => candidateIds.has(x.candidate))
  const appIds = new Set(apps.map(x => x.id))
  const byApp = (kind: string) => s.scan(kind).filter(r => appIds.has(r.application) || candidateIds.has(r.candidate))
  const offers = byApp('offer'), messages = byApp('message')
  const subjects = new Set([...offers, ...messages].map(r => r.id))
  const records: Record<string, Data[]> = {
    'survey-response': byApp('survey-response'), 'survey-invitation': byApp('survey-invitation'), 'survey-consent': byApp('survey-consent'), 'survey-stop': byApp('survey-stop'), 'survey-receipt': byApp('survey-receipt'),
    'crm-enrollment': byApp('crm-enrollment'), 'crm-reply': byApp('crm-reply'), 'crm-pool': s.scan('crm-pool').filter(p => p.candidates?.some((id: string) => candidateIds.has(id))), 'hiring-reminder': byApp('hiring-reminder'), 'capture-mail': byApp('capture-mail'), 'application-email': byApp('application-email'), 'application-submission': byApp('application-submission'),
    'candidate-email-change': byApp('candidate-email-change'),
    'reference-questionnaire': byApp('reference-questionnaire'), 'reference-record': byApp('reference-record'),
    application: apps, 'stage-event': byApp('stage-event'), interview: byApp('interview'), scorecard: byApp('scorecard'),
    'interview-note': byApp('interview-note'), notification: byApp('notification'), alert: byApp('alert'), 'team-note': byApp('team-note'), task: byApp('task'), debrief: byApp('debrief'), 'rule-match': byApp('rule-match'), 'rejection-email': byApp('rejection-email'), review: byApp('review'), 'fair-chance-record': byApp('fair-chance-record'), 'event-capture': byApp('event-capture'), message: messages, offer: offers, receipt: byApp('receipt'), monitoring: byApp('monitoring'),
    approval: s.scan('approval').filter(x => subjects.has(x.subjectId)),
    // OFFER-005: signing envelopes (consent, IPs, user agents, code counts) and their queued notices are candidate offer records.
    'esign-envelope': byApp('esign-envelope'), 'esign-notice': byApp('esign-notice'),
    document: byApp('document'), 'resume-extraction': byApp('resume-extraction'), 'blind-identity': byApp('blind-identity'),
    // Resume staging is a local transfer: any successful erasure invalidates all pending copies.
    'resume-intake': s.scan('resume-intake').filter(r => r.status !== 'committed' || candidateIds.has(r.candidate)),
    // Records merged into this person hold their old contact details too.
    candidate: merged,
    'data-request': s.scan('data-request').filter(r => candidateIds.has(r.candidate)),
    hold: s.scan('hold').filter(r => candidateIds.has(r.candidate)),
    'deletion-receipt': s.scan('deletion-receipt').filter(r => candidateIds.has(r.candidate)),
    'duplicate-review': s.scan('duplicate-review').filter(r => candidateIds.has(r.first) || candidateIds.has(r.second)),
    'imported-note': byApp('imported-note'), 'imported-rating': byApp('imported-rating'), 'imported-message': byApp('imported-message'),
  }
  // Agency originals and frozen copies follow the candidate, including still-unreviewed duplicate submissions.
  const submissions = s.scan('agency-submission')
  const linked = submissions.filter(r => candidateIds.has(r.candidate) || appIds.has(r.application))
  const contacts = new Set([...s.scan('candidate').filter(c => candidateIds.has(c.id)), ...linked].map(c => c.email?.toLowerCase()).filter(Boolean))
  records['agency-submission'] = submissions.filter(r => linked.includes(r) || contacts.has(r.email?.toLowerCase()))
  records.referral = s.scan('referral').filter(r => candidateIds.has(r.candidate) || appIds.has(r.application) || contacts.has(r.email?.toLowerCase()))
  const related = new Set([candidateId, ...Object.values(records).flat().map(r => r.id)])
  // Include every status and the entire packet. Sources, citations, typed inputs
  // and applied result ids can each be the only remaining link to the person.
  const refers = (value: unknown): boolean => typeof value === 'string' ? related.has(value)
    : Array.isArray(value) ? value.some(refers)
    : !!value && typeof value === 'object' && Object.values(value).some(refers)
  // Delay diagnoses retain multi-case evidence and prose: erase the entire packet when any cited person is erased.
  records.proposal = s.scan('proposal').filter(refers)
  records['workflow-sandbox'] = s.scan('workflow-sandbox').filter(refers)
  records.audit = linkedAudits(s, candidateId, records)
  return records
}

/**
 * Delete a candidate's personal data. Holds and active applications refuse it.
 * What remains is a receipt with counts and the person's record id, no name or contact.
 */
export async function deleteCandidate(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const c = requireCandidate(s, a, b.candidate)
  requireThat(!c.deleted && !c.mergedInto, 'This candidate record is already closed', 409)
  requireThat(b.confirm === c.name, 'Type the candidate’s name exactly to confirm deletion')
  // Validate the explanation, but never retain free text in the erasure receipt.
  text(b.reason, 'Reason for deletion', 1000)
  const records = candidateRecords(s, c.id)
  const candidateIds = new Set([c.id, ...records.candidate.map(person => person.id)])
  const vacancyIds = new Set([...records.application, ...records['agency-submission'], ...records.referral].map(record => record.vacancy))
  const holds = s.scan('hold').filter(h => h.status === 'active' && (candidateIds.has(h.candidate) || vacancyIds.has(h.vacancy)))
  requireThat(!holds.length, 'A legal hold covers this candidate; release it before deleting', 409)
  requireThat(!records.application.some(x => x.status === 'active'), 'Close this candidate’s active applications before deleting', 409)
  // Imported people also live in their import batch's retained original files, which Base import-kit cannot yet erase.
  requireThat(!c.imported && !Object.values(records).flat().some(r => r.imported), 'This person came from an import whose original files still hold their data. Undo that import if nothing changed, or keep the record until imported erasure is available (IMPORTING.md).', 409)
  await suppressErasedCapture(s, [c, ...records.candidate])
  for (const m of records['capture-mail']) for (const f of m.attachments) s.drop('blob', f.id)
  const counts: Record<string, number> = {}
  for (const [kind, rows] of Object.entries(records)) {
    counts[kind] = rows.length
    for (const r of rows) {
      if (kind === 'audit' && ['candidate-progress-published', 'candidate-request-answered', 'candidate-preferences-changed', 'candidate-email-change-requested', 'candidate-email-changed', 'candidate-email-notice-claimed', 'candidate-email-notice-handed-to-mail-provider', 'candidate-email-notice-failed', 'candidate-withdrew'].includes(r.action)) {
        // Keep the account event's fact and opaque actor, without either email or free text.
        s.put('audit', r.id, { at: r.at, actor: r.actor, action: r.action, record: r.record })
      }
      else if (kind === 'document') removeDocument(s, r.id)
      else if ((kind === 'agency-submission' || kind === 'referral')) { for (const file of r.files) s.drop('blob', file.id); s.remove(kind, r.id) }
      else { if (kind === 'resume-intake' && r.status !== 'committed') s.drop('blob', r.id); s.remove(kind, r.id) }
    }
  }
  eraseSharedHoldText(s, vacancyIds)
  const erasedApps = new Set(records.application.map(app => app.id))
  for (const id of vacancyIds) { const v = s.find('vacancy', id), kept = v && forgetFill(v, erasedApps); if (kept) s.put('vacancy', id, kept) }
  const receipt = s.put('deletion-receipt', uid(), { candidate: c.id, counts, by: a.email, at: now() })
  closeOnErasure(s, records['data-request'], receipt.id)
  s.put('candidate', c.id, { deleted: true, deletedAt: receipt.at, receipt: receipt.id })
  s.audit(a, 'candidate-deleted', 'candidate:' + c.id, { receipt: receipt.id })
  return receipt
}

export const REQUEST_TYPES = ['access', 'export', 'correction', 'deletion'] as const

export function dataRequest(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const c = requireCandidate(s, a, b.candidate)
  requireThat(!c.deleted, 'This candidate was deleted', 409)
  const record = s.put('data-request', uid(), { candidate: c.id, candidateName: c.name, type: oneOf(b.type, REQUEST_TYPES, 'Request type'), receivedAt: date(b.receivedAt ?? today(), 'Received on'), channel: text(b.channel ?? 'email', 'How it arrived', 200), note: optionalText(b.note, 'Note', 2000), status: 'open', recordedBy: a.email })
  s.audit(a, 'data-request', 'data-request:' + record.id, { type: record.type })
  return record
}

export function completeRequest(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const r = s.get('data-request', b.id)
  requireThat(r.status === 'open', 'This request is already complete', 409)
  const record = s.put('data-request', r.id, { ...r, status: 'complete', completedBy: a.email, completedAt: now(), outcome: text(b.outcome, 'What was done', 2000) })
  s.audit(a, 'data-request-complete', 'data-request:' + r.id)
  return record
}
