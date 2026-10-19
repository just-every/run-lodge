import type { State } from '../core/state'
import { managesVacancy, requireApplication, requireManages } from '../core/access'
import { now, oneOf, optionalText, requireThat, scope, uid, type Actor, type Data } from '../core/types'
import { move } from './pipeline'

// REVIEW-001: each job's application review queue: its active applications in
// the first stage, oldest first, one at a time. The people who run the job
// (REQ-003) advance, reject with a DISP-001 reason or skip; an assigned reviewer
// who does not run the job records a yes/no/maybe recommendation for them. A
// skip sends the application to the back of that person's queue and changes
// nothing else. Every decision and recommendation is kept as a review record.

export const RECOMMENDATIONS = ['yes', 'no', 'maybe'] as const

const firstStage = (v: Data) => v.stages[0]?.id

function requireQueued(s: State, a: Actor, id: unknown) {
  const app = requireApplication(s, a, id)
  const vacancy = s.get('vacancy', app.vacancy)
  requireThat(app.status === 'active' && app.stage === firstStage(vacancy), 'This application is no longer in the review queue', 409)
  return { app, vacancy }
}

/** A person who runs the job decides from the queue: advance to the next stage, reject (DISP-001), or skip. */
export function reviewDecision(s: State, a: Actor, b: Data) {
  const { app, vacancy } = requireQueued(s, a, b.application)
  requireManages(a, vacancy)
  const decision = oneOf(b.decision, ['advance', 'reject', 'skip'] as const, 'Decision')
  if (decision === 'advance') {
    const next = vacancy.stages[1]
    requireThat(next, 'This job has no stage after its first', 409)
    move(s, a, { application: app.id, to: next.id, reason: optionalText(b.reason, 'Reason', 2000) || 'Advanced from the review queue' })
  }
  if (decision === 'reject') move(s, a, { ...b, application: app.id, to: 'rejected' })
  const record = s.put('review', uid(), { application: app.id, vacancy: vacancy.id, by: a.email, decision, at: now() })
  s.audit(a, 'review-' + decision, 'application:' + app.id)
  return record
}

/** An assigned reviewer who does not run the job records a recommendation; a later one replaces their earlier one in the queue view. */
export function reviewRecommendation(s: State, a: Actor, b: Data) {
  const { app, vacancy } = requireQueued(s, a, b.application)
  requireThat(!managesVacancy(a, vacancy), 'You run this job: advance, reject or skip instead', 409)
  requireThat((app.reviewers ?? []).includes(scope(a)), 'Only an assigned reviewer recommends on this application', 403)
  const record = s.put('review', uid(), { application: app.id, vacancy: vacancy.id, by: scope(a), recommendation: oneOf(b.recommendation, RECOMMENDATIONS, 'Recommendation'), note: optionalText(b.note, 'Note', 2000), at: now() })
  s.audit(a, 'review-recommended', 'application:' + app.id, { recommendation: record.recommendation })
  return record
}

/**
 * The reader's queues. For a job they run: every first-stage application, oldest
 * first, those they skipped after the rest, with every review. For a job they only
 * review: their assigned applications they have not yet recommended on, with their
 * own reviews only.
 */
export function reviewQueues(s: State, a: Actor, apps: Data[]) {
  const me = scope(a), visible = new Set(apps.map(x => x.id))
  const reviews = s.all('review').filter(r => visible.has(r.application)).sort((x, y) => x.at.localeCompare(y.at))
  return s.all('vacancy').filter(v => !v.imported && v.status !== 'closed').flatMap(v => {
    const runs = managesVacancy(a, v)
    const waiting = apps.filter(x => x.vacancy === v.id && x.status === 'active' && x.stage === firstStage(v) && (runs || ((x.reviewers ?? []).includes(me) && !reviews.some(r => r.application === x.id && r.by === me && r.recommendation))))
    const skipped = (id: string) => reviews.filter(r => r.application === id && r.by === me && r.decision === 'skip').at(-1)?.at ?? ''
    const order = waiting.sort((x, y) => skipped(x.id).localeCompare(skipped(y.id)) || x.submittedAt.localeCompare(y.submittedAt)).map(x => x.id)
    const seen = runs ? reviews.filter(r => r.vacancy === v.id) : reviews.filter(r => r.vacancy === v.id && r.by === me)
    return waiting.length || seen.length ? [{ vacancy: v.id, title: v.title, manages: runs, remaining: order.length, queue: order, reviews: seen }] : []
  })
}
