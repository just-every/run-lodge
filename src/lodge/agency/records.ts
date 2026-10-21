import type { State } from '../core/state'
import { requireAdmin, canSeeContact } from '../core/access'
import { email, instant, list, money, now, oneOf, optionalText, requireThat, text, uid, type Actor, type Data } from '../core/types'
import { candidateFields, retentionUntil, startApplication } from '../records/candidates'
import { storeOriginal } from '../records/documents'
import { ensureSource } from '../records/sources'
import { listings } from '../records/posts'
import { agencyFor, creditedHire, grantId, invited, staffJob, staffSubmission } from './access'

export const OUTCOMES = ['Under review', 'Accepted-credited', 'Not accepted: duplicate', 'Not accepted'] as const
export const PROGRESS = ['Submitted', 'In review', 'Interviewing', 'Offer', 'Hired', 'Not progressing', 'Withdrawn'] as const

/** Agency identities are native invited members with one exclusive capability. */
export function agency(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const address = email(b.email), current = b.id ? s.get('agency', b.id) : null
  requireThat(!current || current.email === address, 'An agency keeps its invited email', 409)
  const member = s.find('member', address)
  requireThat(!member || (member.roles?.length === 1 && member.roles[0] === 'agency' && !member.agent), 'Use an agency email that is not an employer member', 409)
  const other = s.scan('agency').find(x => x.email === address || x.name.toLowerCase() === String(b.name).trim().toLowerCase())
  requireThat(!other || other.id === current?.id, 'This agency already exists', 409)
  const name = text(b.name, 'Agency name', 120)
  requireThat(!current || current.name === name, 'An agency keeps its credited name', 409)
  const record = s.put('agency', current?.id ?? uid(), { name, email: address, active: b.active !== false })
  s.put('member', address, { email: address, name, roles: ['agency'], active: record.active, agent: false, owner: false, seePrivate: false })
  ensureSource(s, name, 'agency')
  s.audit(a, record.active ? 'agency-saved' : 'agency-revoked', 'agency:' + record.id)
  return record
}
export function agencyJob(s: State, a: Actor, b: Data) {
  const v = staffJob(s, a, b.vacancy), agency = s.get('agency', b.agency)
  requireThat(agency.active || b.active === false, 'This agency is revoked', 409)
  const id = grantId(agency.id, v.id), existing = s.find('agency-job', id)
  const record = s.put('agency-job', id, { agency: agency.id, vacancy: v.id, active: b.active !== false, feeTerms: b.feeTerms === undefined ? existing?.feeTerms ?? '' : optionalText(b.feeTerms, 'Agency fee terms', 2000) })
  s.audit(a, record.active ? 'agency-job-invited' : 'agency-job-removed', 'vacancy:' + v.id, { agency: agency.id })
  return record
}
export async function agencySubmit(s: State, a: Actor, b: Data) {
  const agency = agencyFor(s, a), grant = invited(s, agency, b.vacancy)
  requireThat(grant, 'Agency record not found', 404)
  const v = s.get('vacancy', grant.vacancy)
  const listed = listings(s, 'api').some(x => x.v.id === v.id)
  requireThat(listed && !v.confidential && !v.internalOnly, 'Agency record not found', 404)
  requireThat(b.confirmed === true, 'Confirm the candidate agreed to this agency submission')
  const fields = candidateFields(b)
  requireThat(fields.email, 'Candidate email is required')
  const files = b.resume ? [await storeOriginal(s, b.resume)] : []
  const record = s.put('agency-submission', uid(), { agency: agency.id, vacancy: v.id, ...fields, summary: optionalText(b.summary, 'Agency summary', 4000), consentNote: text(b.consentNote, 'Candidate consent note', 1000), submittedAt: now(), files, outcome: 'Under review', progress: 'Submitted', feedback: '', interviews: [], fees: [], feeTerms: grant.feeTerms })
  s.audit(a, 'agency-submitted', 'agency-submission:' + record.id)
  // No canonical match lookup or identifier is returned to the submitting agency.
  return { id: record.id, outcome: record.outcome, progress: record.progress }
}
export function agencyReview(s: State, a: Actor, b: Data) {
  const sub = staffSubmission(s, a, b.id), v = staffJob(s, a, sub.vacancy), agency = s.get('agency', sub.agency)
  requireThat(sub.outcome === 'Under review', 'This submission already has an ownership decision', 409)
  const outcome = oneOf(b.outcome, OUTCOMES.slice(1), 'Ownership outcome'), reason = text(b.reason, 'Ownership decision reason', 1000)
  let candidate: Data | null = null, app: Data | null = null
  if (outcome === 'Accepted-credited') {
    if (b.candidate) {
      candidate = s.find('candidate', b.candidate) ?? null
      requireThat(candidate && !candidate.deleted && !candidate.mergedInto && canSeeContact(s, a, candidate), 'Candidate not found', 404)
    } else {
      candidate = s.put('candidate', uid(), { ...candidateFields(sub), source: agency.name, consent: { basis: 'referral', talentPool: false, recordedBy: a.email, at: now(), note: sub.consentNote }, retainUntil: retentionUntil(s), createdAt: now() })
    }
    app = startApplication(s, a, candidate, v, agency.name, { credit: { kind: 'agency', who: agency.name, by: a.email, at: now(), automatic: true }, agencySubmission: sub.id, customValues: b.customValues ?? {} })
    for (const f of sub.files) s.put('document', f.id, { ...f, candidate: candidate.id, application: app.id, kind: 'resume', restricted: false, source: 'Agency original: ' + agency.name })
  }
  const record = s.put('agency-submission', sub.id, { ...sub, outcome, candidate: candidate?.id ?? null, application: app?.id ?? null, decidedBy: a.email, decidedAt: now(), decisionReason: reason })
  s.audit(a, 'agency-ownership-decided', 'agency-submission:' + sub.id, { outcome, reason, application: app?.id ?? null })
  return record
}
export function agencyProgress(s: State, a: Actor, b: Data) {
  const sub = staffSubmission(s, a, b.id)
  const interviews = list(b.interviews ?? [], 'Agency interview times', 30, (value: any) => {
    const start = instant(value.start, 'Interview start'), end = instant(value.end, 'Interview end')
    requireThat(end > start, 'Interview end must follow its start')
    return { start, end, format: oneOf(value.format, ['phone', 'video', 'in-person'] as const, 'Interview format') }
  })
  const record = s.put('agency-submission', sub.id, { ...sub, progress: oneOf(b.progress, PROGRESS, 'Agency-facing progress'), feedback: optionalText(b.feedback, 'Feedback addressed to this agency', 4000), interviews })
  s.audit(a, 'agency-progress-shared', 'agency-submission:' + sub.id)
  return record
}
export function agencyFee(s: State, a: Actor, b: Data) {
  const sub = staffSubmission(s, a, b.id)
  requireThat(creditedHire(s, sub), 'Fees require a hire credited to this agency', 409)
  const previous = b.fee ? sub.fees.find((f: Data) => f.id === b.fee) : null
  requireThat(!b.fee || previous, 'Fee milestone not found', 404)
  const fee = { id: previous?.id ?? uid(), label: text(b.label, 'Fee milestone', 200), amountCents: money(b.amountCents, 'USD fee (cents)'), status: oneOf(b.status, ['agreed', 'due', 'paid'] as const, 'Employer-recorded fee state'), by: a.email, at: now() }
  const record = s.put('agency-submission', sub.id, { ...sub, fees: previous ? sub.fees.map((f: Data) => f.id === fee.id ? fee : f) : [...sub.fees, fee] })
  s.audit(a, 'agency-fee-recorded', 'agency-submission:' + sub.id, { amountCents: fee.amountCents, status: fee.status })
  return record
}
