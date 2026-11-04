import assert from 'node:assert/strict'
import { businessHarness } from './harness.mjs'
import { RANGE, RUBRIC } from './hiring-fixture.mjs'
import { spanishText } from './languages-driver.mjs'

export const syntheticAddress = n => 'synthetic-lodge-' + n + String.fromCharCode(64) + 'example.test'
export const optionalForm = fields => { const form = new FormData(); for (const [key, value] of Object.entries(fields)) form.set(key, value); return form }
export function questionnaireInput(vacancy, kind = 'eeo', changes = {}) {
  return { vacancy, kind, language: 'en', version: 0, title: 'Synthetic voluntary ' + kind,
    notice: 'Synthetic employer-reviewed notice. Responses are optional, separate from selection and held for the reviewed period.',
    questions: [{ text: 'Synthetic voluntary response', options: ['Synthetic response one', 'Synthetic response two'] }],
    answerLabel: 'Answer', unansweredLabel: 'Leave unanswered', declineLabel: 'I decline to answer', consentLabel: 'I reviewed the voluntary notice and choose to provide these responses',
    retentionDays: 365, reviewed: true,
    review: { legal: 'Synthetic counsel review recorded', applicability: 'Synthetic US employer scope confirmed for this questionnaire', notice: 'Exact notice reviewed', language: 'English content reviewed', retention: 'Keep for one year subject to legal holds' }, ...changes }
}
export async function selfIdentificationJob(run, ownerEmail, title = 'Synthetic self-identification role', manager = ownerEmail) {
  const office = await run('office', { name: 'Synthetic approved Denver office' })
  const draft = await run('vacancy', { title, officeId: office.id, location: 'Denver, CO', manager, headcount: 1, compensation: RANGE })
  await run('rubric', { id: draft.id, criteria: RUBRIC })
  await run('interview-plan', { id: draft.id, plan: [{ name: 'Work review', stageName: 'Interview' }] })
  const request = await run('request-vacancy-approval', { id: draft.id, approver: ownerEmail })
  await run('decide-approval', { id: request.id, version: request.version, decision: 'approved', reason: 'Reviewed headcount' })
  return run('publish', { id: draft.id })
}

