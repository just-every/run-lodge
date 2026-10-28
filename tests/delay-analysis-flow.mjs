import assert from 'node:assert/strict'
import { businessHarness } from './harness.mjs'
import { RANGE, RUBRIC } from './hiring-fixture.mjs'

export const delayPath = '/api/lodge/delay-analysis'
const address = local => [local, 'example.test'].join('@')
export async function delayFixture() {
  const h = await businessHarness({ clock: new Date().toISOString() })
  try {
    const ownerEmail = (await h.state()).actor.email
    const managerEmail = address('synthetic-lodge-delay-lead'), agentEmail = address('synthetic-lodge-delay-agent')
    const manager = await h.member(managerEmail, ['manager']), agent = await h.member(agentEmail, [], 'Synthetic diagnosis agent', { agent: true, actsFor: managerEmail })
    const reviewerEmail = address('synthetic-lodge-delay-reviewer'), reviewer = await h.member(reviewerEmail, ['manager'])
    const outsider = await h.member(address('synthetic-lodge-delay-outsider'), ['interviewer'])
    const approve = async request => h.command('decide-approval', { id: request.id, version: request.version, decision: 'approved', reason: 'Reviewed headcount and exact offer terms' })
    const job = await h.command('vacancy', { title: 'Synthetic delay cohort', location: 'Denver, CO', manager: ownerEmail, headcount: 3, compensation: RANGE })
    await h.command('rubric', { id: job.id, criteria: RUBRIC })
    await h.command('interview-plan', { id: job.id, plan: [{ name: 'Work review', stageName: 'Interview' }] })
    await approve(await h.command('request-vacancy-approval', { id: job.id, approver: ownerEmail }))
    await h.command('hiring-team', { id: job.id, hiringManagers: [managerEmail, reviewerEmail] })
    await h.command('publish', { id: job.id })
    const at = async (date, op, body) => { await h.setTime(date); return h.command(op, body) }
    const first = (await at('2026-10-01T12:00:00.000Z', 'candidate', { name: 'Synthetic first delay', email: address('synthetic-lodge-delay-1'), vacancy: job.id, source: 'Direct', consentBasis: 'manual' })).application
    const second = (await h.command('candidate', { name: 'Synthetic second delay', email: address('synthetic-lodge-delay-2'), vacancy: job.id, source: 'Direct', consentBasis: 'manual' })).application
    const incomplete = (await h.command('candidate', { name: 'Synthetic incomplete delay', email: address('synthetic-lodge-delay-3'), vacancy: job.id, source: 'Direct', consentBasis: 'manual' })).application
    await at('2026-10-02T12:00:00.000Z', 'move', { application: first.id, to: job.stages[1].id, reason: 'Human completed review' })
    await at('2026-10-03T12:00:00.000Z', 'move', { application: second.id, to: job.stages[1].id, reason: 'Human completed review' })
    await at('2026-10-04T12:00:00.000Z', 'move', { application: first.id, to: job.stages[2].id, reason: 'Human scheduled next step' })
    await at('2026-10-05T12:00:00.000Z', 'move', { application: second.id, to: job.stages[2].id, reason: 'Human scheduled next step' })
    const offer = await h.command('offer', { application: first.id, opening: (await h.state()).vacancies.find(v => v.id === job.id).openings[0].id, title: job.title, startDate: '2026-12-01', salary: { currency: 'USD', amount: 9000000, period: 'year' } })
    await approve(await h.command('request-offer-approval', { id: offer.id, approver: ownerEmail }))
    await at('2026-10-07T12:00:00.000Z', 'offer-outcome', { id: offer.id, outcome: 'declined', reason: 'Recorded candidate choice' })
    // A retained legacy case lacks its intake event. This tests honest missing history, not invented timestamps.
    await h.db.prepare("DELETE FROM l_records WHERE kind='stage-event' AND json_extract(value,'$.application')=?").bind(incomplete.id).run()
    return Object.assign(h, { ownerEmail, managerEmail, manager, agentEmail, agent, reviewerEmail, reviewer, outsider, job, first, second, incomplete, offer })
  } catch (error) { await h.close(); throw error }
}

