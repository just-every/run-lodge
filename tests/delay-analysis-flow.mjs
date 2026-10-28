import assert from 'node:assert/strict'
import { businessHarness } from './harness.mjs'
import { RANGE, RUBRIC } from './hiring-fixture.mjs'

export const delayPath = '/api/lodge/delay-analysis'
const address = local => [local, 'example.test'].join('@')
export async function delayFixture() {
  const h = await businessHarness({ clock: '2030-10-28T10:00:00.000Z' })
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
    const first = (await at('2030-10-01T12:00:00.000Z', 'candidate', { name: 'Synthetic first delay', email: address('synthetic-lodge-delay-1'), vacancy: job.id, source: 'Direct', consentBasis: 'manual' })).application
    const second = (await h.command('candidate', { name: 'Synthetic second delay', email: address('synthetic-lodge-delay-2'), vacancy: job.id, source: 'Direct', consentBasis: 'manual' })).application
    const incomplete = (await h.command('candidate', { name: 'Synthetic incomplete delay', email: address('synthetic-lodge-delay-3'), vacancy: job.id, source: 'Direct', consentBasis: 'manual' })).application
    await at('2030-10-02T12:00:00.000Z', 'move', { application: first.id, to: job.stages[1].id, reason: 'Human completed review' })
    await at('2030-10-03T12:00:00.000Z', 'move', { application: second.id, to: job.stages[1].id, reason: 'Human completed review' })
    await at('2030-10-04T12:00:00.000Z', 'move', { application: first.id, to: job.stages[2].id, reason: 'Human scheduled next step' })
    await at('2030-10-05T12:00:00.000Z', 'move', { application: second.id, to: job.stages[2].id, reason: 'Human scheduled next step' })
    const iv = await h.command('interview', { application: first.id, planItem: (await h.state()).vacancies.find(v => v.id === job.id).plan[0].id, participants: [managerEmail], slots: ['2030-10-10T12:00:00.000Z'] })
    await h.command('availability', { interview: iv.id, slots: [0] }, manager)
    await h.setTime('2030-10-06T00:00:00.000Z')
    const form = new FormData(); form.set('slot', '0')
    assert.equal((await h.send('/availability/' + iv.candidateToken, form)).status, 200)
    await at('2030-10-06T12:00:00.000Z', 'schedule', { interview: iv.id, slot: 0 })
    await h.setTime('2030-10-05T12:00:00.000Z')
    const offer = await h.command('offer', { application: first.id, opening: (await h.state()).vacancies.find(v => v.id === job.id).openings[0].id, title: job.title, startDate: '2030-12-01', salary: { currency: 'USD', amount: 9000000, period: 'year' } })
    await approve(await h.command('request-offer-approval', { id: offer.id, approver: ownerEmail }))
    await at('2030-10-07T12:00:00.000Z', 'offer-outcome', { id: offer.id, outcome: 'declined', reason: 'Recorded candidate choice' })
    await h.command('offer', { application: incomplete.id, opening: (await h.state()).vacancies.find(v => v.id === job.id).openings[1].id, startDate: '2030-12-01', salary: { currency: 'USD', amount: 9500000, period: 'year' } })
    // A retained legacy case lacks its intake event. This tests honest missing history, not invented timestamps.
    await h.db.prepare("DELETE FROM l_records WHERE kind='stage-event' AND json_extract(value,'$.application')=?").bind(incomplete.id).run()
    return Object.assign(h, { ownerEmail, managerEmail, manager, agentEmail, agent, reviewerEmail, reviewer, outsider, job, first, second, incomplete, offer, iv })
  } catch (error) { await h.close(); throw error }
}