/** All current collection doors, restricted custody and the unsafe lifecycle path use the real Worker and D1. */
export async function checkSelfIdentification() {
  let outbound = 0
  const h = await businessHarness({ outboundService: () => { outbound++; return new Response('unexpected outbound', { status: 502 }) } })
  try {
    const { command: run, send, state } = h, ownerEmail = (await state()).actor.email
    const managerEmail = syntheticAddress('manager'), complianceEmail = syntheticAddress('compliance')
    const manager = await h.member(managerEmail, ['manager']), compliance = await h.member(complianceEmail, ['compliance'])
    const agent = await h.member(syntheticAddress('agent'), [], 'Synthetic preparing agent', { agent: true, actsFor: ownerEmail })
    let job = await selfIdentificationJob(run, ownerEmail, undefined, managerEmail)
    await run('job-board', { token: 'synthetic-lodge', allowedOrigins: [h.origin] })
    const boardBase = '/api/board/v1/synthetic-lodge/jobs/' + job.id
    const fields = n => ({ name: 'Synthetic applicant ' + n, email: syntheticAddress(n), noticeVersion: '1', consent: 'yes' })
    const readResponses = async () => (await state()).selfIdentification.responses
    assert.equal((await send('/jobs/' + job.slug, optionalForm(fields('before-review')))).status, 200, 'missing optional review does not close applications')
    assert.deepEqual((await send(boardBase)).value.selfIdentification, [])
    assert.equal((await send('/api/lodge/command/self-identification-questionnaire', questionnaireInput(job.id, 'eeo', { reviewed: false }), h.owner)).status, 400)
    assert.equal((await send('/api/lodge/command/self-identification-questionnaire', questionnaireInput(job.id), manager)).status, 403)
    assert.equal((await send('/api/lodge/command/self-identification-questionnaire', questionnaireInput(job.id), agent)).status, 403)
    const configs = []
    for (const kind of ['eeo', 'disability', 'veteran']) configs.push(await run('self-identification-questionnaire', questionnaireInput(job.id, kind)))
    const detail = (await send(boardBase)).value
    assert.deepEqual(detail.selfIdentification.map(q => q.kind), ['eeo', 'disability', 'veteran'])
    assert.equal(JSON.stringify(detail).includes('Synthetic counsel'), false, 'internal review evidence is not public')
    const optional = (value = 'Synthetic response one', version = 1) => Object.fromEntries(configs.map(q => [q.id, { version, consent: true, answers: { q1: value } }]))
    const controls = (q, value = 'Synthetic response one', version = 1) => ({ ['sid-' + q.id + '-version']: String(version), ['sid-' + q.id + '-consent']: 'yes', ['sid-' + q.id + '-q1']: value })
    const htmlFields = value => Object.assign({}, ...configs.map(q => controls(q, value)))
    const hostedInput = { ...fields('hosted'), ...htmlFields(), submissionKey: 'synthetic-lodge-hosted-1' }
    const host = await send('/jobs/' + job.slug, optionalForm(hostedInput))
    assert.equal(host.status, 200, host.text)
    const receipt = host.text.match(/LDG-[A-F0-9]{8}/)[0]
    assert.equal((await send('/jobs/' + job.slug, optionalForm(hostedInput))).text.match(/LDG-[A-F0-9]{8}/)[0], receipt)
    const embed = await send('/embed/jobs/' + job.slug, optionalForm({ ...fields('embedded'), ...htmlFields('__declined__') }))
    assert.equal(embed.status, 200, embed.text)
    const apiInput = { ...fields('board'), selfIdentification: optional() }
    const submitted = await send(boardBase + '/applications', apiInput, '', { 'idempotency-key': 'synthetic-lodge-board-1' })
    assert.equal(submitted.status, 201, submitted.text)
    assert.equal((await send(boardBase + '/applications', apiInput, '', { 'idempotency-key': 'synthetic-lodge-board-1' })).value.receipt, submitted.value.receipt)
    assert.equal((await send(boardBase + '/applications', fields('omitted'))).status, 201)
    const snapshot = await state(), hosted = snapshot.applications.find(a => a.candidateName === 'Synthetic applicant hosted'), embedded = snapshot.applications.find(a => a.candidateName === 'Synthetic applicant embedded'), apiApp = snapshot.receipts.find(r => r.id === submitted.value.receipt).application
    const responses = await readResponses()
    assert.equal(responses.length, 12)
    for (const r of responses) {
      const v = r.versions[0]
      assert.deepEqual([v.formVersion, v.noticeVersion, v.language, v.form.review.legal], [1, 1, 'en', 'Synthetic counsel review recorded'])
      assert.ok(v.retainUntil > v.at)
      assert.equal(v.state, r.application === embedded.id ? 'declined' : [hosted.id, apiApp].includes(r.application) ? 'answered' : 'unanswered')
      assert.equal(v.answers[0].state, v.state)
      assert.equal(v.intakePath, r.application === hosted.id ? 'Careers page' : r.application === embedded.id ? 'Careers page (embedded)' : 'Careers page (API)')
    }
    assert.equal(responses.every(r => r.versions.length === 1), true, 'replays add no answer version')
    assert.equal((await send(boardBase + '/applications', { ...fields('without-consent'), selfIdentification: { [configs[0].id]: { version: 1, consent: false, answers: { q1: 'Synthetic response one' } } } })).status, 400)
    const edited = await run('self-identification-questionnaire', questionnaireInput(job.id, 'eeo', { version: 1, notice: 'Synthetic second reviewed notice', questions: [{ text: 'Synthetic second question', options: ['Synthetic revised answer'] }] }))
    assert.equal((await send(boardBase + '/applications', { ...fields('stale'), selfIdentification: optional() })).status, 409)
    assert.equal((await send('/jobs/' + job.slug, optionalForm({ ...fields('stale-hosted'), ...htmlFields() }))).status, 409)
    assert.equal((await send(boardBase + '/applications', { ...fields('board'), selfIdentification: { [edited.id]: { version: 2, consent: true, answers: { q1: '__declined__' } } } })).status, 201)
    const revised = (await readResponses()).find(r => r.application === apiApp && r.questionnaire === edited.id)
    assert.deepEqual(revised.versions.map(v => [v.formVersion, v.noticeVersion, v.state]), [[1, 1, 'answered'], [2, 2, 'declined']])
    assert.equal(revised.versions[0].form.notice, configs[0].versions[0].notice)
    await run('self-identification-questionnaire', questionnaireInput(job.id, 'eeo', { version: 2, enabled: false }))
    assert.equal((await send(boardBase + '/applications', fields('disabled'))).status, 201, 'disabled review leaves application open')
    assert.equal((await send(boardBase)).value.selfIdentification.some(q => q.kind === 'eeo'), false)
    // A real translated post has no English questionnaire fallback.
    const office = { id: job.officeId }
    job = await run('job-post', { vacancy: job.id, title: 'Synthetic translated role', description: 'Trabajo seguro.', language: 'es', locations: [office.id], destinations: ['careers', 'api', 'embed'], translation: { ...spanishText({ id: 'unused' }), questions: {} } })
    const post = job.posts.at(-1)
    await run('post-status', { vacancy: job.id, post: post.id, status: 'live' })
    assert.deepEqual((await send('/api/board/v1/synthetic-lodge/jobs/' + post.id)).value.selfIdentification, [])
    assert.equal((await send('/jobs/' + post.slug)).text.includes('sid-'), false)
    assert.equal((await send('/jobs/' + post.slug, optionalForm(fields('spanish-no-review')))).status, 200)
    assert.equal((await send('/api/board/v1/synthetic-lodge/jobs/' + post.id + '/applications', { ...fields('wrong-language'), selfIdentification: optional() })).status, 409)
    assert.equal((await state(manager)).selfIdentification.responses.length, 0)
    assert.equal((await state(agent)).selfIdentification.responses.length, 0)
    assert.equal((await send('/api/lodge/search?q=Synthetic%20response%20one', undefined, h.owner)).value.results.length, 0)
    assert.equal((await send('/api/lodge/download/vacancy/' + job.id, undefined, manager)).text.includes('Synthetic response one'), false)
    await run('vacancy-compliance', { id: job.id, people: [complianceEmail] })
    assert.ok((await state(compliance)).selfIdentification.responses.some(r => r.application === hosted.id))
    const complianceView = await state(compliance)
    assert.equal(complianceView.applications.length, 0, 'the old restricted grant does not acquire selection records')
    const page = await send('/enterprise/compliance', undefined, compliance)
    assert.match(page.text, /Synthetic response one/)
    const exported = await send('/api/lodge/download/candidate/' + hosted.candidate, undefined, h.owner)
    assert.deepEqual(exported.value['self-id-response'].map(r => r.versions[0].state), ['answered', 'answered', 'answered'])
    const beforeHiring = (await state()).applications.find(a => a.id === hosted.id)
    assert.equal(beforeHiring.status, 'active'); assert.equal(beforeHiring.stage, hosted.stage)
    assert.deepEqual(beforeHiring.answers ?? [], [])
    assert.equal(JSON.stringify(beforeHiring).includes('Synthetic response one'), false)
    assert.equal((await state()).scorecards.length, 0)
    await run('vacancy-compliance', { id: job.id, people: [] })
    assert.equal((await state(compliance)).selfIdentification.responses.length, 0)
    assert.equal((await send('/enterprise/compliance', undefined, compliance)).text.includes('Synthetic response one'), false)
    await run('member', { email: complianceEmail, name: 'Synthetic compliance', roles: ['compliance'], active: false })
    assert.equal((await send('/api/lodge/state', undefined, compliance)).status, 403)
    const hold = await run('hold', { candidate: hosted.candidate, reason: 'Synthetic preservation hold' })
    await run('move', { application: hosted.id, to: 'withdrawn', closeReason: 'pay', reason: 'Candidate withdrew' })
    const deletion = { candidate: hosted.candidate, confirm: 'Synthetic applicant hosted', reason: 'Synthetic verified erasure request' }
    assert.equal((await send('/api/lodge/delete-candidate', deletion, h.owner)).status, 409)
    assert.equal((await readResponses()).filter(r => r.application === hosted.id).length, 3)
    await run('release-hold', { id: hold.id, reason: 'Synthetic hold ended' })
    assert.equal((await send('/api/lodge/delete-candidate', deletion, h.owner)).status, 200)
    assert.equal((await readResponses()).some(r => r.application === hosted.id), false)
    assert.equal((await send('/api/lodge/download/candidate/' + hosted.candidate, undefined, h.owner)).status, 404)
    assert.equal((await send('/api/lodge/search?q=Synthetic%20response%20one', undefined, h.owner)).value.results.length, 0)
    await h.restart()
    assert.equal((await readResponses()).some(r => r.application === hosted.id), false)
    assert.equal(outbound, 0)
    console.log('PROBE REPORT-002 intake: hosted, embedded and board applications -> separate versioned answers, decline and omission; replay unchanged')
    console.log('PROBE REPORT-002 review: stale version, missing review and reviewed-language limits -> stale refused; valid application without optional review accepted')
    console.log('PROBE REPORT-002 custody: live restricted job grant then revocation -> read allowed then hidden; selection, search and agent views unchanged')
    console.log('PROBE REPORT-002 lifecycle: held erasure -> refused unchanged; released erasure -> all linked responses removed across restart')
  } finally { await h.close() }
}
