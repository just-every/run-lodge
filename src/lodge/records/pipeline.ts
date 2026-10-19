import type { State } from '../core/state'
import { canReview, requireApplication, requireManages, requireMember } from '../core/access'
import { holdsFor } from './retention'
import { cancelTasks } from './tasks'
import { email, list, now, requireThat, text, uid, type Actor, type Data } from '../core/types'

// Flows 6 and 7: who reviews an application, and every stage move with its
// reason, actor and time kept as readable history.

export function assignReviewers(s: State, a: Actor, b: Data) {
  const app = requireApplication(s, a, b.application)
  requireManages(a, s.get('vacancy', app.vacancy))
  const reviewers = list(b.reviewers, 'Reviewers', 12, r => email(r, 'Reviewer'))
  for (const r of reviewers) {
    const m = requireMember(s, r)
    requireThat(canReview({ owner: m.owner, roles: m.roles }), `${r} needs the interviewer role`)
  }
  const record = s.put('application', app.id, { ...app, reviewers: [...new Set(reviewers)] })
  s.audit(a, 'reviewers-assigned', 'application:' + app.id, { reviewers: record.reviewers })
  return record
}

/** Move to another stage, or close as rejected or withdrawn. A hire is recorded only through an accepted offer. */
export function move(s: State, a: Actor, b: Data) {
  const app = requireApplication(s, a, b.application)
  const vacancy = s.get('vacancy', app.vacancy)
  requireManages(a, vacancy)
  requireThat(app.status === 'active', 'This application is closed', 409)
  const reason = text(b.reason, 'Reason for this decision', 2000)
  const to = b.to as string
  let next: Data
  if (to === 'rejected' || to === 'withdrawn') next = { ...app, status: to, closedAt: now() }
  else {
    requireThat(vacancy.stages.some((st: Data) => st.id === to), 'Choose a stage of this vacancy')
    requireThat(to !== app.stage, 'The application is already in that stage', 409)
    next = { ...app, stage: to }
  }
  const record = s.put('application', app.id, next)
  s.put('stage-event', uid(), { application: app.id, from: app.stage, to, reason, actor: a.email, at: now() })
  if (next.status !== 'active') cancelTasks(s, app.id, `Application ${to}`)
  s.audit(a, 'stage-moved', 'application:' + app.id, { to, reason })
  return record
}

/** A rejection letter not yet downloaded is canceled, so it can never be sent. */
function cancelRejections(s: State, applicationId: string, reason: string) {
  for (const m of s.all('message').filter(m => m.application === applicationId && m.purpose === 'rejection' && !m.cancelled && !m.downloads?.length))
    s.put('message', m.id, { ...s.get('message', m.id), cancelled: true, cancelledAt: now(), cancelledReason: reason })
}

function requireNoOtherActive(s: State, app: Data) {
  const other = s.scan('application').find(x => x.id !== app.id && x.candidate === app.candidate && x.vacancy === app.vacancy && x.status === 'active')
  requireThat(!other, 'This candidate already has an active application for this vacancy', 409)
}

/**
 * Junk or bot applications leave the pipeline as spam with a reason: no
 * rejection letter, out of applicant and rejection counts, audited. Unmarking
 * restores the stage it left, with both moves in the history.
 */
export function markSpam(s: State, a: Actor, b: Data) {
  const app = requireApplication(s, a, b.application)
  requireManages(a, s.get('vacancy', app.vacancy))
  requireThat(app.status === 'active', 'Only an open application can be marked as spam', 409)
  const reason = text(b.reason, 'Why this is spam', 1000)
  const { likelySpam, ...rest } = app
  const record = s.put('application', app.id, { ...rest, status: 'spam', spam: { reason, by: a.email, at: now(), stage: app.stage } })
  s.put('stage-event', uid(), { application: app.id, from: app.stage, to: 'spam', reason, actor: a.email, at: now() })
  cancelRejections(s, app.id, 'Marked as spam')
  cancelTasks(s, app.id, 'Application marked as spam')
  s.audit(a, 'application-spam', 'application:' + app.id, { reason })
  return record
}

