import type { State } from '../core/state'
import { requireCan } from '../core/access'
import { times } from '../core/time'
import { canonical, integer, now, requireThat, sha256, type Actor, type Data } from '../core/types'
import { businessToday, task } from '../records/tasks'
import { canSeeDelay, delayAnalysis, delayHuman } from '../views/delay-analysis'
import { workspaceRecords } from '../views/workspace'

const DAY = 86400000
const dateAfter = (day: string, count: number) => new Date(Date.parse(day) + count * DAY).toISOString().slice(0, 10)

function open(s: State, a: Actor, id: unknown) {
  const p = s.get('proposal', id)
  requireThat(p.workflow === 'delay-diagnosis' && canSeeDelay(s, a, p), 'Delay diagnosis not found', 404)
  requireThat(a.owner && !a.agent, 'Only the current human owner reviews native reminder trials', 403)
  requireThat(p.status === 'accepted', 'Accept the diagnosis draft before designing its trial', 409)
  requireCan(s, a, s.get('vacancy', p.delay.cohort.vacancy), 'settings')
  return p
}

/** Both original authorities must still see the same complete observation cohort. */
async function evidence(s: State, a: Actor, p: Data, cohort: Data) {
  const report = delayAnalysis(s, a, await workspaceRecords(s, a), cohort)
  for (const who of [p.proposedFor, p.approver]) {
    const actor = delayHuman(s, who)
    requireThat(actor, 'Original diagnosis authority was revoked', 403)
    const shared = delayAnalysis(s, actor, await workspaceRecords(s, actor), cohort)
    requireThat(canonical(report.sources) === canonical(shared.sources), 'Original authorities must share the complete trial cohort', 403)
  }
  for (const kind of ['application', 'stage-event', 'offer', 'interview']) s.scan(kind)
  return report
}

function due(s: State, report: Data, policy: Data, firstDay?: string) {
  return report.cases.flatMap((row: Data) => {
    const app = s.get('application', row.application), last = row.events.at(-1)
    if (app.imported || app.status !== 'active' || app.stage !== policy.stage || !last || last.to !== app.stage || !Number.isFinite(Date.parse(last.at))) return []
    if (firstDay && (!app.submittedAt || times(report.cohort.timeZone).dateOf(app.submittedAt) < firstDay)) return []
    if ((Date.now() - Date.parse(last.at)) / 3600000 < policy.afterHours) return []
    return [{ application: app.id, event: last.id, due: businessToday(s) }]
  })
}

async function stamp(s: State, p: Data, report: Data, policy: Data, impact: Data[]) {
  const authorities = [p.proposedBy, p.proposedFor, p.approver].map(who => { s.get('member', who); return s.revisionOf('member', who) })
  s.get('business', 'main')
  return sha256(canonical({ proposal: p.id, sources: report.sources, policy, impact, authorities, business: s.revisionOf('business', 'main') }))
}

/** Replay eligibility on an isolated copy. It neither predicts faster hiring nor contacts anyone. */
export async function previewDelayTrial(s: State, a: Actor, b: Data) {
  const p = open(s, a, b.id)
  requireThat(p.delayTrial?.status !== 'active', 'Rollback the active native trial before replacing it', 409)
  const report = await evidence(s, a, p, p.delay.cohort)
  requireThat(canonical(report.sources) === canonical(p.sources), 'Diagnosis evidence changed; prepare a fresh draft', 409)
  requireThat(report.cohort.from && report.cohort.to && report.cohort.to < times(report.cohort.timeZone).dateOf(now()), 'A trial needs a bounded completed baseline submission cohort', 409)
  const policy = { stage: p.measurement.stage, afterHours: integer(b.afterHours, 'Hours before an internal review task', 1, 720), owner: a.email }
  const impact = due(s, report, policy)
  const isolated = s.clone()
  for (const row of impact) task(isolated, a, { ...row, owner: a.email, kind: 'task', note: 'Review native stage wait; no candidate contact is authorized by this task.' })
  const token = await stamp(s, p, report, policy, impact)
  const delayTrial = { status: 'review', policy, baseline: report, impact, token, previewedAt: now(), productionTasks: 0, outboundContacts: 0 }
  s.put('proposal', p.id, { ...p, delayTrial })
  s.audit(a, 'delay-trial-previewed', 'proposal:' + p.id)
  return delayTrial
}

