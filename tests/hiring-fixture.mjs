// Shared public-door setup for independent area suites. Each suite owns its
// Worker/D1 and native sessions; no shard depends on another shard's records.
import { BUSINESS, harness } from './harness.mjs'

export const RANGE = { currency: 'USD', min: 9000000, max: 11000000, period: 'year' }
export const RUBRIC = [{ name: 'Site safety', description: 'Describes how they ran safety on a past site' }, { name: 'Scheduling', description: 'Explains a schedule they recovered' }]

export async function hiringScenario(t) {
  const h = await harness()
  t.after(() => h.close())
  const { command: cmd, state, owner } = h
  await cmd('business', BUSINESS)
  const manager = await h.member('morgan@example.test', ['manager'], 'Morgan Lee')
  const approver = await h.member('parker@example.test', ['approver'], 'Parker Jones')
  const ivy = await h.member('ivy@example.test', ['interviewer'], 'Ivy Chen')
  const ian = await h.member('ian@example.test', ['interviewer'], 'Ian Ruiz')
  const approve = async (id, cookie = approver) => {
    const v = (await state(cookie)).approvals.find(x => x.id === id)
    return cmd('decide-approval', { id, decision: 'approved', reason: 'Within budget', version: v.currentVersion }, cookie)
  }
  const openJob = async (title, location = 'Denver, CO') => {
    const draft = await cmd('vacancy', { title, location, headcount: 1, compensation: RANGE, manager: 'morgan@example.test' }, manager)
    const v = await cmd('rubric', { id: draft.id, criteria: RUBRIC }, manager)
    await cmd('interview-plan', { id: v.id, plan: [{ name: 'Floor walk', stage: v.stages[2].id }] }, manager)
    await approve((await cmd('request-vacancy-approval', { id: v.id, approver: 'parker@example.test' }, manager)).id)
    return cmd('publish', { id: v.id }, manager)
  }
  return { h, ...h, cmd, manager, approver, ivy, ian, approve, openJob, owner }
}
