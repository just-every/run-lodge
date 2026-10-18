import type { State } from '../core/state'
import { canReview, requireApplication, requireManages, requireMember } from '../core/access'
import { holdsFor } from './retention'
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
  s.audit(a, 'stage-moved', 'application:' + app.id, { to, reason })
  return record
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
  const other = s.scan('application').find(x => x.id !== app.id && x.candidate === person.id && x.vacancy === vacancy.id && x.status === 'active')
  requireThat(!other, 'This candidate already has an active application for this vacancy', 409)
  requireThat(vacancy.stages.some((st: Data) => st.id === b.to), 'Choose a stage of this vacancy')
  const reason = text(b.reason, 'Reason for reopening', 2000)
  const { closedAt, ...open } = app
  const record = s.put('application', app.id, { ...open, status: 'active', stage: b.to, reopenedAt: now() })
  s.put('stage-event', uid(), { application: app.id, from: app.status, to: b.to, reason, actor: a.email, at: now(), reopened: true })
  for (const m of s.all('message').filter(m => m.application === app.id && m.purpose === 'rejection' && !m.cancelled && !m.downloads?.length))
    s.put('message', m.id, { ...s.get('message', m.id), cancelled: true, cancelledAt: now(), cancelledReason: 'Application reopened' })
  s.audit(a, 'application-reopened', 'application:' + app.id, { from: app.status, to: b.to, reason, closedAt })
  return record
}

export function history(s: State, applicationId: string) {
  return s.all('stage-event').filter(e => e.application === applicationId).sort((x, y) => x.at.localeCompare(y.at))
}