export function delayDraft(report, approver) {
  const stage = report.stages.find(s => s.intervals > 0)
  return {
    workflow: 'delay-diagnosis', approver, cohort: report.cohort, sources: report.sources,
    summary: 'Review the observed recruiting queue',
    findings: [{ kind: 'hypothesis', text: 'A daily review window may reduce the observed queue; the responsible wait is unknown.', citations: report.sources.filter(s => ['stage-event', 'offer', 'interview'].includes(s.kind)) }],
    uncertainty: 'Mailbox, scheduling and survey observations are unknown. These durations do not establish responsibility.',
    sampleLimits: 'Three observed cases are too few for a general conclusion; unfinished and missing histories are excluded from means.',
    proposedChange: 'Draft a daily queue review for a separately approved sandbox trial.',
    successCriterion: 'Use a future matched submission cohort, retain the same completed-stage definition and disclose missing history.',
    measurement: { metric: 'mean-completed-stage-hours', stage: stage?.stage, targetHours: stage?.meanHours * 0.8, minimumIntervals: 10, windowDays: 14 },
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
  assert.deepEqual([report.totals.cases, report.totals.completedIntervals, report.totals.offers, report.totals.measuredOutcomes, report.totals.meanOfferHours, report.totals.outcomes.declined, report.totals.outcomes.draft], [3, 4, 2, 1, 48, 1, 1])
  assert.ok(report.cases.find(c => c.application === h.incomplete.id).missing.some(x => x.includes('Initial stage entry')))
  assert.ok(report.unknowns.some(x => x.includes('Mailbox')) && report.unknowns.some(x => x.includes('Survey')))
  assert.equal(JSON.stringify(report).includes(h.managerEmail), false, 'evidence omits event actors and decision reasons')
  const scheduled = report.cases.find(c => c.application === h.first.id).scheduling[0]
  assert.deepEqual([scheduled.hoursToRecordedSchedule, scheduled.hoursToCandidateAvailability, scheduled.panelResponses, scheduled.panelSize, scheduled.candidateResponded, scheduled.providerVerified], [24, 12, 1, 1, true, false])
  assert.equal(scheduled.revision, report.sources.find(x => x.kind === 'interview' && x.id === h.iv.id).revision)
  assert.equal(report.hiring.totals.measuredHires, 0)
  assert.equal(report.hiring.totals.meanDaysToHire, null)
  const detail = await read(h.agent, '/' + h.first.id)
  assert.deepEqual(detail.intervals.map(i => i.hours), [24, 48])
  assert.deepEqual((await h.send(delayPath + query + '&from=2030-10-02', undefined, h.agent)).value.totals.cases, 0)
  assert.equal((await h.send(delayPath + query)).status, 401)
  assert.equal((await h.send(delayPath + query, undefined, h.outsider)).status, 404)
  const draft = delayDraft(report, h.reviewerEmail)
  for (const citations of [[{ kind: 'stage-event', id: 'synthetic-lodge-invented', revision: 'synthetic-lodge-invented' }], [{ ...draft.findings[0].citations[0], revision: 'synthetic-lodge-stale' }]]) {
    assert.equal((await h.send('/api/lodge/command/propose', { ...draft, findings: [{ ...draft.findings[0], citations }] }, h.agent)).status, 409)
  }
  for (const summary of ['Rank the best candidate', 'Age determines the queue', 'Mailbox failure caused the wait']) assert.equal((await h.send('/api/lodge/command/propose', { ...draft, summary }, h.agent)).status, 400)
  assert.equal((await h.send('/api/lodge/command/propose', draft, h.manager)).status, 403, 'people do not impersonate an agent author')
  assert.equal((await h.send('/api/lodge/command/propose', { ...draft, approver: h.agentEmail }, h.agent)).status, 403)
  assert.equal((await h.send('/api/lodge/command/propose', { ...draft, measurement: { ...draft.measurement, targetHours: 1000 } }, h.agent)).status, 400, 'a success target must improve the actual observed metric')
  await h.command('interview-reply', { interview: h.iv.id, answer: 'cannot-attend', note: 'Synthetic declaration only' }, h.manager)
  assert.equal((await h.send('/api/lodge/command/propose', draft, h.agent)).status, 409, 'a changed native scheduling record invalidates diagnosis sources')
  report = await read()
  Object.assign(draft, delayDraft(report, h.reviewerEmail))
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
  await checkHumanDelayFeedback(h)
  await h.command('candidate-privacy', { id: h.first.candidate, private: true })
  const privateReport = await read()
  assert.deepEqual([privateReport.totals.cases, privateReport.totals.offers], [7, 1], 'private cases and their offers are excluded before aggregation')
  assert.equal((await h.send(delayPath + '/' + h.first.id + query, undefined, h.agent)).status, 404)
  assert.equal((await h.state(h.reviewer)).proposals.length, 0, 'private-case revocation hides the entire multi-case narrative')
  await h.command('candidate-privacy', { id: h.first.candidate, private: false })
  Object.assign(draft, delayDraft(await read(), h.reviewerEmail))
  const stale = await h.command('propose', draft, h.agent)
  await h.setTime('2030-10-08T12:00:00.000Z')
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

async function checkHumanDelayFeedback(h) {
  const form = fields => { const body = new FormData(); for (const [key, value] of Object.entries(fields)) body.set(key, value); return body }
  const survey = await h.command('survey-configure', { vacancy: h.job.id, trigger: h.job.stages[0].id, title: 'Synthetic process feedback', questions: ['How clear was the process?'], language: 'en', subject: 'Synthetic experience invitation', invitation: 'Share voluntary process feedback', enabled: true })
  let identified
  for (let n = 0; n < 5; n++) {
    const email = address('synthetic-lodge-delay-survey-' + n)
    const app = (await h.command('candidate', { name: 'Synthetic survey delay ' + n, email, vacancy: h.job.id, source: 'Direct', consentBasis: 'manual' })).application
    await h.command('survey-consent', { application: app.id, enabled: true, basis: 'Explicit synthetic consent record' })
    assert.equal((await h.send('/surveys/send', form({ application: app.id, survey: survey.id, confirm: 'yes' }), h.owner)).status, 200)
    const messages = (await h.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence DESC').all()).results.map(row => JSON.parse(row.message))
    const message = messages.find(m => m.to.includes(email))
    const path = new URL(message.text.match(/http:\/\/\S+\/surveys\/respond\/\S+/)[0]).pathname
    assert.equal((await h.send(path, form({ mode: n === 0 ? 'identified' : 'anonymous', identify: 'yes', consent: 'yes', 'score-0': '4' }))).status, 200)
    if (n === 0) identified = app
    const response = await h.send('/api/lodge/delay-feedback?vacancy=' + h.job.id, undefined, h.owner)
    assert.equal(response.status, 200, response.text)
    assert.equal(response.value.surveys[0].suppressed, n < 4)
    if (n < 4) assert.deepEqual([response.value.surveys[0].averages, response.value.surveys[0].identified], [null, []])
  }
  const path = '/api/lodge/delay-feedback?vacancy=' + h.job.id
  const feedback = (await h.send(path, undefined, h.owner)).value
  assert.deepEqual(feedback.surveys[0].averages, [4])
  assert.deepEqual(feedback.surveys[0].identified.map(x => x.application), [identified.id], 'anonymous answers never acquire application links')
  const emptyCohort = (await h.send(path + '&from=2030-10-09', undefined, h.owner)).value
  assert.equal(emptyCohort.surveys[0].responses, 5, 'anonymous aggregates retain their full survey-version denominator')
  assert.deepEqual(emptyCohort.surveys[0].identified, [])
  for (const who of [h.agent, h.manager, h.reviewer, h.outsider]) assert.equal((await h.send(path, undefined, who)).status, 403)
  const ownerAgentEmail = address('synthetic-lodge-owner-delay-agent'), ownerAgent = await h.member(ownerAgentEmail, [], 'Synthetic owner agent', { agent: true, actsFor: h.ownerEmail })
  assert.equal((await h.send(path, undefined, ownerAgent)).status, 403, 'an owner principal does not grant agents survey answers')
  const evidence = (await h.send(delayPath + '?vacancy=' + h.job.id, undefined, ownerAgent)).value
  assert.equal(JSON.stringify(evidence).includes('scores'), false)
  assert.equal(JSON.stringify(evidence).includes('Synthetic process feedback'), false)
  await h.command('survey-consent', { application: identified.id, enabled: false, basis: 'Synthetic candidate revoked feedback consent' })
  const stopped = (await h.send(path, undefined, h.owner)).value.surveys[0]
  assert.deepEqual([stopped.responses, stopped.suppressed, stopped.averages, stopped.identified], [4, true, null, []])
  await h.setTime('2030-11-08T12:00:00.000Z')
  assert.equal((await h.send(path, undefined, await h.signIn(h.ownerEmail))).value.surveys[0].responses, 0, 'expired answers are not readable before maintenance')
  await h.setTime('2030-10-07T12:00:00.000Z')
}
