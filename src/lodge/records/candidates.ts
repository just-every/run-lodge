import { captureApplicationFields } from '../fields/capture'
import { requireStageFields } from '../fields/values'
import type { State } from '../core/state'
import { canSeeCandidate, canSeeContact, requireAdmin, requireApplication, requireCandidate, requireManages, requireMember, requireRole, teamOf } from '../core/access'
import { date, email, list, now, oneOf, optionalEmail, optionalText, requireThat, scope, text, uid, type Actor, type Data } from '../core/types'
import { storeDocument } from './documents'
import { cancelTasks } from './tasks'
import { initialCredit } from './sources'
import { notifyApplication } from '../notify/emit'

// Flows 4 and 5: candidates with source, consent and retention metadata; one
// candidate linked to several applications; possible duplicates surfaced for a
// person to decide, never merged automatically.

export const CONSENT_BASES = ['application', 'talent-pool', 'referral', 'imported', 'manual', 'event-capture'] as const

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

export function startApplication(s: State, actor: Actor | null, candidate: Data, vacancy: Data, source: string, extra: Data = {}, received = 'Application received (' + source + ')') {
  requireThat(vacancy.status === 'open', 'Applications are accepted only while the vacancy is published', 409)
  const active = s.scan('application').find(x => x.candidate === candidate.id && x.vacancy === vacancy.id && x.status === 'active')
  requireThat(!active, 'This candidate already has an active application for this vacancy', 409)
  const customValues = captureApplicationFields(s, actor, candidate, vacancy, extra.customValues)
  const application = s.put('application', uid(), { candidate: candidate.id, vacancy: vacancy.id, stage: vacancy.stages[0].id, status: 'active', source, rubricVersion: vacancy.rubrics.at(-1).version, reviewers: [], feedbackReleased: false, submittedAt: now(), ...extra, customValues })
  requireStageFields(s, vacancy, application, application.stage)
  s.put('stage-event', uid(), { application: application.id, from: null, to: application.stage, reason: received, actor: actor?.email ?? 'applicant', at: now() })
  notifyApplication(s, vacancy, application, actor?.email ?? null)
  return application
}

/** Staff add a candidate with where they came from and on what basis Lodge keeps them. */
export async function candidate(s: State, a: Actor, b: Data) {
  const vacancy = b.vacancy ? s.get('vacancy', b.vacancy) : null
  // REQ-003: a sourcer on the job adds candidates to it without running it.
  if (!vacancy || !teamOf(vacancy, 'sourcers').includes(scope(a))) {
    requireRole(a, 'admin', 'manager')
    if (vacancy) requireManages(a, vacancy)
    else requireAdmin(a)
  }
  const fields = candidateFields(b)
  const basis = oneOf(b.consentBasis, CONSENT_BASES, 'Consent basis')
  const record = s.put('candidate', uid(), {
    ...fields, source: text(b.source, 'Source', 200),
    consent: { basis, talentPool: b.talentPool === true, recordedBy: a.email, at: now(), note: optionalText(b.consentNote, 'Consent note', 1000) },
    retainUntil: b.retainUntil ? date(b.retainUntil, 'Keep until') : retentionUntil(s), createdAt: now(),
  })
  s.audit(a, 'candidate-added', 'candidate:' + record.id, { source: record.source })
  let application = null
  if (vacancy) application = startApplication(s, a, record, vacancy, record.source, { credit: initialCredit(s, a, vacancy, b), customValues: b.customValues ?? {} })
  if (b.resume) await storeDocument(s, { candidate: record.id, application: application?.id ?? null, name: b.resume.name, mediaType: b.resume.mediaType, base64: b.resume.base64, kind: 'resume', source: 'uploaded by ' + a.email })
  return { candidate: s.get('candidate', record.id), application }
}

/** An admin marks a candidate private: only the people named, the owner and "see private" holders see them anywhere. */
export function candidatePrivacy(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const c = s.find('candidate', b.id)
  requireThat(c && !c.deleted && !c.mergedInto && canSeeCandidate(s, a, c), 'Candidate not found', 404)
  const isPrivate = b.private === true
  const namedPeople = list(b.namedPeople ?? [], 'Named people', 20, x => requireMember(s, email(x, 'Named person')).email)
  const record = s.put('candidate', c.id, { ...c, private: isPrivate, namedPeople: isPrivate ? [...new Set(namedPeople)] : [] })
  s.audit(a, isPrivate ? 'candidate-private' : 'candidate-not-private', 'candidate:' + c.id, { namedPeople: record.namedPeople })
  return record
}

