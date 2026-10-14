import type { State } from '../core/state'
import { managesVacancy } from '../core/access'
import type { Actor, Data } from '../core/types'
import { commonSlots } from '../records/interviews'

/**
 * Factual coordination facts for the vacancies an actor runs: interviews still
 * collecting availability (with the times most people can make) and panellists
 * whose scorecards are missing after an interview took place. Agents and people
 * read the same list; turning it into reminders or schedules is a proposal.
 */
export function coordination(s: State, a: Actor) {
  const nowIso = new Date().toISOString()
  const missingScorecards: Data[] = [], awaitingTimes: Data[] = []
  for (const iv of s.all('interview')) {
    const app = s.all('application').find(x => x.id === iv.application)
    const vacancy = app && s.all('vacancy').find(v => v.id === app.vacancy)
    if (!app || !vacancy || !managesVacancy(a, vacancy) || app.status !== 'active') continue
    if (iv.status === 'proposed') awaitingTimes.push({ interview: iv.id, application: app.id, title: iv.title, responded: Object.keys(iv.availability ?? {}), best: commonSlots(iv).slice(0, 3) })
    if (iv.status === 'scheduled' && iv.start < nowIso) {
      const submitted = new Set(s.all('scorecard').filter(c => c.application === app.id && c.interview === iv.id && c.status === 'submitted').map(c => c.author))
      for (const p of iv.participants) if (!submitted.has(p)) missingScorecards.push({ interview: iv.id, application: app.id, title: iv.title, interviewer: p, since: iv.start })
    }
  }
  return { missingScorecards, awaitingTimes }
}
