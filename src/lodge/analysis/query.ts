import { businessZone, instantOf, times } from '../core/time'
import { Fault, now, requireThat } from '../core/types'
import type { AnalysisScope } from './scope'

export const METRICS = {
  source_conversion: { label: 'Source conversion', unit: 'percent', definition: 'Applications submitted in the selected date cohort that have a retained event entering a later job stage or hired, divided by all non-spam applications in that cohort. Follow-up runs through the computation time, including events after the cohort end. Each application counts once. Source is its own recorded source; cross-application first-touch attribution is not applied.' },
  scheduling_delay: { label: 'Scheduling delay', unit: 'hours', definition: 'Mean elapsed hours from interview proposal creation to its retained booking timestamp, for bookings made in the selected dates. The interview start is not the booking time. Each interview record counts once, including a subsequently canceled booking.' },
  stage_moves: { label: 'Stage moves', unit: 'events', definition: 'Retained stage transition events in the selected dates, excluding initial application entry. Each transition counts once; repeated transitions by one application are separate events.' },
  offer_outcomes: { label: 'Offer outcomes', unit: 'outcomes', definition: 'Current accepted, declined or withdrawn offer outcomes with a retained outcome timestamp in the selected dates. Drafts do not count. Only offers the reader currently has permission to see are included.' },
} as const
export type Metric = keyof typeof METRICS
export type Group = 'source' | 'job' | 'stage' | 'status' | 'none'
export type Chart = 'bar' | 'table'
export interface Query { metric: Metric; from: string; to: string; jobs: string[]; sources: string[]; groupBy: Group; chart: Chart }
export const GROUPS: Record<Group, string> = { source: 'Source', job: 'Job', stage: 'Destination stage', status: 'Offer outcome', none: 'All records' }
export const allowedGroups: Record<Metric, Group[]> = { source_conversion: ['source', 'job', 'none'], scheduling_delay: ['source', 'job', 'none'], stage_moves: ['stage', 'source', 'job', 'none'], offer_outcomes: ['status', 'source', 'job', 'none'] }
export const REFUSAL = 'This question is outside the permitted recruiting metrics. Restricted monitoring answers, private interview material, personal attributes, arbitrary expressions and candidate decisions are unavailable here.'

function object(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  requireThat(!!value && typeof value === 'object' && !Array.isArray(value), 'Use a supported analysis definition')
  requireThat(Object.keys(value).length === keys.length && Object.keys(value).every(k => keys.includes(k)), 'Unknown or missing analysis fields are not permitted')
}
function calendar(value: unknown): string {
  requireThat(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'Choose exact calendar dates')
  const parsed = new Date(value + 'T00:00:00Z')
  requireThat(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value, 'Choose valid calendar dates')
  return value
}
function strings(value: unknown, label: string, length: number): string[] {
  requireThat(Array.isArray(value) && value.length <= 50 && value.every(x => typeof x === 'string' && x.length > 0 && x.length <= length && !/[\x00-\x1f]/.test(x)), `Choose bounded ${label} filters`)
  requireThat(new Set(value).size === value.length, `Remove duplicate ${label} filters`)
  return value as string[]
}
export function validateQuery(value: unknown, scope: AnalysisScope, retainedSourceFilter = false): Query {
  object(value, ['metric', 'from', 'to', 'jobs', 'sources', 'groupBy', 'chart'])
  requireThat(typeof value.metric === 'string' && Object.hasOwn(METRICS, value.metric), REFUSAL)
  const metric = value.metric as Metric, from = calendar(value.from), to = calendar(value.to)
  requireThat(from <= to && Date.parse(to) - Date.parse(from) <= 3660 * 86400000, 'Choose an ordered date range of at most ten years')
  const jobs = strings(value.jobs, 'job', 80), sources = strings(value.sources, 'source', 200)
  requireThat(jobs.every(id => scope.jobs.some(j => j.id === id)), 'A selected job is no longer available to you', 404)
  requireThat(retainedSourceFilter || sources.every(source => scope.sources.includes(source)), 'Choose a source from the current scoped filter choices')
  if (metric === 'offer_outcomes') requireThat(jobs.every(id => scope.jobs.some(j => j.id === id && j.offers)), 'Offer analysis is unavailable for a selected job', 403)
  requireThat(typeof value.groupBy === 'string' && allowedGroups[metric].includes(value.groupBy as Group), 'Choose a grouping supported by this metric')
  requireThat(value.chart === 'bar' || value.chart === 'table', 'Choose a bar chart or data table')
  return { metric, from, to, jobs, sources, groupBy: value.groupBy as Group, chart: value.chart }
}
export function validatePlan(value: unknown, scope: AnalysisScope): Query[] {
  object(value, ['refused', 'queries'])
  requireThat(typeof value.refused === 'boolean' && Array.isArray(value.queries) && value.queries.length <= 3, 'The provider returned an unsupported analysis definition')
  if (value.refused) throw new Fault(400, REFUSAL)
  requireThat(value.queries.length > 0, 'The provider did not propose an analysis')
  return value.queries.map(q => validateQuery(q, scope))
}
export function bounds(q: Query, zone: string) {
  const next = new Date(Date.parse(q.to + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)
  return { start: instantOf(q.from + 'T00:00', zone), endExclusive: instantOf(next + 'T00:00', zone) }
}
export function dateContext(business: { timeZone?: string } | undefined) {
  const zone = businessZone(business), today = times(zone).dateOf(now()), [year, month] = today.split('-').map(Number)
  const end = new Date(Date.UTC(year, Math.floor((month - 1) / 3) * 3, 1))
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 3, 1))
  return { zone, today, lastQuarter: { from: start.toISOString().slice(0, 10), to: new Date(end.getTime() - 86400000).toISOString().slice(0, 10) } }
}
export function defaultQuery(scope: AnalysisScope): Query {
  return { metric: 'source_conversion', ...scope.dates.lastQuarter, jobs: [], sources: [], groupBy: 'source', chart: 'bar' }
}

const stringArray = { type: 'array', items: { type: 'string' }, maxItems: 50 }
export const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['refused', 'queries'], properties: {
    refused: { type: 'boolean' }, queries: { type: 'array', maxItems: 3, items: {
      type: 'object', additionalProperties: false, required: ['metric', 'from', 'to', 'jobs', 'sources', 'groupBy', 'chart'], properties: {
        metric: { type: 'string', enum: Object.keys(METRICS) }, from: { type: 'string' }, to: { type: 'string' }, jobs: stringArray, sources: stringArray,
        groupBy: { type: 'string', enum: Object.keys(GROUPS) }, chart: { type: 'string', enum: ['bar', 'table'] },
      },
    } },
  },
}
