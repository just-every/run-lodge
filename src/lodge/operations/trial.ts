import { schemaOf } from '../fields/schema'
import { validateValues, valuesFor, requireStageFields } from '../fields/values'
import type { State } from '../core/state'
import { requireApplication } from '../core/access'
import { list, now, oneOf, requireThat, text, type Actor, type Data } from '../core/types'
import { answers } from '../records/questions'
import { evaluate } from '../records/rules'
import { move } from '../records/pipeline'
import { interview, schedule } from '../records/interviews'
import { requestApproval } from '../records/approvals'

/** Explicit synthetic inputs are user test data, never application seed/fallback data. */
export function selection(s: State, a: Actor, job: string, input: Data) {
  const mode = oneOf(input.mode, ['historical', 'synthetic'] as const, 'Test data')
  const samples = list(input.samples, 'Selected test cases', 30, (raw: any, index) => {
    if (mode === 'historical') {
      const app = requireApplication(s, a, raw.application)
      requireThat(app.vacancy === job, 'Select history from this vacancy')
      return { application: app.id, move: raw.move, interview: raw.interview }
    }
    requireThat(input.confirmSynthetic === true, 'Confirm these are synthetic test inputs')
    // Typed answers are validated by the real SCREEN-001 validator during preview.
    return { label: text(raw.label ?? `Test case ${index + 1}`, 'Test case label', 100), answers: raw.answers ?? {}, customValues: raw.customValues ?? {}, move: raw.move, interview: raw.interview }
  })
  requireThat(samples.length, 'Select at least one test case')
  return { mode, samples, confirmSynthetic: mode === 'synthetic' }
}

export async function trial(s: State, a: Actor, job: string, selected: Data) {
  const v = s.get('vacancy', job), outcomes: Data[] = []
  for (const [index, sample] of selected.samples.entries()) {
    // Each sample gets its own independent state. Neither another sample nor production changes.
    const isolated = s.clone(), id = `sandbox-${index}`, candidate = `sandbox-person-${index}`
    const original = selected.mode === 'historical' ? requireApplication(isolated, a, sample.application) : null
    const person = original ? isolated.get('candidate', original.candidate) : { name: sample.label }
    isolated.put('candidate', candidate, { ...person, id: candidate })
    const app = isolated.put('application', id, original ? { ...original, candidate, id } : { vacancy: job, candidate, status: 'active', stage: v.stages[0].id, rubricVersion: v.rubrics.at(-1)?.version, submittedAt: now(), answers: answers(isolated, v, sample.answers), reviewers: [], tags: [] })
    const before = { stage: app.stage, status: app.status, reviewers: app.reviewers ?? [], tags: app.tags ?? [] }
    try {
    if (selected.mode === 'synthetic') {
      const schema = schemaOf(v), values = validateValues(schema, sample.customValues ?? {})
      for (const [kind, row] of [['candidate', isolated.get('candidate', candidate)], ['application', app], ['vacancy', isolated.get('vacancy', job)]] as const) isolated.put(kind, row.id, { ...row, customValues: { ...row.customValues, ...valuesFor(schema, values, kind) } })
    }
    requireStageFields(isolated, isolated.get('vacancy', job), isolated.get('application', id), app.stage)
    evaluate(isolated, isolated.get('application', id), selected.mode === 'historical' ? 'Sandbox historical replay' : 'Sandbox synthetic intake')
    if (sample.move) move(isolated, a, { ...sample.move, application: id })
    let scheduling: Data | null = null
    if (sample.interview) {
      const iv = interview(isolated, a, { ...sample.interview, application: id })
      const result = sample.interview.slot === undefined ? iv : schedule(isolated, a, { interview: iv.id, slot: sample.interview.slot })
      scheduling = { title: result.title, durationMinutes: result.durationMinutes, status: result.status, slots: result.slots, start: result.start ?? null, participants: result.participants, timezone: result.timezone }
    }
    const after = isolated.get('application', id)
    if (after.status === 'active') requireStageFields(isolated, isolated.get('vacancy', job), after, after.stage)
    const { workspaceRecords } = await import('../views/workspace')
    const { savedHiringView } = await import('../views/field-views')
    const projected = await workspaceRecords(isolated, a)
    const projectedJob = projected.vacancies.find(v => v.id === job)
    const views = (projectedJob?.hiringViews ?? []).map((view: Data) => ({ id: view.id, name: view.name, matches: savedHiringView(projected, job, view.id).applications.some(app => app.id === id) }))
    outcomes.push({ case: index + 1, before, views, after: { stage: after.stage, status: after.status, reviewers: after.reviewers ?? [], tags: after.tags ?? [] }, scheduling,
      rules: isolated.all('rule-match').filter(m => m.application === id).map(m => ({ rule: m.ruleName, version: m.version, status: m.status, reason: m.reason })),
      scheduledRejectionEmails: isolated.all('rejection-email').filter(m => m.application === id).length,
    })
    } catch (error) {
      const { workspaceRecords } = await import('../views/workspace')
    const { savedHiringView } = await import('../views/field-views')
    const projected = await workspaceRecords(isolated, a)
    const projectedJob = projected.vacancies.find(v => v.id === job)
    const views = (projectedJob?.hiringViews ?? []).map((view: Data) => ({ id: view.id, name: view.name, matches: savedHiringView(projected, job, view.id).applications.some(app => app.id === id) }))
    outcomes.push({ case: index + 1, before, views, after: before, error: error instanceof Error ? error.message : 'Trial could not complete', scheduling: null, rules: [], scheduledRejectionEmails: 0 })
    }
  }
  let approval: Data | null = null
  if (v.approvalRouting?.vacancy) {
    const result = await requestApproval(s.clone(), a, 'vacancy', v, v.approvalRouting.vacancy)
    approval = { approver: result.approver, status: result.status, version: result.version }
  }
  return { outcomes, fieldScopes: (v.customSchema ?? []).filter((f: Data) => a.owner || a.roles.includes('admin') || !f.restricted).map((f: Data) => ({ field: f.name, record: f.record, scope: f.restricted ? 'owner/admin only' : 'job-scoped readers', requiredStages: f.requiredStages })), approval, routes: v.approvalRouting ?? {}, stages: v.stages, rubricVersion: v.rubrics.at(-1)?.version ?? null, plan: v.plan, questions: v.questions ?? [], productionContact: 0, productionSignatures: 0, productionHrRecords: 0,
    explanation: 'Only an isolated in-memory copy was evaluated. No recipients, messages, signatures, calendar invitations or HR records are sent or copied to production. Deployment copies configuration only; production runs require their own existing approvals.' }
}
