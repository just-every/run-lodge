import { now } from '../core/types'
import { bounds, METRICS, type Query } from './query'
import type { AnalysisScope, Application } from './scope'

export const EVIDENCE_LIMIT = 200
export interface Evidence { record: string; application: string; job: string; source: string; at: string; event: string | null; relatedAt: string | null; value: number; outcome: string | null }
export interface Aggregate { label: string; value: number | null; numerator: number; denominator: number }
export interface Result { query: Query; definition: string; unit: string; computedAt: string; zone: string; start: string; endExclusive: string; groups: Aggregate[]; total: Aggregate; evidence: Evidence[]; evidenceTotal: number; evidenceLimit: number; evidenceTruncated: boolean; missing: number; limitations: string[] }
const round = (n: number) => Math.round(n * 100) / 100

export function execute(scope: AnalysisScope, query: Query): Result {
  const computedAt = now(), { start, endExclusive } = bounds(query, scope.dates.zone)
  const within = (at: string | null) => !!at && at >= start && at < endExclusive && at <= computedAt
  const jobs = new Map(scope.jobs.map(j => [j.id, j])), apps = new Map(scope.applications.filter(a => (!query.jobs.length || query.jobs.includes(a.job)) && (!query.sources.length || query.sources.includes(a.source))).map(a => [a.id, a]))
  const rows: Evidence[] = [], limitations: string[] = [], stageNames = new Map(scope.jobs.flatMap(j => j.stages.map(st => [st.id, st.name] as const)))
  let missing = 0
  const add = (app: Application, row: Omit<Evidence, 'application' | 'job' | 'source'>) => rows.push({ application: app.id, job: app.job, source: app.source, ...row })
  if (query.metric === 'source_conversion') {
    for (const app of apps.values()) {
      if (!app.submittedAt) { missing++; continue }
      if (!within(app.submittedAt)) continue
      const job = jobs.get(app.job)!
      const converted = app.events.filter(e => e.at && e.at >= app.submittedAt && e.at <= computedAt && (e.to === 'hired' || job.stages.slice(1).some(st => st.id === e.to))).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))[0]
      add(app, { record: app.id, at: app.submittedAt, event: converted?.id ?? null, relatedAt: converted?.at ?? null, value: converted ? 1 : 0, outcome: converted ? stageNames.get(converted.to) ?? converted.to : 'No retained conversion event' })
    }
    limitations.push('A submission-date cohort, followed through computation time, is not a count of conversions occurring only inside the selected dates. Historical conversion is evidenced only by retained later-stage or hire events; missing or erased events cannot be reconstructed. Current stage alone is not treated as a historical event. Source uses each application’s recorded source and may differ from first-touch source reports.')
  } else if (query.metric === 'scheduling_delay') {
    for (const iv of scope.interviews) {
      const app = apps.get(iv.application)
      if (!app) continue
      if (!iv.scheduledAt) { if (iv.status === 'scheduled') missing++; continue }
      if (!within(iv.scheduledAt)) continue
      if (!iv.createdAt || iv.createdAt > iv.scheduledAt) { missing++; continue }
      add(app, { record: iv.id, at: iv.scheduledAt, event: null, relatedAt: iv.createdAt, value: (Date.parse(iv.scheduledAt) - Date.parse(iv.createdAt)) / 3600000, outcome: iv.status })
    }
    limitations.push('The interval measures proposal-to-booking, not submission-to-interview or time until the interview starts. No original-booking history is invented. Scheduled records without a booking timestamp cannot be assigned to a date cohort and are listed in the missing-data count across the selected job and source scope. Proposals that have not been booked are excluded. Separate replacement interview records count separately.')
  } else if (query.metric === 'stage_moves') {
    for (const app of apps.values()) for (const e of app.events) {
      if (e.from === null || e.from === undefined) continue
      if (!e.at) { missing++; continue }
      if (within(e.at)) add(app, { record: e.id, at: e.at, event: e.id, relatedAt: null, value: 1, outcome: stageNames.get(e.to) ?? e.to })
    }
    limitations.push('Transitions count events, not unique people. Retained initial-entry events are excluded. Erased history is unavailable.')
  } else {
    for (const offer of scope.offers) {
      const app = apps.get(offer.application)
      if (!app || !['accepted', 'declined', 'withdrawn'].includes(offer.status)) continue
      if (!offer.outcomeAt) { missing++; continue }
      if (within(offer.outcomeAt)) add(app, { record: offer.id, at: offer.outcomeAt, event: null, relatedAt: null, value: 1, outcome: offer.status })
    }
    limitations.push('Only current permission-filtered offer outcomes are counted. Salary, terms, signatures and private material are excluded. Draft offers and outcomes without retained timestamps cannot be counted in a dated outcome cohort.')
  }
  rows.sort((a, b) => a.at.localeCompare(b.at) || a.record.localeCompare(b.record))
  const aggregate = (label: string, data: Evidence[]): Aggregate => {
    const numerator = data.reduce((sum, row) => sum + row.value, 0), denominator = data.length
    return { label, numerator: round(numerator), denominator, value: query.metric === 'source_conversion' ? denominator ? round(numerator / denominator * 100) : null : query.metric === 'scheduling_delay' ? denominator ? round(numerator / denominator) : null : denominator }
  }
  const grouped = new Map<string, Evidence[]>()
  for (const row of rows) {
    const label = query.groupBy === 'source' ? row.source : query.groupBy === 'job' ? jobs.get(row.job)!.title + ' · ' + row.job : query.groupBy === 'stage' || query.groupBy === 'status' ? row.outcome! : 'All records'
    grouped.set(label, [...(grouped.get(label) ?? []), row])
  }
  limitations.push('Spam and erased candidates are excluded. Evidence is recomputed from currently retained authorized records. Totals use every matching row; only the displayed evidence is limited. This analysis cannot change candidate decisions.')
  return { query, definition: METRICS[query.metric].definition, unit: METRICS[query.metric].unit, computedAt, zone: scope.dates.zone, start, endExclusive, groups: [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([label, data]) => aggregate(label, data)), total: aggregate('Total', rows), evidence: rows.slice(0, EVIDENCE_LIMIT).map(row => ({ ...row, value: round(row.value) })), evidenceTotal: rows.length, evidenceLimit: EVIDENCE_LIMIT, evidenceTruncated: rows.length > EVIDENCE_LIMIT, missing, limitations }
}