export function delayDraft(report, approver) {
  return {
    workflow: 'delay-diagnosis', approver, cohort: report.cohort, sources: report.sources,
    summary: 'Review the observed recruiting queue',
    findings: [{ kind: 'hypothesis', text: 'A daily review window may reduce the observed queue; the responsible wait is unknown.', citations: report.sources.filter(s => ['stage-event', 'offer'].includes(s.kind)) }],
    uncertainty: 'Mailbox, scheduling and survey observations are unknown. These durations do not establish responsibility.',
    sampleLimits: 'Three observed cases are too few for a general conclusion; unfinished and missing histories are excluded from means.',
    proposedChange: 'Draft a daily queue review for a separately approved sandbox trial.',
    successCriterion: 'In a future 14-day matched submission cohort, reduce mean completed first-stage hours below 30 with at least 10 completed visits; retain the same definition and disclose missing history.',
  }
}

export async function checkDelayAnalysis(t) {
  const h = await delayFixture(); t.after(() => h.close())
  const query = '?vacancy=' + h.job.id, read = async (who = h.agent, suffix = '') => {
    const r = await h.send(delayPath + suffix + query, undefined, who)
    assert.equal(r.status, 200, r.text); return r.value
  }
  let report = await read()
  // Expected intervals are calculated independently from the fixed public command times.
  assert.deepEqual(report.stages.slice(0, 2).map(s => [s.intervals, s.totalHours, s.meanHours]), [[2, 72, 36], [2, 96, 48]])
  assert.deepEqual([report.totals.cases, report.totals.completedIntervals, report.totals.offers, report.totals.measuredOutcomes, report.totals.meanOfferHours, report.totals.outcomes.declined], [3, 4, 1, 1, 48, 1])
  assert.ok(report.cases.find(c => c.application === h.incomplete.id).missing.some(x => x.includes('Initial stage entry')))
  assert.ok(report.unknowns.some(x => x.includes('Mailbox')) && report.unknowns.some(x => x.includes('Survey')))
  assert.equal(JSON.stringify(report).includes(h.managerEmail), false, 'evidence omits event actors and decision reasons')
  const detail = await read(h.agent, '/' + h.first.id)
  assert.deepEqual(detail.intervals.map(i => i.hours), [24, 48])
  assert.deepEqual((await h.send(delayPath + query + '&from=2026-10-02', undefined, h.agent)).value.totals.cases, 0)
  assert.equal((await h.send(delayPath + query)).status, 401)
  assert.equal((await h.send(delayPath + query, undefined, h.outsider)).status, 404)
  const draft = delayDraft(report, h.reviewerEmail)
  for (const citations of [[{ kind: 'stage-event', id: 'synthetic-lodge-invented', revision: 'synthetic-lodge-invented' }], [{ ...draft.findings[0].citations[0], revision: 'synthetic-lodge-stale' }]]) {
    assert.equal((await h.send('/api/lodge/command/propose', { ...draft, findings: [{ ...draft.findings[0], citations }] }, h.agent)).status, 409)
  }
  for (const summary of ['Rank the best candidate', 'Age determines the queue', 'Mailbox failure caused the wait']) assert.equal((await h.send('/api/lodge/command/propose', { ...draft, summary }, h.agent)).status, 400)
  assert.equal((await h.send('/api/lodge/command/propose', draft, h.manager)).status, 403, 'people do not impersonate an agent author')
  assert.equal((await h.send('/api/lodge/command/propose', { ...draft, approver: h.agentEmail }, h.agent)).status, 403)
  const before = await h.state(), packet = await h.command('propose', draft, h.agent)
  assert.equal(packet.model, null)
  assert.ok((await h.state(h.reviewer)).proposals.some(p => p.id === packet.id))
  assert.equal((await h.send('/api/lodge/command/decide-proposal', { id: packet.id, decision: 'accepted', reason: 'Unauthorized review' }, h.manager)).status, 403)
  assert.equal((await h.send('/api/lodge/command/decide-proposal', { id: packet.id, decision: 'approved', reason: 'Attempt production application' }, h.reviewer)).status, 400)
  const accepted = await h.command('decide-proposal', { id: packet.id, decision: 'accepted', reason: 'Keep as a draft for later trial design' }, h.reviewer)
  assert.equal(accepted.status, 'accepted')
  const rejected = await h.command('propose', draft, h.agent)
  await h.command('decide-proposal', { id: rejected.id, decision: 'rejected', reason: 'Need more observations' }, h.reviewer)
  const after = await h.state()
  for (const field of ['applications', 'offers', 'vacancies', 'sandboxes']) assert.deepEqual(after[field], before[field], 'draft decisions change no hiring or production configuration: ' + field)
  assert.equal((await h.send('/api/lodge/command/decide-proposal', { id: accepted.id, decision: 'accepted', reason: 'Replay' }, h.reviewer)).status, 409)
  const stale = await h.command('propose', draft, h.agent)
  await h.setTime('2026-10-08T12:00:00.000Z')
  await h.command('move', { application: h.second.id, to: h.job.stages[3].id, reason: 'New committed observation' })
  assert.equal((await h.send('/api/lodge/command/propose', draft, h.agent)).status, 409)
  assert.equal((await h.send('/api/lodge/command/decide-proposal', { id: stale.id, decision: 'accepted', reason: 'Stale evidence' }, h.reviewer)).status, 409)
  report = await read()
  const fresh = await h.command('propose', delayDraft(report, h.reviewerEmail), h.agent)
  const restricted = await h.command('permission-level', { name: 'Synthetic delay no offers', permissions: ['move', 'export'] })
  await h.command('job-levels', { id: h.job.id, members: { [h.reviewerEmail]: restricted.id }, roles: {} })
  for (const who of [h.agent, h.manager, h.reviewer, h.owner]) assert.ok(!(await h.state(who)).proposals.some(p => p.id === fresh.id), 'the entire narrative disappears when reviewer access is revoked')
  assert.equal((await h.send('/api/lodge/command/propose', delayDraft(report, h.reviewerEmail), h.agent)).status, 403)
  await h.command('job-levels', { id: h.job.id, members: {}, roles: {} })
  await h.command('hiring-team', { id: h.job.id, hiringManagers: [h.reviewerEmail] })
  assert.equal((await h.send(delayPath + query, undefined, h.agent)).status, 404)
  assert.equal((await h.send(delayPath + '/' + h.first.id + query, undefined, h.agent)).status, 404)
  assert.equal((await h.state(h.reviewer)).proposals.length, 0, 'principal revocation also hides all historical narrative from the reviewer')
  await h.command('hiring-team', { id: h.job.id, hiringManagers: [h.managerEmail, h.reviewerEmail] })
  const person = (await h.state()).candidates.find(c => c.id === h.first.candidate)
  await h.command('move', { application: h.first.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Close before erasure' })
  const hold = await h.command('hold', { candidate: person.id, reason: 'Preserve pending request' })
  const erase = () => h.send('/api/lodge/delete-candidate', { candidate: person.id, confirm: person.name, reason: 'Authorized deletion' }, h.owner)
  assert.equal((await erase()).status, 409)
  await h.command('release-hold', { id: hold.id, reason: 'Hold released' })
  assert.equal((await erase()).status, 200)
  assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM l_records WHERE kind='proposal'").first()).n, 0, 'erasure removes every related evidence packet including accepted and rejected narrative')
  assert.equal((await h.send('/api/lodge/command/propose', draft, h.agent)).status, 409, 'replayed capture cannot resurrect erased evidence')
  await h.command('member', { email: h.agentEmail, name: 'Synthetic revoked agent', roles: [], agent: true, actsFor: h.managerEmail, active: false })
  assert.equal((await h.send(delayPath + query, undefined, h.agent)).status, 403)
}
