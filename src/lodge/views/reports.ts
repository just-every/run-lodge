import type { State } from '../core/state'
import { has, isAdmin } from '../core/access'
import type { Actor, Data } from '../core/types'
import { latest } from '../records/scorecards'
import type { WorkspaceRecords } from './workspace'

const HOUR = 3600000

/**
 * Interviewer activity for the jobs the reader runs: per interviewer and job,
 * interviews held, scorecards on time, late or missing against the business's
 * due time, average hours to submit, released recommendations and upcoming
 * load. Built from the scoped workspace; it reads submission times only, so an
 * unreleased scorecard's content never appears. It serves chasing and
 * calibration, never candidate scoring.
 */
export function interviewerActivity(s: State, a: Actor, w: WorkspaceRecords) {
  if (!isAdmin(a) && !has(a, 'manager')) return null
  const dueHours = s.find('business', 'main')?.scorecardDueHours ?? 24, nowMs = Date.now()
  const jobs = new Map(w.vacancies.filter(v => v.manages).map(v => [v.id, v.title]))
  const apps = new Map(w.applications.filter(x => jobs.has(x.vacancy)).map(x => [x.id, x]))
  const firstSubmitted = (app: string, interview: string, author: string) => s.all('scorecard').find(c => c.application === app && c.interview === interview && c.author === author && c.status === 'submitted' && !c.corrects)
  const released = latest(w.scorecards.filter(c => c.status === 'submitted' && apps.get(c.application)?.feedbackReleased))
  const rows = new Map<string, Data>()
  for (const iv of w.interviews.filter(i => apps.has(i.application) && i.status === 'scheduled')) {
    const app = apps.get(iv.application)!, start = Date.parse(iv.start), end = start + iv.durationMinutes * 60000, due = end + dueHours * HOUR
    for (const who of iv.participants) {
      const key = who + '\u0000' + app.vacancy
      if (!rows.has(key)) rows.set(key, { interviewer: who, vacancy: app.vacancy, title: jobs.get(app.vacancy), conducted: 0, onTime: 0, late: 0, missing: 0, pending: 0, upcoming: 0, hours: [] as number[], items: [] as Data[] })
      const row = rows.get(key)!
      const item = { interview: iv.id, application: app.id, candidateName: app.candidateName, title: iv.title, start: iv.start, dueAt: new Date(due).toISOString() }
      if (start > nowMs) { row.upcoming++; row.items.push({ ...item, status: 'upcoming' }); continue }
      row.conducted++
      const card = firstSubmitted(app.id, iv.id, who)
      const status = card ? (Date.parse(card.submittedAt) <= due ? 'on-time' : 'late') : nowMs > due ? 'missing' : 'pending'
      row[{ 'on-time': 'onTime', late: 'late', missing: 'missing', pending: 'pending' }[status]!]++
      const hours = card ? Math.round((Date.parse(card.submittedAt) - end) / HOUR * 10) / 10 : null
      if (hours !== null) row.hours.push(hours)
      row.items.push({ ...item, status, submittedAt: card?.submittedAt ?? null, hoursToSubmit: hours })
    }
  }
  return {
    dueHours,
    rows: [...rows.values()].map((r): Data => {
      const { hours, ...row } = r
      const calls = released.filter(c => c.author === row.interviewer && apps.get(c.application)?.vacancy === row.vacancy)
      return {
        ...row, averageHoursToSubmit: hours.length ? Math.round(hours.reduce((x: number, y: number) => x + y, 0) / hours.length * 10) / 10 : null,
        releasedRecommendations: Object.fromEntries(['strong-no', 'no', 'yes', 'strong-yes'].map(r => [r, calls.filter(c => c.recommendation === r).length])),
      }
    }).sort((x, y) => x.interviewer.localeCompare(y.interviewer) || x.title.localeCompare(y.title)),
  }
}
