import assert from 'node:assert/strict'
import { businessHarness } from './harness.mjs'
import { RANGE, RUBRIC } from './hiring-fixture.mjs'

export const analysisClock = '2026-10-26T14:00:00.000Z'
export const analysisQuestion = 'Show last-quarter source conversion and scheduling delay'
const metricQuery = metric => ({ metric, from: '2026-07-01', to: '2026-09-30', jobs: [], sources: [], groupBy: metric === 'stage_moves' ? 'stage' : metric === 'offer_outcomes' ? 'status' : 'source', chart: 'bar' })
export const analysisReview = { monthlyQuestions: 100, inputTokens: 3000, outputTokens: 1000, inputUsd: 2, outputUsd: 10, rateBasis: 'Synthetic isolated provider rate card, 2026-10-26', employerPlan: true, appAccess: true, legalReviewed: true }
export function analysisForm(fields) {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) for (const item of Array.isArray(value) ? value : [value]) form.append(key, String(item))
  return form
}

/** Native commands seed real records; only the optional model network edge is replaced. */
export async function analysisFixture({ liveModel = false, bindings = {} } = {}) {
  const edge = { mode: 'normal', requests: [], calls: 0 }
  const h = await businessHarness({ clock: analysisClock, bindings: liveModel ? bindings : { AI_ENABLED: 'true', AI_MODEL: 'synthetic-lodge-61', AI_BASE_URL: 'https://analysis-provider.example.test/v1', AI_API_KEY: 'synthetic-lodge-62', ...bindings }, ...(!liveModel ? { outboundService: async request => {
    assert.equal(new URL(request.url).pathname, '/v1/chat/completions')
    const body = await request.json(); edge.calls++; edge.requests.push(body)
    if (edge.mode === 'provider-failure') return new Response('synthetic-lodge-upstream-private-91', { status: 503 })
    const question = body.messages.at(-1).content
    let queries = question.toLowerCase().includes('offer') ? [metricQuery('offer_outcomes')] : question.toLowerCase().includes('stage') ? [metricQuery('stage_moves')] : [metricQuery('source_conversion'), metricQuery('scheduling_delay')]
    let plan = { refused: false, queries }
    if (edge.mode === 'protected-field') plan.queries[0].fields = ['monitoring']
    if (edge.mode === 'expression') plan.queries[0].expression = 'synthetic-lodge-private-expression-92'
    if (edge.mode === 'refusal') plan = { refused: true, queries: [] }
    if (edge.mode === 'unknown-metric') plan.queries[0].metric = 'private_material'
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(plan) } }], usage: { prompt_tokens: 500, completion_tokens: 150, total_tokens: 650 } })
  } } : {}) })
  try {
    const managerEmail = 'analysis-manager@example.test', manager = await h.member(managerEmail, ['manager'], 'Analysis manager')
    const interviewer = await h.member('analysis-panel@example.test', ['interviewer'], 'Analysis panel')
    const approve = async request => h.command('decide-approval', { id: request.id, version: (await h.state()).approvals.find(a => a.id === request.id).currentVersion, decision: 'approved', reason: 'Budgeted fixture terms' })
    const openJob = async (title, who = managerEmail, cookie = manager) => {
      const draft = await h.command('vacancy', { title, location: 'New York, NY', headcount: 3, compensation: RANGE, manager: who }, cookie)
      await h.command('rubric', { id: draft.id, criteria: RUBRIC }, cookie)
      await h.command('interview-plan', { id: draft.id, plan: [{ name: 'Work review', stageName: 'Interview', durationMinutes: 60 }] }, cookie)
      await approve(await h.command('request-vacancy-approval', { id: draft.id, approver: 'owner@example.test' }, cookie))
      return h.command('publish', { id: draft.id }, cookie)
    }
    const job = await openJob('Analysis site supervisor', 'owner@example.test', h.owner), hiddenJob = await openJob('Synthetic restricted job', 'owner@example.test', h.owner)
    await h.command('hiring-team', { id: job.id, hiringManagers: [managerEmail] })
    const add = async (name, source, vacancy = job.id, cookie = manager) => (await h.command('candidate', { name, email: name.toLowerCase().replaceAll(' ', '.') + '@example.test', source, consentBasis: 'application', vacancy }, cookie)).application
    await h.setTime('2026-07-10T14:00:00.000Z')
    const appA = await add('Synthetic analysis alpha', 'Referral'), appB = await add('Synthetic analysis beta', 'Careers page')
    const hiddenApp = await add('Synthetic unseen analysis person', 'Synthetic unseen source', hiddenJob.id, h.owner)
    const protectedSubmission = await h.send('/jobs/' + hiddenJob.slug, analysisForm({ name: 'Synthetic protected submitter', email: 'synthetic.protected@example.test', noticeVersion: '1', consent: 'yes', monitoring: 'Non-binary', accommodation: 'synthetic-lodge-protected-adjustment-94' }))
    assert.equal(protectedSubmission.status, 200, protectedSubmission.text)
    const interview = async application => h.command('interview', { application: application.id, planItem: job.plan[0].id, participants: ['analysis-panel@example.test'], slots: ['2026-08-03T14:00:00.000Z'] }, manager)
    const interviewA = await interview(appA), interviewB = await interview(appB)
    await h.command('scorecard', { application: appA.id, interview: interviewA.id, ratings: {}, evidence: {}, recommendation: 'yes', takeaways: 'synthetic-lodge-private-interview-93', submit: true }, interviewer)
    await h.setTime('2026-07-11T14:00:00.000Z')
    await h.command('move', { application: appA.id, to: job.stages[1].id, reason: 'Advanced after native review' }, manager)
    await h.setTime('2026-07-12T14:00:00.000Z'); await h.command('schedule', { interview: interviewA.id, slot: 0 }, manager)
    await h.setTime('2026-07-13T14:00:00.000Z'); await h.command('schedule', { interview: interviewB.id, slot: 0 }, manager)
    const offer = await h.command('offer', { application: appA.id, title: job.title, startDate: '2026-11-01', salary: { currency: 'USD', amount: 9500000, period: 'year' } }, manager)
    await approve(await h.command('request-offer-approval', { id: offer.id, approver: 'owner@example.test' }, manager))
    await h.setTime('2026-07-14T14:00:00.000Z'); await h.command('offer-outcome', { id: offer.id, outcome: 'declined', reason: 'Candidate chose another role' }, manager)
    await h.setTime('2026-10-01T03:59:59.000Z'); const appBoundary = await add('Synthetic local quarter end', 'Referral')
    await h.setTime('2026-10-01T04:00:00.000Z'); const appOutside = await add('Synthetic next quarter', 'Referral')
    await h.setTime(analysisClock)
    const configureProvider = async (input = analysisReview) => {
      const preview = await h.send('/api/lodge/analysis/setup/preview', input, h.owner)
      assert.equal(preview.status, 200, preview.text)
      const enabled = await h.send('/api/lodge/analysis/setup', { ...input, ...preview.value.preview, reviewed: true, enabled: true }, h.owner)
      assert.equal(enabled.status, 200, enabled.text)
      return enabled.value.review
    }
    const query = (metric, extra = {}) => ({ ...metricQuery(metric), ...extra })
    return Object.assign(h, { edge, manager, interviewer, job, hiddenJob, appA, appB, appBoundary, appOutside, hiddenApp, interviewA, interviewB, offer, configureProvider, query })
  } catch (error) { await h.close(); throw error }
}

