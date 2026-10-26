import { now } from '../core/types'
import { bounds, METRICS, type Query } from '../analysis/query'
import { execute } from '../analysis/execute'
import type { AnalysisScope } from '../analysis/scope'

export const FUNNEL = 'Submission-date cohort; each application counts once per configured stage reached through a retained event by the exclusive period end. Earlier configured stages are not inferred from later ones. Denominator is all authorized non-spam applications submitted in the period. Repeated moves do not increase a stage count.'
export function calculate(scope: AnalysisScope, jobs: string[], period: { from: string; to: string }) {
  const query: Query = { metric: 'source_conversion', ...period, jobs, sources: [], groupBy: 'source', chart: 'table' }
  const { start, endExclusive } = bounds(query, scope.dates.zone)
  // Freeze follow-up at the period end, even if the scheduler runs late.
  const retained = { ...scope, applications: scope.applications.map(app => ({ ...app, events: app.events.filter(e => e.at && e.at < endExclusive) })) }
  const source = execute(retained, query)
  const cohort = retained.applications.filter(app => jobs.includes(app.job) && app.submittedAt >= start && app.submittedAt < endExclusive)
  const funnel = scope.jobs.filter(job => jobs.includes(job.id)).map(job => {
    const apps = cohort.filter(app => app.job === job.id)
    return { job: job.id, denominator: apps.length, stages: job.stages.map(stage => {
      const numerator = apps.filter(app => app.events.some(e => e.to === stage.id && e.at >= app.submittedAt && e.at < endExclusive)).length
      return { stage: stage.name, numerator, denominator: apps.length, percent: apps.length ? numerator / apps.length * 100 : null }
    }) }
  })
  return { period, start, endExclusive, zone: scope.dates.zone, computedAt: now(), source: { definition: METRICS.source_conversion.definition + ' For this weekly report follow-up stops at the exclusive period end.', total: source.total, groups: source.groups, missing: source.missing }, funnel: { definition: FUNNEL, jobs: funnel }, limitations: ['Currently retained authorized records only. Imported history can lack original event timestamps; missing and erased history cannot be reconstructed. Current stage alone is not evidence of historical progression. No private notes, answers, candidate names or contact details are included.'] }
}
