import type { State } from '../core/state'
import { can, canSeeApplication, managesVacancy, requireAdmin } from '../core/access'
import { blindFor } from '../core/blind'
import { grantsOf } from '../core/store'
import { businessZone, isZone, times } from '../core/time'
import { requireThat, ROLES, type Actor, type Data } from '../core/types'
import { cohortReport } from './cohort-report'
import { surveyReport } from '../surveys/records'
import type { WorkspaceRecords } from './workspace'

export type DelayFilter = { vacancy?: string; from?: string | null; to?: string | null; timeZone?: string }
const dated = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(x) && Number.isFinite(Date.parse(x))
const day = (x: string) => /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x
export const DELAY_UNKNOWNS = [
  'Mailbox response times and threads: unknown; no connected mailbox evidence.',
  'Provider scheduling attempts, external calendars and provider failures: unknown. Native records show recorded availability and scheduling only.',
  'Survey feedback: unknown; no survey answers are exposed to agents or joined here.',
  'Elapsed stage time does not identify candidate waits, recruiter queues or panel bottlenecks. Causes remain hypotheses.',
]

/** Minimal native evidence; never project decision reasons, contact fields or survey answers. */
export function delayAnalysis(s: State, a: Actor, w: WorkspaceRecords, input: DelayFilter) {
  const job = w.vacancies.find(v => v.id === input.vacancy && v.manages)
  requireThat(job, 'Delay analysis job not found', 404)
  const storedJob = s.get('vacancy', job.id)
  requireThat(can(s, a, storedJob, 'offers'), 'Delay analysis requires current offer access', 403)
  const zone = input.timeZone || businessZone(s.find('business', 'main'))
  requireThat(isZone(zone), 'Choose a valid cohort time zone')
  for (const value of [input.from, input.to]) requireThat(!value || day(value), 'Use a valid cohort date')
  requireThat(!input.from || !input.to || input.from <= input.to, 'The end date must follow the start date')
  const dateOf = times(zone).dateOf
  const visible = w.applications.filter(app => app.vacancy === job.id && app.manages && app.status !== 'spam' && !app.blind)
  const missingSubmission = visible.filter(app => !dated(app.submittedAt)).length
  const apps = visible.filter(app => !dated(app.submittedAt) ? !input.from && !input.to : (!input.from || dateOf(app.submittedAt) >= input.from) && (!input.to || dateOf(app.submittedAt) <= input.to))
  const source = (kind: string, id: string) => { s.get(kind, id); return { kind, id, revision: s.revisionOf(kind, id) } }
  const cases = apps.map(app => {
    const events = (app.history as Data[]).map(e => ({ ...source('stage-event', e.id), from: e.from ?? null, to: e.to, fromLabel: job.stages.find((st: Data) => st.id === e.from)?.name ?? e.from ?? 'Intake', toLabel: job.stages.find((st: Data) => st.id === e.to)?.name ?? e.to, at: e.at }))
    const intervals: Data[] = [], missing: string[] = []
    if (app.imported) missing.push('Imported history is not native timing evidence.')
    if (!dated(app.submittedAt)) missing.push('Original submission time is missing.')
    if (!events.length || events[0].from !== null || !dated(events[0].at)) missing.push('Initial stage entry is missing or undated.')
    for (let i = 1; i < events.length; i++) {
      const start = events[i - 1], end = events[i]
      if (!dated(start.at) || !dated(end.at) || Date.parse(end.at) < Date.parse(start.at) || end.from !== start.to) { missing.push('A stage interval has incomplete or inconsistent event history.'); continue }
      if (!app.imported && job.stages.some((st: Data) => st.id === start.to)) intervals.push({ stage: start.to, label: job.stages.find((st: Data) => st.id === start.to).name, start: start.id, end: end.id, from: start.at, to: end.at, hours: (Date.parse(end.at) - Date.parse(start.at)) / 3600000 })
    }
    if (app.status === 'active') missing.push('Current open stage is unfinished and excluded from completed intervals.')
    const offers = w.offers.filter(o => o.application === app.id).map(o => {
      const complete = !app.imported && dated(o.createdAt) && dated(o.outcomeAt) && Date.parse(o.outcomeAt) >= Date.parse(o.createdAt)
      return { ...source('offer', o.id), status: o.status, createdAt: o.createdAt ?? null, outcomeAt: o.outcomeAt ?? null, hoursToOutcome: complete ? (Date.parse(o.outcomeAt) - Date.parse(o.createdAt)) / 3600000 : null }
    })
    const scheduling = w.interviews.filter(iv => iv.application === app.id).map(iv => {
      const elapsed = (end: unknown) => !app.imported && dated(iv.createdAt) && dated(end) && Date.parse(end) >= Date.parse(iv.createdAt) ? (Date.parse(end) - Date.parse(iv.createdAt)) / 3600000 : null
      return { ...source('interview', iv.id), status: iv.status, createdAt: iv.createdAt ?? null, scheduledAt: iv.scheduledAt ?? null, candidateRespondedAt: iv.candidateRespondedAt ?? null,
        hoursToRecordedSchedule: elapsed(iv.scheduledAt), hoursToCandidateAvailability: elapsed(iv.candidateRespondedAt), proposedSlots: iv.slots?.length ?? 0,
        panelSize: iv.participants.length, panelResponses: iv.participants.filter((who: string) => Object.hasOwn(iv.availability ?? {}, who)).length,
        candidateResponded: Object.hasOwn(iv.availability ?? {}, 'candidate'), providerVerified: false, observations: (iv.observations ?? []).map((event: Data) => ({ kind: event.kind, at: event.at, hoursAfterProposal: elapsed(event.at), availableSlots: event.slots?.length ?? null })), historyIncomplete: !iv.observations?.some((e: Data) => e.kind === 'proposed') }
    })
    return { application: app.id, name: app.candidateName, status: app.status, imported: !!app.imported, source: source('application', app.id), events, intervals, offers, scheduling, missing: [...new Set(missing)] }
  }).sort((x, y) => x.application.localeCompare(y.application))
  const intervals = cases.flatMap(c => c.intervals)
  const stages = job.stages.map((st: Data) => {
    const rows = intervals.filter(i => i.stage === st.id), total = rows.reduce((sum, i) => sum + i.hours, 0)
    return { stage: st.id, label: st.name, intervals: rows.length, totalHours: total, meanHours: rows.length ? total / rows.length : null }
  })
  const offers = cases.flatMap(c => c.offers), measured = offers.filter(o => o.hoursToOutcome !== null)
  const sources = [source('vacancy', job.id), ...cases.flatMap(c => [c.source, ...c.events.map(({ kind, id, revision }) => ({ kind, id, revision })), ...c.offers.map(({ kind, id, revision }) => ({ kind, id, revision })), ...c.scheduling.map(({ kind, id, revision }) => ({ kind, id, revision }))])].sort((x, y) => (x.kind + x.id).localeCompare(y.kind + y.id))
  const selectedIds = new Set(cases.map(c => c.application))
  const hiring = cohortReport(s, a, { ...w, applications: w.applications.filter(app => selectedIds.has(app.id)) }, { ...input, from: input.from || undefined, to: input.to || undefined, history: 'native' })
  return {
    hiring: { totals: hiring.totals, disclosures: hiring.disclosures, definition: hiring.definitions.timeToHire },
    cohort: { vacancy: job.id, from: input.from || null, to: input.to || null, timeZone: zone }, job: job.title, cases, stages, sources,
    totals: { cases: cases.length, completedIntervals: intervals.length, offers: offers.length, measuredOutcomes: measured.length, meanOfferHours: measured.length ? measured.reduce((sum, o) => sum + o.hoursToOutcome!, 0) / measured.length : null, outcomes: Object.fromEntries(['draft', 'accepted', 'declined', 'withdrawn'].map(status => [status, offers.filter(o => o.status === status).length])) },
    disclosures: { missingSubmission, excludedUndated: input.from || input.to ? missingSubmission : 0, incompleteCases: cases.filter(c => c.missing.length).length },
    definitions: {
      cohort: 'Current authorized, non-spam, non-blind applications for the selected job, by original submission date inclusive in the selected time zone. Undated records are disclosed and excluded only when a date filter is applied. Reopening does not reset submission.',
      stages: 'Elapsed hours between consecutive, linked native stage events. Each completed visit counts once, including repeated visits after reopening. Unfinished stages, gaps and imported history are not assigned a duration. Means divide by measured completed visits, not applications.',
      offers: 'Recorded offer statuses, not verified delivery or candidate response time. Elapsed hours from native offer creation to its recorded outcome; means divide by offers with both valid timestamps. Drafts and incomplete history remain unmeasured.',
      scheduling: 'Elapsed hours from native interview proposal to recorded scheduling or candidate availability. Panel response counts record declarations, not response timestamps. No native row verifies calendar availability, a delivered invitation, an external attempt or responsibility for a wait.',
      limits: 'A small observational cohort is not a causal comparison or a suitability ranking. Access is applied before aggregation. No mailbox, scheduling or survey evidence is inferred from missing data.',
    }, unknowns: DELAY_UNKNOWNS,
  }
}

