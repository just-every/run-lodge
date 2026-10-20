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
    return { label: text(raw.label ?? `Test case ${index + 1}`, 'Test case label', 100), answers: raw.answers ?? {}, move: raw.move, interview: raw.interview }
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
    evaluate(isolated, app, selected.mode === 'historical' ? 'Sandbox historical replay' : 'Sandbox synthetic intake')
    if (sample.move) move(isolated, a, { ...sample.move, application: id })
    let scheduling: Data | null = null
    if (sample.interview) {
      const iv = interview(isolated, a, { ...sample.interview, application: id })
      const result = sample.interview.slot === undefined ? iv : schedule(isolated, a, { interview: iv.id, slot: sample.interview.slot })
      scheduling = { title: result.title, durationMinutes: result.durationMinutes, status: result.status, slots: result.slots, start: result.start ?? null, participants: result.participants, timezone: result.timezone }
    }
    const after = isolated.get('application', id)
    outcomes.push({ case: index + 1, before, after: { stage: after.stage, status: after.status, reviewers: after.reviewers ?? [], tags: after.tags ?? [] }, scheduling,
      rules: isolated.all('rule-match').filter(m => m.application === id).map(m => ({ rule: m.ruleName, version: m.version, status: m.status, reason: m.reason })),
      scheduledRejectionEmails: isolated.all('rejection-email').filter(m => m.application === id).length,
    })
  }
  let approval: Data | null = null
  if (v.approvalRouting?.vacancy) {
    const result = await requestApproval(s.clone(), a, 'vacancy', v, v.approvalRouting.vacancy)
    approval = { approver: result.approver, status: result.status, version: result.version }
  }
  return { outcomes, approval, routes: v.approvalRouting ?? {}, stages: v.stages, rubricVersion: v.rubrics.at(-1)?.version ?? null, plan: v.plan, questions: v.questions ?? [], productionContact: 0, productionSignatures: 0, productionHrRecords: 0,
    explanation: 'Only an isolated in-memory copy was evaluated. No recipients, messages, signatures, calendar invitations or HR records are sent or copied to production. Deployment copies configuration only; production runs require their own existing approvals.' }
}