export async function activateDelayTrial(s: State, a: Actor, b: Data) {
  const p = open(s, a, b.id), trial = p.delayTrial
  requireThat(b.confirm === true, 'Explicitly approve the exact native task policy')
  requireThat(trial?.status === 'review' && b.token === trial.token, 'Review this exact trial first', 409)
  const report = await evidence(s, a, p, p.delay.cohort)
  requireThat(await stamp(s, p, report, trial.policy, due(s, report, trial.policy)) === trial.token, 'Trial sources, authority or eligibility changed; preview again', 409)
  const from = dateAfter(times(report.cohort.timeZone).dateOf(now()), 1), to = dateAfter(from, p.measurement.windowDays - 1)
  const next = { ...trial, status: 'active', activatedAt: now(), activatedBy: a.email, comparisonCohort: { ...report.cohort, from, to }, token: null }
  s.put('proposal', p.id, { ...p, delayTrial: next })
  s.audit(a, 'delay-trial-activated', 'proposal:' + p.id)
  return next
}

/** An explicit human run creates internal tasks only, once per native stage entry. */
export async function runDelayTrial(s: State, a: Actor, b: Data) {
  const p = open(s, a, b.id), trial = p.delayTrial
  requireThat(trial?.status === 'active' && trial.activatedBy === a.email, 'This native trial is not active', 409)
  const today = times(trial.comparisonCohort.timeZone).dateOf(now())
  requireThat(today >= trial.comparisonCohort.from && today <= trial.comparisonCohort.to, 'Run tasks within the declared comparison window', 409)
  const report = await evidence(s, a, p, trial.comparisonCohort), created = []
  const known = s.scan('task')
  for (const row of due(s, report, trial.policy, trial.comparisonCohort.from)) {
    if (known.some(t => t.delayTrial === p.id && t.delayEvent === row.event)) continue
    const record = task(s, a, { application: row.application, owner: a.email, kind: 'task', due: row.due, note: 'Review native stage wait; no candidate contact is authorized by this task.' })
    s.put('task', record.id, { ...record, delayTrial: p.id, delayEvent: row.event })
    created.push(record.id)
  }
  s.put('proposal', p.id, { ...p, delayTrial: { ...trial, lastRunAt: now(), taskReport: report } })
  s.audit(a, 'delay-trial-tasks-reviewed', 'proposal:' + p.id, { tasks: created.length })
  return { created, outboundContacts: 0 }
}

export async function compareDelayTrial(s: State, a: Actor, b: Data) {
  const p = open(s, a, b.id), trial = p.delayTrial
  requireThat(trial && ['active', 'rolled-back'].includes(trial.status), 'Activate a reviewed trial before comparing observations', 409)
  const report = await evidence(s, a, p, trial.comparisonCohort)
  const measured = report.stages.find((row: Data) => row.stage === p.measurement.stage)
  const complete = times(report.cohort.timeZone).dateOf(now()) > report.cohort.to!
  const enough = complete && measured?.intervals >= p.measurement.minimumIntervals
  const comparison = { report, measuredAt: now(), baselineHours: p.measurement.baselineHours, targetHours: p.measurement.targetHours, intervals: measured?.intervals ?? 0, meanHours: measured?.meanHours ?? null,
    conclusion: !enough ? 'Insufficient sample or comparison window still open' : measured.meanHours < p.measurement.targetHours ? 'Declared target observed' : 'Declared target not observed',
    limitation: 'Observed submission cohorts are not randomized. Missing histories and changed case mix can affect this comparison; no causal improvement is established.' }
  s.put('proposal', p.id, { ...p, delayTrial: { ...trial, comparison } })
  s.audit(a, 'delay-trial-measured', 'proposal:' + p.id)
  return comparison
}

export function rollbackDelayTrial(s: State, a: Actor, b: Data) {
  const p = open(s, a, b.id), trial = p.delayTrial
  requireThat(trial?.status === 'active', 'This native trial is not active', 409)
  for (const t of s.scan('task').filter(t => t.delayTrial === p.id && t.status === 'open')) s.put('task', t.id, { ...t, status: 'cancelled', closedAt: now(), closedReason: 'Native delay trial rolled back' })
  s.put('proposal', p.id, { ...p, delayTrial: { ...trial, status: 'rolled-back', rolledBackAt: now() } })
  s.audit(a, 'delay-trial-rolled-back', 'proposal:' + p.id)
  return { status: 'rolled-back' }
}
