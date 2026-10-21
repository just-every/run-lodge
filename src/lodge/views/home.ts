import type { Data } from '../core/types'
import { businessZone, fromWall, toWall } from '../core/time'

// HOME-001: each member's home, read only from their own workspace projection
// (LDG-006), so every count is what they may see. The app and
// GET /api/lodge/home run this same function. Exact semantics:
// - interviews: scheduled ones they sit on that start today (business time
//   zone) or later, linked to their kit;
// - scorecards: each active application they are on the panel of (reviewer,
//   or an interview of theirs that has started) without their submitted
//   scorecard; due the business's scorecard hours (default 24) after their
//   latest interview there ends, overdue after that; a review with no
//   interview has no due time;
// - approvals: pending ones naming them whose terms have not changed since;
// - reviews: their REVIEW-001 queues with something left;
// - tasks: open follow-ups and tasks they own, overdue after their due day;
// - offers: draft offers on jobs they run that wait on them: approved and
//   waiting for the outcome, or not (or no longer) sent for approval;
// - attention: for the people who run a job (REQ-003 recruiters,
//   coordinators and hiring managers), its open jobs with an active
//   application 14 or more whole days in its stage or an interview still
//   collecting times.
// Everything is derived, so an item leaves once it is submitted, decided,
// canceled or its access is revoked;
// - mentions: unread @mentions of them (TEAM-002), each linking to the candidate, or linkless text for a mention of
//   something they cannot open; a mention leaves once read or once the access it was sent under is gone.

const DAY = 86_400_000
export const STALLED_DAYS = 14

const link = (params: Record<string, string>) => '/app?' + new URLSearchParams(params).toString()

export function home(w: Data, now = Date.now()) {
  const me = w.actor.actsFor ?? w.actor.email
  const zone = businessZone(w.business), dayWall = toWall(now, zone) - (toWall(now, zone) % DAY)
  const startOfToday = Date.parse(fromWall(dayWall, zone)), today = new Date(dayWall).toISOString().slice(0, 10)
  const app = (id: string) => w.applications.find((a: Data) => a.id === id)
  const job = (id: string) => w.vacancies.find((v: Data) => v.id === id)
  const about = (a: Data | undefined) => a ? { application: a.id, candidateName: a.candidateName, vacancy: a.vacancy, job: job(a.vacancy)?.title ?? '' } : {}
  const dueHours = w.business?.scorecardDueHours ?? 24

  const interviews = w.interviews.filter((i: Data) => i.status === 'scheduled' && i.participants.includes(me) && Date.parse(i.start) >= startOfToday)
    .sort((x: Data, y: Data) => x.start.localeCompare(y.start))
    .map((i: Data) => ({ kind: 'interview', id: i.id, title: i.title, start: i.start, today: Date.parse(i.start) < startOfToday + DAY, ...about(app(i.application)), link: link({ kit: i.id }) }))

  const scorecards = w.applications.filter((a: Data) => a.status === 'active').flatMap((a: Data) => {
    const held = w.interviews.filter((i: Data) => i.application === a.id && i.status === 'scheduled' && i.participants.includes(me) && Date.parse(i.start) <= now).sort((x: Data, y: Data) => x.start.localeCompare(y.start)).at(-1)
    if (!(a.reviewers ?? []).includes(me) && !held) return []
    if (w.scorecards.some((c: Data) => c.application === a.id && c.author === me && c.status === 'submitted')) return []
    const due = held ? new Date(Date.parse(held.start) + held.durationMinutes * 60000 + dueHours * 3600000).toISOString() : null
    return [{ kind: 'scorecard', id: a.id, interview: held?.id ?? null, title: held ? held.title : 'Application review', due, overdue: !!due && Date.parse(due) < now, ...about(a), link: link({ application: a.id }) }]
  }).sort((x: Data, y: Data) => (x.due ?? '9').localeCompare(y.due ?? '9'))

  const approvals = w.approvals.filter((x: Data) => x.status === 'pending' && x.approver === me && x.currentVersion === x.version)
    .map((x: Data) => ({ kind: 'approval', id: x.id, subjectKind: x.subjectKind, title: x.terms.title ?? x.terms.subject, requestedBy: x.requestedBy, at: x.requestedAt, link: link({ approval: x.id }) }))

  const reviews = (w.reviewQueues ?? []).filter((q: Data) => q.remaining > 0)
    .map((q: Data) => ({ kind: 'review', id: q.vacancy, vacancy: q.vacancy, job: q.title, remaining: q.remaining, link: link({ job: q.vacancy }) }))

  const tasks = w.tasks.filter((t: Data) => t.owner === me && t.status === 'open')
    .map((t: Data) => ({ kind: 'task', id: t.id, title: t.note, taskKind: t.kind, due: t.due, overdue: t.due < today, ...about(t.application ? app(t.application) : undefined), link: t.application ? link({ application: t.application }) : link({ task: t.id }) }))

  // A draft waits on the people who run the job unless its current terms are with an approver.
  const offers = w.offers.filter((o: Data) => o.status === 'draft' && (o.approvedNow || !(o.approval?.status === 'pending' && o.approval.version === o.version)))
    .map((o: Data) => ({ kind: 'offer', id: o.id, title: o.title, action: o.approvedNow ? 'record-outcome' : 'request-approval', ...about(app(o.application)), link: link({ application: o.application }) }))

  const mentions = (w.alerts ?? []).filter((x: Data) => x.event === 'mention' && !x.read)
    .map((x: Data) => ({ kind: 'mention', id: x.id, title: x.title, text: x.detail, by: x.by, at: x.at, textOnly: x.textOnly, ...(x.application ? about(app(x.application)) : {}), link: x.link }))

  const attention = w.vacancies.filter((v: Data) => v.manages && v.status === 'open').flatMap((v: Data) => {
    const active = w.applications.filter((a: Data) => a.vacancy === v.id && a.status === 'active')
    const stalled = active.filter((a: Data) => Math.floor((now - Date.parse(a.history.at(-1)?.at ?? a.submittedAt)) / DAY) >= STALLED_DAYS).length
    const unscheduled = w.interviews.filter((i: Data) => i.status === 'proposed' && active.some((a: Data) => a.id === i.application)).length
    return stalled || unscheduled ? [{ kind: 'attention', id: v.id, vacancy: v.id, job: v.title, stalled, unscheduled, link: link({ job: v.id }) }] : []
  })

  const groups = { interviews, scorecards, approvals, reviews, mentions, tasks, offers, attention }
  return { ...groups, counts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])) as Record<keyof typeof groups, number>, overdue: scorecards.filter((x: Data) => x.overdue).length + tasks.filter((x: Data) => x.overdue).length }
}