export async function checkAnalysis(t) {
  const h = await analysisFixture(); t.after(() => h.close())
  const api = '/api/lodge/analysis', ask = (question = analysisQuestion, cookie = h.manager) => h.send(api + '/interpret', { question }, cookie)
  const preview = async query => { const r = await h.send(api + '/preview', { query }, h.manager); assert.equal(r.status, 200, r.text); return r.value.result }
  const before = (await h.state()).applications.map(a => [a.id, a.stage, a.status])
  assert.equal((await h.send('/analysis')).status, 401)
  assert.equal((await h.send('/analysis', undefined, h.interviewer)).status, 403)
  assert.equal((await ask()).status, 503); assert.equal(h.edge.calls, 0, 'provider remains off until reviewed')
  assert.equal((await h.send(api + '/setup/preview', analysisReview, h.manager)).status, 403)
  const review = await h.configureProvider(); assert.ok(review.monthlyUsd > 0)
  assert.equal((await h.send(api + '/setup', { ...review, ...analysisReview, model: 'synthetic-lodge-changed', reviewed: true, enabled: true }, h.owner)).status, 409)
  assert.equal((await h.send(api + '/interpret', { question: analysisQuestion }, h.manager, { origin: 'https://foreign.example.test' })).status, 403)
  const interpreted = await ask(); assert.equal(interpreted.status, 200, interpreted.text)
  const [source, scheduling] = interpreted.value.results
  assert.deepEqual([source.query.from, source.query.to], ['2026-07-01', '2026-09-30'])
  assert.deepEqual([source.total.numerator, source.total.denominator, source.total.value], [1, 3, 33.33])
  assert.deepEqual(source.evidence.map(e => e.application).sort(), [h.appA.id, h.appB.id, h.appBoundary.id].sort())
  assert.ok(!source.evidence.some(e => e.application === h.appOutside.id || e.application === h.hiddenApp.id))
  assert.equal(source.start, '2026-07-01T04:00:00.000Z'); assert.equal(source.endExclusive, '2026-10-01T04:00:00.000Z')
  assert.equal(scheduling.total.value, 60)
  assert.deepEqual(scheduling.evidence.map(e => [e.record, e.value]).sort(), [[h.interviewA.id, 48], [h.interviewB.id, 72]].sort())
  const events = (await h.state(h.manager)).applications.find(a => a.id === h.appA.id).history
  assert.ok(events.some(e => e.id === source.evidence.find(r => r.application === h.appA.id).event && e.at === source.evidence.find(r => r.application === h.appA.id).relatedAt))
  const edited = h.query('source_conversion', { jobs: [h.job.id], sources: ['Referral'], chart: 'table' }), edit = await preview(edited)
  assert.deepEqual([edit.total.numerator, edit.total.denominator, edit.total.value], [1, 2, 50])
  const saved = await h.send(api + '/save', { title: 'Referral conversion', query: edited }, h.manager)
  assert.equal(saved.status, 201, saved.text)
  await h.restart()
  const reopened = await h.send(api + '/saved/' + saved.value.chart.id, undefined, h.manager)
  assert.equal(reopened.status, 200); assert.deepEqual(reopened.value.result.total, edit.total)
  assert.equal((await h.send(api + '/saved/' + saved.value.chart.id, undefined, h.owner)).status, 404, 'saved definitions belong to the operator')
  const stages = await preview(h.query('stage_moves')), offers = await preview(h.query('offer_outcomes'))
  assert.equal(stages.total.value, 1); assert.equal(stages.evidence[0].event, events.find(e => e.from !== null).id)
  assert.equal(offers.total.value, 1); assert.deepEqual(offers.evidence.map(e => [e.record, e.outcome]), [[h.offer.id, 'declined']])
  assert.ok(!JSON.stringify(offers).includes('9500000'))
  for (const [question, expected] of [['Show last-quarter stage moves', stages], ['Show last-quarter offer outcomes', offers]]) { const generated = await ask(question); assert.equal(generated.status, 200, generated.text); assert.deepEqual(generated.value.results[0].total, expected.total) }
  const count = h.edge.calls
  for (const question of ['Show private interview notes', 'Show monitoring answers by race', 'Rank candidate decisions']) {
    const refused = await ask(question); assert.equal(refused.status, 400); assert.ok(!refused.text.includes('synthetic-lodge-private-interview-93'))
  }
  assert.equal(h.edge.calls, count, 'restricted questions are refused before any provider request')
  for (const mode of ['protected-field', 'expression', 'unknown-metric', 'refusal']) {
    h.edge.mode = mode; const refused = await ask(); assert.equal(refused.status, 400, refused.text); assert.ok(!refused.text.includes('synthetic-lodge-private-expression-92'))
  }
  h.edge.mode = 'provider-failure'; const failed = await ask(); assert.equal(failed.status, 503); assert.ok(!failed.text.includes('synthetic-lodge-upstream-private-91')); assert.equal(h.edge.calls, count + 5, 'one paid attempt per request, no retries')
  for (const body of h.edge.requests) {
    const serialized = JSON.stringify(body)
    for (const forbidden of ['synthetic-lodge-private-interview-93', 'synthetic-lodge-protected-adjustment-94', 'Synthetic analysis alpha', 'Synthetic unseen analysis person', 'Synthetic restricted job', 'Synthetic unseen source', h.appA.id, h.hiddenApp.id, h.interviewA.candidateToken]) assert.ok(!serialized.includes(forbidden), 'model context excludes raw and inaccessible hiring evidence')
  }
  const stored = await h.db.prepare("SELECT value FROM l_records WHERE kind='analysis-chart'").all()
  assert.equal(stored.results.length, 1)
  for (const forbidden of [h.appA.id, h.appB.id, h.appBoundary.id, 'Synthetic analysis alpha', 'synthetic.analysis.alpha@example.test', 'synthetic-lodge-private-interview-93', h.interviewA.candidateToken, analysisQuestion]) assert.ok(!stored.results[0].value.includes(forbidden), 'saved definition excludes source evidence and the question')
  assert.equal(JSON.parse(stored.results[0].value).evidence, undefined, 'no evidence snapshot is saved')
  const audit = (await h.db.prepare("SELECT value FROM l_records WHERE kind='audit' AND json_extract(value,'$.action')='analysis-model-attempt'").all()).results.map(r => JSON.parse(r.value))
  assert.ok(audit.some(a => a.outcome === 'accepted' && a.usage.totalTokens === 650)); assert.ok(audit.some(a => a.outcome === 'failed')); assert.ok(audit.some(a => a.outcome === 'refused'))
  assert.ok(!JSON.stringify(audit).includes(analysisQuestion))
  assert.deepEqual((await h.state()).applications.map(a => [a.id, a.stage, a.status]), before, 'analysis never mutates candidate decisions')
  h.edge.mode = 'normal'
  const offerSaved = await h.send(api + '/save', { title: 'Scoped offer outcomes', query: h.query('offer_outcomes', { jobs: [h.job.id] }) }, h.manager)
  assert.equal(offerSaved.status, 201, offerSaved.text)
  const level = await h.command('permission-level', { name: 'Analysis without offers', permissions: ['move'] })
  await h.command('job-levels', { id: h.job.id, members: { 'analysis-manager@example.test': level.id }, roles: {} })
  const noOffers = await preview(h.query('offer_outcomes')); assert.equal(noOffers.total.value, 0); assert.ok(!JSON.stringify(noOffers).includes(h.offer.id))
  assert.equal((await h.send(api + '/saved/' + offerSaved.value.chart.id, undefined, h.manager)).status, 403)
  await h.command('job-levels', { id: h.job.id, members: {}, roles: {} })
  await h.command('move', { application: h.appBoundary.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Requested erasure' })
  const person = (await h.state()).applications.find(a => a.id === h.appBoundary.id).candidate
  const personRecord = (await h.state()).candidates.find(c => c.id === person)
  assert.equal((await h.send('/api/lodge/delete-candidate', { candidate: person, confirm: personRecord.name, reason: 'Requested erasure' }, h.owner)).status, 200)
  const erased = await h.send(api + '/saved/' + saved.value.chart.id, undefined, h.manager)
  assert.equal(erased.status, 200); assert.equal(erased.value.result.total.denominator, 1); assert.ok(!erased.text.includes(h.appBoundary.id))
  await h.command('hiring-team', { id: h.job.id, hiringManagers: ['owner@example.test'], coordinators: [], recruiters: [] })
  assert.equal((await h.send(api + '/saved/' + saved.value.chart.id, undefined, h.manager)).status, 404)
  assert.equal((await h.send(api + '/preview', { query: edited }, h.manager)).status, 404)
  const lost = await h.send(api, undefined, h.manager); assert.ok(!lost.text.includes(h.job.id))
}