/** Reconstruct only current saved human authority, never a historical role snapshot. */
export function delayHuman(s: State, who: string): Actor | undefined {
  const m = s.find('member', who)
  if (!m?.active || m.agent) return
  return { id: 'delay-review', email: m.email, name: m.name, owner: m.owner === true, roles: m.owner ? [...ROLES] : m.roles, agent: false, session: '', version: 0, seePrivate: m.seePrivate === true, grants: grantsOf(s, m) }
}

export function canSeeDelay(s: State, a: Actor, p: Data) {
  const agent = s.find('member', p.proposedBy), principal = delayHuman(s, p.proposedFor), reviewer = delayHuman(s, p.approver)
  if (!agent?.active || !agent.agent || agent.actsFor !== p.proposedFor || !principal || !reviewer) return false
  if (![p.proposedBy, p.proposedFor, p.approver].includes(a.email) && !a.owner) return false
  const job = s.find('vacancy', p.delay.cohort.vacancy)
  if (!job) return false
  for (const actor of [a, principal, reviewer]) {
    if (!managesVacancy(actor, job) || !can(s, actor, job, 'offers')) return false
    for (const row of [...p.delay.cases, ...(p.delayTrial?.baseline?.cases ?? []), ...(p.delayTrial?.taskReport?.cases ?? []), ...(p.delayTrial?.comparison?.report?.cases ?? [])]) {
      const app = s.find('application', row.application), candidate = app && s.find('candidate', app.candidate)
      if (!app || !candidate || candidate.deleted || candidate.mergedInto || !canSeeApplication(s, actor, app) || blindFor(s, actor, app)) return false
    }
  }
  return true
}

/** Human-only survey view. Reuse REPORT-004 suppression and expiry; never copy answers into agent evidence. */
export function delayFeedback(s: State, a: Actor, w: WorkspaceRecords, input: DelayFilter) {
  requireAdmin(a)
  requireThat(!a.agent, 'Survey feedback is for authorized human administrators only', 403)
  const report = delayAnalysis(s, a, w, input), ids = new Set(report.cases.map(c => c.application))
  const feedback = surveyReport(s, a)
  return { definition: feedback.definition, limit: 'Survey aggregates cover the full retained survey version, not the selected submission cohort. Only separately consented identified responses are joined to selected cases. No causation is established; agents cannot read this view.',
    surveys: feedback.surveys.filter(row => s.get('survey', row.id).vacancy === report.cohort.vacancy).map(row => ({ id: row.id, title: row.title, version: row.version, questions: row.questions, responses: row.responses, invitations: row.invitations, responseRate: row.responseRate, suppressed: row.suppressed, averages: row.averages, identified: row.identified.filter(x => ids.has(x.application)) })) }
}
