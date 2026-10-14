import type { State } from '../core/state'
import { canSeeContact, requireAdmin, requireManages, requireRole } from '../core/access'
import { date, now, oneOf, optionalEmail, optionalText, requireThat, text, uid, type Actor, type Data } from '../core/types'
import { storeDocument } from './documents'

// Flows 4 and 5: candidates with source, consent and retention metadata; one
// candidate linked to several applications; possible duplicates surfaced for a
// person to decide, never merged automatically.

export const CONSENT_BASES = ['application', 'talent-pool', 'referral', 'imported', 'manual'] as const

export function retentionUntil(s: State, days?: number) {
  const keep = days ?? s.find('business', 'main')?.retentionDays ?? 365
  return new Date(Date.now() + keep * 86400000).toISOString().slice(0, 10)
}

export function candidateFields(b: Data) {
  return {
    name: text(b.name, 'Candidate name', 160),
    email: optionalEmail(b.email, 'Candidate email'),
    phone: optionalText(b.phone, 'Phone', 40),
    location: optionalText(b.location, 'Location', 160),
    headline: optionalText(b.headline, 'Headline', 300),
    skills: optionalText(b.skills, 'Skills and experience summary', 4000),
  }
}

export function startApplication(s: State, actor: Actor | null, candidate: Data, vacancy: Data, source: string, extra: Data = {}) {
  requireThat(vacancy.status === 'open', 'Applications are accepted only while the vacancy is published', 409)
  const active = s.scan('application').find(x => x.candidate === candidate.id && x.vacancy === vacancy.id && x.status === 'active')
  requireThat(!active, 'This candidate already has an active application for this vacancy', 409)
  const application = s.put('application', uid(), { candidate: candidate.id, vacancy: vacancy.id, stage: vacancy.stages[0].id, status: 'active', source, rubricVersion: vacancy.rubrics.at(-1).version, reviewers: [], feedbackReleased: false, submittedAt: now(), ...extra })
  s.put('stage-event', uid(), { application: application.id, from: null, to: application.stage, reason: 'Application received (' + source + ')', actor: actor?.email ?? 'applicant', at: now() })
  return application
}

/** Staff add a candidate with where they came from and on what basis Lodge keeps them. */
export async function candidate(s: State, a: Actor, b: Data) {
  requireRole(a, 'admin', 'manager')
  const vacancy = b.vacancy ? s.get('vacancy', b.vacancy) : null
  if (vacancy) requireManages(a, vacancy)
  else requireAdmin(a)
  const fields = candidateFields(b)
  const basis = oneOf(b.consentBasis, CONSENT_BASES, 'Consent basis')
  const record = s.put('candidate', uid(), {
    ...fields, source: text(b.source, 'Source', 200),
    consent: { basis, talentPool: b.talentPool === true, recordedBy: a.email, at: now(), note: optionalText(b.consentNote, 'Consent note', 1000) },
    retainUntil: b.retainUntil ? date(b.retainUntil, 'Keep until') : retentionUntil(s), createdAt: now(),
  })
  s.audit(a, 'candidate-added', 'candidate:' + record.id, { source: record.source })
  let application = null
  if (vacancy) application = startApplication(s, a, record, vacancy, record.source)
  if (b.resume) await storeDocument(s, { candidate: record.id, application: application?.id ?? null, name: b.resume.name, mediaType: b.resume.mediaType, base64: b.resume.base64, kind: 'resume', source: 'uploaded by ' + a.email })
  return { candidate: record, application }
}

export function correctCandidate(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const current = s.get('candidate', b.id)
  requireThat(!current.mergedInto && !current.deleted, 'This candidate record is closed', 409)
  const record = s.put('candidate', current.id, { ...current, ...candidateFields(b), consent: { ...current.consent, talentPool: b.talentPool === undefined ? current.consent.talentPool : b.talentPool === true } })
  s.audit(a, 'candidate-corrected', 'candidate:' + record.id, { reason: text(b.reason, 'Reason for the correction', 500) })
  return record
}

/** Link an existing candidate to another vacancy: one person, several applications. */
export function apply(s: State, a: Actor, b: Data) {
  const vacancy = s.get('vacancy', b.vacancy)
  requireManages(a, vacancy)
  const person = s.get('candidate', b.candidate)
  requireThat(canSeeContact(s, a, person), 'Candidate not found', 404)
  requireThat(!person.mergedInto && !person.deleted, 'This candidate record is closed', 409)
  const application = startApplication(s, a, person, vacancy, text(b.source, 'Source', 200))
  s.audit(a, 'application-linked', 'application:' + application.id, { candidate: person.id, vacancy: vacancy.id })
  return application
}

const digits = (v: string) => (v ?? '').replace(/\D/g, '')
const plainName = (v: string) => (v ?? '').toLowerCase().replace(/[^a-z]+/g, ' ').trim()

/** Factual reasons two candidate records may be one person. */
export function duplicateSuggestions(s: State) {
  const people = s.all('candidate').filter(c => !c.mergedInto && !c.deleted)
  const reviewed = new Set(s.all('duplicate-review').map(r => [r.first, r.second].sort().join(':')))
  const result: Data[] = []
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
    const x = people[i], y = people[j], reasons: string[] = []
    if (x.email && x.email === y.email) reasons.push('same email')
    if (digits(x.phone).length >= 7 && digits(x.phone) === digits(y.phone)) reasons.push('same phone')
    if (plainName(x.name) && plainName(x.name) === plainName(y.name)) reasons.push('same name')
    if (reasons.length && !reviewed.has([x.id, y.id].sort().join(':'))) result.push({ first: x.id, second: y.id, reasons })
  }
  return result
}

/** A person decides: keep both as distinct people, or merge the second into the first. */
export function reviewDuplicate(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const keep = s.get('candidate', b.keep), other = s.get('candidate', b.other)
  requireThat(keep.id !== other.id && !keep.mergedInto && !other.mergedInto, 'Choose two open candidate records', 409)
  const decision = oneOf(b.decision, ['distinct', 'merge'] as const, 'Decision')
  const reason = text(b.reason, 'Reason', 1000)
  if (decision === 'merge') {
    requireThat(!other.deleted && !keep.deleted, 'Deleted candidates cannot be merged', 409)
    const applications = s.scan('application').filter(app => [keep.id, other.id].includes(app.candidate) && app.status === 'active')
    const vacancies = new Set<string>()
    for (const app of applications) {
      requireThat(!vacancies.has(app.vacancy), 'Close the overlapping active applications before merging these candidates; each vacancy may have only one active application', 409)
      vacancies.add(app.vacancy)
    }
    for (const kind of ['application', 'document', 'data-request', 'hold'])
      for (const row of s.all(kind).filter(r => r.candidate === other.id)) s.put(kind, row.id, { ...s.get(kind, row.id), candidate: keep.id, mergedFrom: other.id })
    s.put('candidate', keep.id, { ...keep, mergedFrom: [...(keep.mergedFrom ?? []), other.id], consent: { ...keep.consent, talentPool: keep.consent.talentPool && other.consent.talentPool } })
    s.put('candidate', other.id, { ...other, mergedInto: keep.id, mergedAt: now() })
  }
  const review = s.put('duplicate-review', uid(), { first: keep.id, second: other.id, decision, reason, by: a.email, at: now() })
  s.audit(a, 'duplicate-' + decision, 'candidate:' + keep.id, { other: other.id, reason })
  return review
}