export function correctCandidate(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const current = requireCandidate(s, a, b.id)
  requireThat(!current.mergedInto && !current.deleted, 'This candidate record is closed', 409)
  const record = s.put('candidate', current.id, { ...current, ...candidateFields(b), consent: { ...current.consent, talentPool: b.talentPool === undefined ? current.consent.talentPool : b.talentPool === true } })
  s.audit(a, 'candidate-corrected', 'candidate:' + record.id, { reason: text(b.reason, 'Reason for the correction', 500), ...(b.talentPool !== undefined ? { talentPool: b.talentPool === true } : {}) })
  return record
}

/** Link an existing candidate to another vacancy: one person, several applications. */
export function apply(s: State, a: Actor, b: Data) {
  const vacancy = s.get('vacancy', b.vacancy)
  requireManages(a, vacancy)
  const person = s.get('candidate', b.candidate)
  requireThat(canSeeContact(s, a, person), 'Candidate not found', 404)
  requireThat(!person.mergedInto && !person.deleted, 'This candidate record is closed', 409)
  const application = startApplication(s, a, person, vacancy, text(b.source, 'Source', 200), { credit: initialCredit(s, a, vacancy, b), customValues: b.customValues ?? {} })
  s.audit(a, 'application-linked', 'application:' + application.id, { candidate: person.id, vacancy: vacancy.id })
  return application
}

/**
 * Move an active application to another job: the source closes as transferred
 * with a link, the target opens in its first stage with its own rubric version
 * and reviewers, linked back to the source's history and attachments.
 */
export function transfer(s: State, a: Actor, b: Data) {
  const source = requireApplication(s, a, b.application)
  const from = s.get('vacancy', source.vacancy)
  requireManages(a, from)
  requireThat(source.status === 'active', 'Only an active application can be transferred', 409)
  const target = s.get('vacancy', b.vacancy)
  requireManages(a, target)
  requireThat(target.id !== from.id, 'Choose another job to transfer to')
  const person = s.get('candidate', source.candidate)
  requireThat(!person.mergedInto && !person.deleted, 'This candidate record is closed', 409)
  const note = optionalText(b.reason, 'Reason', 2000)
  const application = startApplication(s, a, person, target, source.source, { transferredFrom: source.id, credit: source.credit ?? null, customValues: b.customValues ?? {} }, `Transferred from ${from.title}${note ? ': ' + note : ''}`)
  const reason = `Transferred to ${target.title}`
  s.put('application', source.id, { ...source, status: 'transferred', closedAt: now(), transferredTo: application.id })
  cancelTasks(s, source.id, 'Application transferred')
  s.put('stage-event', uid(), { application: source.id, from: source.stage, to: 'transferred', reason: note ? `${reason}: ${note}` : reason, actor: a.email, at: now() })
  s.audit(a, 'application-transferred', 'application:' + source.id, { to: application.id, vacancy: target.id })
  return application
}

/** The applications this one was transferred from, nearest first. */
export function transferredFrom(s: State, app: Data) {
  const chain: Data[] = []
  for (let at = app.transferredFrom && s.find('application', app.transferredFrom); at && chain.length < 20; at = at.transferredFrom && s.find('application', at.transferredFrom)) chain.push(at)
  return chain
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
  const keep = requireCandidate(s, a, b.keep), other = requireCandidate(s, a, b.other)
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
    for (const kind of ['take-home', 'take-home-submission', 'take-home-grade', 'capture-mail', 'application', 'document', 'data-request', 'hold', 'team-note', 'event-capture', 'resume-extraction', 'resume-intake', 'blind-identity'])
      for (const row of s.all(kind).filter(r => r.candidate === other.id)) s.put(kind, row.id, { ...s.get(kind, row.id), candidate: keep.id, mergedFrom: other.id })
    s.put('candidate', keep.id, { ...keep, mergedFrom: [...(keep.mergedFrom ?? []), other.id], consent: { ...keep.consent, talentPool: keep.consent.talentPool && other.consent.talentPool } })
    s.put('candidate', other.id, { ...other, mergedInto: keep.id, mergedAt: now() })
  }
  const review = s.put('duplicate-review', uid(), { first: keep.id, second: other.id, decision, reason, by: a.email, at: now() })
  s.audit(a, 'duplicate-' + decision, 'candidate:' + keep.id, { other: other.id, reason })
  return review
}

