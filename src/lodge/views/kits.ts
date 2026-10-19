import type { Workspace } from './workspace'
import { Fault, type Data } from '../core/types'

/**
 * One interview's kit as the reader may see it: purpose, the rubric criteria it
 * assesses, its questions and guidance, the candidate's resume, the feedback
 * already released and the reader's own scorecard for it. Built from the
 * workspace projection, so only the panel and the job's managers reach it.
 */
export function kitView(w: Workspace, id: string) {
  const iv = w.interviews.find(i => i.id === id)
  const app = iv && w.applications.find(x => x.id === iv.application)
  const me = w.actor.actsFor ?? w.actor.email
  if (!iv || !app || iv.status === 'cancelled' || !(iv.participants.includes(me) || app.manages)) throw new Fault(404, 'Interview not found')
  const vacancy = w.vacancies.find(v => v.id === app.vacancy)!
  const item = vacancy.plan.find((p: Data) => p.id === iv.planItem) ?? { criteria: [], questions: [] }
  const rubric = vacancy.rubrics.find((r: Data) => r.version === app.rubricVersion)
  return {
    interview: { id: iv.id, title: iv.title, status: iv.status, start: iv.start ?? null, durationMinutes: iv.durationMinutes, location: iv.location, participants: iv.participants },
    application: app.id, candidate: { id: app.candidate, name: app.candidateName }, vacancy: { id: vacancy.id, title: vacancy.title },
    purpose: item.purpose ?? '', questions: item.questions ?? [], rubricVersion: rubric?.version ?? null,
    focus: (rubric?.criteria ?? []).filter((c: Data) => !item.criteria.length || item.criteria.includes(c.id)),
    resume: w.documents.filter(d => !d.restricted && (d.application === app.id || (d.candidate === app.candidate && !d.application))).map(d => ({ id: d.id, name: d.name, kind: d.kind })),
    feedback: app.scorecardSummary.released ? app.scorecardSummary : null,
    scorecard: w.scorecards.find(c => c.interview === iv.id && c.author === me && !c.supersededBy) ?? null,
  }
}