export function unmarkSpam(s: State, a: Actor, b: Data) {
  const app = requireApplication(s, a, b.application)
  requireManages(a, s.get('vacancy', app.vacancy))
  requireThat(app.status === 'spam', 'This application is not marked as spam', 409)
  requireNoOtherActive(s, app)
  const reason = text(b.reason, 'Why this is not spam', 1000)
  const { spam, ...rest } = app
  const record = s.put('application', app.id, { ...rest, status: 'active', stage: spam.stage, unmarkedSpam: [...(app.unmarkedSpam ?? []), { ...spam, unmarkedBy: a.email, unmarkedAt: now(), unmarkReason: reason }] })
  s.put('stage-event', uid(), { application: app.id, from: 'spam', to: spam.stage, reason, actor: a.email, at: now() })
  s.audit(a, 'application-not-spam', 'application:' + app.id, { reason })
  return record
}

/** A person reviews a likely-spam flag and keeps the application; the flag is never cleared on its own. */
export function clearSpamFlag(s: State, a: Actor, b: Data) {
  const app = requireApplication(s, a, b.application)
  requireManages(a, s.get('vacancy', app.vacancy))
  requireThat(app.likelySpam, 'This application has no likely-spam flag', 409)
  const reason = text(b.reason, 'Reason', 1000)
  const { likelySpam, ...rest } = app
  const record = s.put('application', app.id, { ...rest, spamFlagCleared: { ...likelySpam, by: a.email, at: now(), reason } })
  s.audit(a, 'spam-flag-cleared', 'application:' + app.id, { reason })
  return record
}

/** Applicant and stage counts for one job's visible applications; spam is counted apart, never as an applicant or rejection. */
export function funnel(vacancy: Data, apps: Data[]) {
  const mine = apps.filter(x => x.vacancy === vacancy.id), real = mine.filter(x => x.status !== 'spam')
  const closed = (status: string) => real.filter(x => x.status === status).length
  return {
    applicants: real.length, spam: mine.length - real.length,
    stages: Object.fromEntries(vacancy.stages.map((st: Data) => [st.id, real.filter(x => x.status === 'active' && x.stage === st.id).length])),
    rejected: closed('rejected'), withdrawn: closed('withdrawn'), transferred: closed('transferred'), hired: closed('hired'),
  }
}

/**
 * Reopen a rejected or withdrawn application into a chosen stage. The close and
 * the reopen both stay in its history; a rejection message not yet downloaded
 * is canceled. Erased people, held records and a second active application on
 * the same job refuse it.
 */
export function reopen(s: State, a: Actor, b: Data) {
  const app = requireApplication(s, a, b.application)
  const vacancy = s.get('vacancy', app.vacancy)
  requireManages(a, vacancy)
  requireThat(app.status === 'rejected' || app.status === 'withdrawn', 'Only a rejected or withdrawn application can be reopened', 409)
  const person = s.get('candidate', app.candidate)
  requireThat(!person.deleted && !person.mergedInto, 'This candidate record is closed', 409)
  requireThat(!holdsFor(s, person.id).length, 'A legal hold keeps this record as it stands; release it before reopening', 409)
  requireNoOtherActive(s, app)
  requireThat(vacancy.stages.some((st: Data) => st.id === b.to), 'Choose a stage of this vacancy')
  const reason = text(b.reason, 'Reason for reopening', 2000)
  const { closedAt, ...open } = app
  const record = s.put('application', app.id, { ...open, status: 'active', stage: b.to, reopenedAt: now() })
  s.put('stage-event', uid(), { application: app.id, from: app.status, to: b.to, reason, actor: a.email, at: now(), reopened: true })
  cancelRejections(s, app.id, 'Application reopened')
  s.audit(a, 'application-reopened', 'application:' + app.id, { from: app.status, to: b.to, reason, closedAt })
  return record
}

export function history(s: State, applicationId: string) {
  return s.all('stage-event').filter(e => e.application === applicationId).sort((x, y) => x.at.localeCompare(y.at))
}
