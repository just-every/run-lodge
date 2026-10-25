import { declineSurveyContact } from '../surveys/records'
import type { State } from '../core/state'
import { requireAdmin, requireApplication } from '../core/access'
import { now, oneOf, optionalText, requireThat, text, uid, type Actor, type Data } from '../core/types'
import { cancelTasks } from '../records/tasks'
import { cancelRejectionEmails } from '../records/rejections'

export const PROGRESS = ['Received', 'In review', 'Interviewing', 'Offer', 'Closed'] as const

/** An explicit publication, independent of internal stages, notes and decisions. */
export function publishCandidateAccount(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const app = requireApplication(s, a, b.application)
  requireThat(app.status === 'active', 'This application is closed', 409)
  const account = app.candidateAccount ?? { requests: [] }
  const request = optionalText(b.request, 'Requested information', 1000)
  const record = s.put('application', app.id, { ...app, candidateAccount: {
    ...account, progress: oneOf(b.progress, PROGRESS, 'Published progress'), message: optionalText(b.message, 'Candidate message', 2000),
    publishedBy: a.id, publishedAt: now(),
    requests: [...account.requests, ...(request ? [{ id: uid(), question: request, at: now(), by: a.id }] : [])],
  } })
  s.audit(a, 'candidate-progress-published', 'application:' + app.id, { requested: !!request })
  return record
}

export function reviewVerificationCopy(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const app = requireApplication(s, a, b.application)
  requireThat(b.reviewed === true, 'Confirm employer review of this language version')
  const body = text(b.text, 'Verification email text', 5000)
  requireThat(body.includes('{link}'), 'Keep {link} in the verification email')
  const account = app.candidateAccount ?? { requests: [] }
  const copy = { language: app.language ?? 'en', subject: text(b.subject, 'Subject', 200), text: body, changedSubject: text(b.changedSubject, 'Email-change notice subject', 200), changedText: text(b.changedText, 'Email-change notice text', 5000), reviewedBy: a.id, reviewedAt: now(), version: (account.verificationCopy?.version ?? 0) + 1 }
  s.audit(a, 'candidate-email-copy-reviewed', 'application:' + app.id, { language: copy.language, version: copy.version })
  return s.put('application', app.id, { ...app, candidateAccount: { ...account, verificationCopy: copy } })
}

export function answerRequest(s: State, a: Actor, app: Data, b: Data) {
  requireThat(app.status === 'active', 'This application is closed', 409)
  const account = app.candidateAccount
  const request = account?.requests.find((r: Data) => r.id === b.request)
  requireThat(request, 'This page is not available', 404)
  requireThat(!request.answeredAt, 'This request was already answered', 409)
  const answer = text(b.answer, 'Your answer', 5000)
  s.put('application', app.id, { ...app, candidateAccount: { ...account, requests: account.requests.map((r: Data) => r.id === request.id ? { ...r, answer, answeredAt: now(), answeredBy: a.id } : r) } })
  s.audit(a, 'candidate-request-answered', 'application:' + app.id, { request: request.id })
}

export function preferences(s: State, a: Actor, candidate: Data, b: Data) {
  const preference = oneOf(b.preference, ['email', 'phone', 'none'] as const, 'Contact preference')
  s.put('candidate', candidate.id, { ...candidate, contactPreference: { preference, at: now(), by: a.id }, consent: { ...candidate.consent, talentPool: b.talentPool === 'yes' } })
  if (preference === 'none') declineSurveyContact(s, candidate.id)
  s.audit(a, 'candidate-preferences-changed', 'candidate:' + candidate.id, { preference, talentPool: b.talentPool === 'yes' })
}

/** Withdrawal closes just this application; retained originals and holds are untouched. */
export function withdraw(s: State, a: Actor, app: Data, confirmed: unknown) {
  requireThat(confirmed === 'yes', 'Confirm that you want to withdraw')
  requireThat(app.status === 'active', 'This application is closed', 409)
  s.put('application', app.id, { ...app, status: 'withdrawn', closedAt: now(), candidateWithdrawnAt: now() })
  s.put('stage-event', uid(), { application: app.id, from: app.stage, to: 'withdrawn', reason: 'Withdrawn by candidate', actor: a.email, at: now() })
  cancelTasks(s, app.id, 'Candidate withdrew')
  cancelRejectionEmails(s, app.id, 'Candidate withdrew')
  for (const m of s.scan('message').filter(m => m.application === app.id && !m.cancelled)) s.put('message', m.id, { ...m, cancelled: true, cancelledAt: now(), cancelledReason: 'Candidate withdrew' })
  for (const iv of s.scan('interview').filter(iv => iv.application === app.id && iv.status !== 'cancelled')) s.put('interview', iv.id, { ...iv, status: 'cancelled', cancelReason: 'Candidate withdrew' })
  s.audit(a, 'candidate-withdrew', 'application:' + app.id)
}
