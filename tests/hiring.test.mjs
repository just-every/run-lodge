// One vacancy from approval to an offer decision, through Lodge's real HTTP
// routes, sessions and D1. Each subtest proves one CONTRACT.md clause.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BUSINESS, harness } from './harness.mjs'
import { checkMerge } from './merge-flow.mjs'
import { checkErasure } from './retention-flow.mjs'
import { createHash } from 'node:crypto'

const RANGE = { currency: 'USD', min: 9000000, max: 11000000, period: 'year' }
const RUBRIC = [{ name: 'Site safety', description: 'Describes how they ran safety on a past site' }, { name: 'Scheduling', description: 'Explains a schedule they recovered' }]
const b64 = text => Buffer.from(text).toString('base64')

test('Lodge hiring flows through native sessions and real D1', async t => {
  const h = await harness()
  t.after(() => h.close())
  const { command: cmd, send, state, owner } = h
  let manager, approver, ivy, ian, vacancy, publicApp, staffApp, staffCandidate, slug, carpenter, declineTemplate

  await cmd('business', BUSINESS)
  manager = await h.member('morgan@example.test', ['manager'], 'Morgan Lee')
  approver = await h.member('parker@example.test', ['approver'], 'Parker Jones')
  ivy = await h.member('ivy@example.test', ['interviewer'], 'Ivy Chen')
  ian = await h.member('ian@example.test', ['interviewer'], 'Ian Ruiz')

  const approve = async (id, cookie = approver) => {
    const v = (await state(cookie)).approvals.find(x => x.id === id)
    return cmd('decide-approval', { id, decision: 'approved', reason: 'Within budget', version: v.currentVersion }, cookie)
  }

  await t.test('LDG-001 vacancy terms need a headcount approval that matches them exactly', async () => {
    vacancy = await cmd('vacancy', { title: 'Site supervisor', department: 'Operations', location: 'Brooklyn, NY', headcount: 1, manager: 'morgan@example.test' }, manager)
    const refused = await send('/api/lodge/command/request-vacancy-approval', { id: vacancy.id, approver: 'parker@example.test' }, manager)
    assert.equal(refused.status, 409)
    assert.match(refused.value.error, /compensation range/)
    await cmd('vacancy', { ...vacancy, compensation: RANGE }, manager)
    await cmd('rubric', { id: vacancy.id, criteria: RUBRIC }, manager)
    const v = (await state(manager)).vacancies.find(x => x.id === vacancy.id)
    await cmd('interview-plan', { id: vacancy.id, plan: [{ name: 'Site walk', stage: v.stages[2].id, durationMinutes: 60, criteria: v.rubrics[0].criteria.map(c => c.id) }] }, manager)
    const request = await cmd('request-vacancy-approval', { id: vacancy.id, approver: 'parker@example.test' }, manager)
    // The terms change after the request: the approver's decision on the old version is refused.
    await cmd('vacancy', { ...v, description: 'Run two residential sites.' }, manager)
    const stale = await send('/api/lodge/command/decide-approval', { id: request.id, decision: 'approved', reason: 'ok', version: request.version }, approver)
    assert.equal(stale.status, 409)
    await approve((await cmd('request-vacancy-approval', { id: vacancy.id, approver: 'parker@example.test' }, manager)).id)
    // Raising headcount after approval makes the approval stale again: publishing is refused.
    const current = (await state(manager)).vacancies.find(x => x.id === vacancy.id)
    assert.equal(current.approvedNow, true)
    await cmd('vacancy', { ...current, headcount: 2 }, manager)
    assert.equal((await send('/api/lodge/command/publish', { id: vacancy.id }, manager)).status, 409)
    await cmd('vacancy', { ...current, headcount: 1 }, manager)
    assert.equal((await state(manager)).vacancies.find(x => x.id === vacancy.id).approvedNow, true, 'the approved terms are current again')
    vacancy = await cmd('publish', { id: vacancy.id }, manager)
    slug = vacancy.slug
  })

  await t.test('LDG-002 stages, rubric and plan are agreed before evaluation and stay fixed while published', async () => {
    assert.equal((await send('/api/lodge/command/rubric', { id: vacancy.id, criteria: [{ name: 'New', description: 'Changed after publishing' }] }, manager)).status, 409)
    const draft = await cmd('vacancy', { title: 'Estimator', location: 'Remote', manager: 'morgan@example.test' }, manager)
    const noRubric = await send('/api/lodge/command/interview-plan', { id: draft.id, plan: [{ name: 'Call', stage: draft.stages[1].id }] }, manager)
    assert.equal(noRubric.status, 409)
    assert.match(noRubric.value.error, /rubric/)
    assert.equal((await send('/api/lodge/command/publish', { id: draft.id }, manager)).status, 409)
    const two = await cmd('rubric', { id: draft.id, criteria: RUBRIC }, manager)
    const three = await cmd('rubric', { id: draft.id, criteria: [RUBRIC[0]] }, manager)
    assert.deepEqual([two.rubrics.length, three.rubrics.at(-1).version], [1, 2], 'each rubric change is a new version')
  })

  await t.test('LDG-003 the accessible application page records the notice version and returns a receipt', async () => {
    const list = await send('/jobs')
    assert.match(list.text, new RegExp(`/jobs/${slug}`))
    const page = await send('/jobs/' + slug)
    assert.equal(page.status, 200)
    assert.match(page.text, /<label>Full name<input name="name"/)
    assert.match(page.text, /adjustments@example\.test/)
    assert.match(page.text, /name="noticeVersion" value="1"/)
    const form = (fields, file) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); if (file) f.append('resume', new Blob([file], { type: 'text/plain' }), 'resume.txt'); return f }
    const fields = { name: 'Dana Whitfield', email: 'dana@example.test', phone: '+1 555 0100', noticeVersion: '1', consent: 'yes', talentPool: 'yes', accommodation: 'I need step-free access.', monitoring: 'Woman', coverNote: 'Ran two sites in Queens.' }
    const unconfirmed = await send('/jobs/' + slug, form({ ...fields, consent: '' }))
    assert.equal(unconfirmed.status, 400, unconfirmed.text.slice(0, 600))
    // A changed notice is never silently accepted for a page showing the old one.
    await cmd('business', { ...BUSINESS, privacyNotice: BUSINESS.privacyNotice + ' We do not sell data.' })
    const stale = await send('/jobs/' + slug, form(fields))
    assert.equal(stale.status, 409)
    assert.equal((await send('/jobs/' + slug, form({ ...fields, noticeVersion: '2' }), '', { origin: 'https://elsewhere.example' })).status, 403)
    const received = await send('/jobs/' + slug, form({ ...fields, noticeVersion: '2' }, 'Dana Whitfield resume\nSite supervisor 2019-2026\n'))
    assert.equal(received.status, 200, received.text)
    const code = received.text.match(/LDG-[0-9A-F]{8}/)[0]
    // The receipt states its time in the business's own zone, not the server's.
    assert.match(received.text, /\d{1,2}:\d\d [ap]\.m\. E[SD]T</)
    const s = await state()
    publicApp = s.applications.find(a => a.candidateName === 'Dana Whitfield')
    const receipt = (await h.db.prepare("SELECT value FROM l_records WHERE kind='receipt' AND id=?").bind(code).first()).value
    assert.equal(JSON.parse(receipt).noticeVersion, 2)
    assert.equal(s.candidates.find(c => c.id === publicApp.candidate).consent.noticeVersion, 2)
    assert.equal((await send('/jobs/not-a-role')).status, 404)
  })

  await t.test('LDG-004 staff add candidates with source, consent basis, retention and original file bytes', async () => {
    assert.equal((await send('/api/lodge/command/candidate', { name: 'X', source: 'Referral', consentBasis: 'guess', vacancy: vacancy.id }, manager)).status, 400)
    const added = await cmd('candidate', { name: 'Sam Okafor', email: 'sam@example.test', phone: '+1 555 0123', source: 'Referral from Ivy', consentBasis: 'referral', consentNote: 'Agreed by phone 9 Oct', vacancy: vacancy.id, resume: { name: 'sam.pdf', mediaType: 'application/pdf', base64: b64('%PDF-1.4 Sam Okafor resume') } }, manager)
    staffApp = added.application; staffCandidate = added.candidate
    const s = await state()
    const c = s.candidates.find(x => x.id === staffCandidate.id)
    assert.equal(c.consent.basis, 'referral')
    assert.equal(c.source, 'Referral from Ivy')
    assert.match(c.retainUntil, /^\d{4}-\d{2}-\d{2}$/)
    const doc = s.documents.find(d => d.candidate === c.id)
    const download = await send('/api/lodge/download/document/' + doc.id, undefined, manager)
    assert.equal(download.text, '%PDF-1.4 Sam Okafor resume')
    const big = await send('/api/lodge/command/document', { application: staffApp.id, name: 'big.bin', base64: Buffer.alloc(1_000_001).toString('base64') }, manager)
    assert.equal(big.status, 413)
    await cmd('document', { application: staffApp.id, name: 'i9.pdf', kind: 'right-to-work', base64: b64('restricted identity paper') }, manager)
  })

  await t.test('LDG-005 one person, several applications; duplicates are reviewed, never merged automatically', async () => {
    const estimator = await cmd('vacancy', { title: 'Estimator', location: 'Remote', headcount: 1, compensation: RANGE, manager: 'morgan@example.test' }, manager)
    const v = await cmd('rubric', { id: estimator.id, criteria: RUBRIC }, manager)
    await cmd('interview-plan', { id: v.id, plan: [{ name: 'Call', stage: v.stages[1].id }] }, manager)
    await approve((await cmd('request-vacancy-approval', { id: v.id, approver: 'parker@example.test' }, manager)).id)
    await cmd('publish', { id: v.id }, manager)
    await cmd('apply', { candidate: staffCandidate.id, vacancy: v.id, source: 'Also suits estimating' }, manager)
    assert.equal((await send('/api/lodge/command/apply', { candidate: staffCandidate.id, vacancy: v.id, source: 'again' }, manager)).status, 409)
    let s = await state()
    assert.equal(s.applications.filter(a => a.candidate === staffCandidate.id).length, 2)
    const twin = await cmd('candidate', { name: 'Sam Okafor', email: 'SAM@example.test', source: 'Job fair', consentBasis: 'application' })
    s = await state()
    assert.ok(s.candidates.some(c => c.id === twin.candidate.id), 'both records remain until a person decides')
    const pair = s.duplicates.find(d => [d.first, d.second].includes(twin.candidate.id))
    assert.deepEqual(pair.reasons, ['same email', 'same name'])
    await cmd('review-duplicate', { keep: staffCandidate.id, other: twin.candidate.id, decision: 'merge', reason: 'Same person, same email' })
    s = await state()
    assert.ok(!s.candidates.some(c => c.id === twin.candidate.id))
    assert.equal(s.duplicates.length, 0)
    await checkMerge(h, vacancy, v)
  })

  await t.test('LDG-006 an interviewer reaches only assigned applications, through every door', async () => {
    await cmd('assign-reviewers', { application: publicApp.id, reviewers: ['ivy@example.test', 'ian@example.test'] }, manager)
    const s = await state(ivy)
    assert.deepEqual(s.applications.map(a => a.id), [publicApp.id])
    const dana = s.candidates.find(c => c.id === publicApp.candidate)
    assert.equal(dana.email, undefined, 'no contact details for interviewers')
    assert.equal(s.restricted.length, 0, 'no accommodation or monitoring answers')
    assert.ok(s.documents.every(d => !d.restricted))
    assert.ok(!JSON.stringify(s).includes('Sam Okafor'))
    assert.ok(!JSON.stringify(s).includes('step-free'))
    const samDoc = (await state()).documents.find(d => d.candidate === staffCandidate.id && d.kind === 'resume')
    assert.equal((await send('/api/lodge/download/document/' + samDoc.id, undefined, ivy)).status, 404)
    assert.deepEqual((await send('/api/lodge/search?q=okafor', undefined, ivy)).value.results, [])
    assert.equal((await send('/api/lodge/download/vacancy/' + vacancy.id, undefined, ivy)).status, 404)
    assert.equal((await send('/api/lodge/download/candidate/' + staffCandidate.id, undefined, ivy)).status, 403)
    const agent = await send('/api/lodge/command/propose', { workflow: 'feedback-packet', summary: 'x', sources: [{ kind: 'application', id: staffApp.id }], changes: [{ op: 'scorecard', input: { application: staffApp.id } }] }, ivy)
    assert.equal(agent.status, 404, 'agent tools see no more than the person')
    // A manager's export of the whole vacancy leaves restricted material out; the owner's includes it.
    const managed = (await send('/api/lodge/download/vacancy/' + vacancy.id, undefined, manager)).value
    assert.equal(managed.restricted.length, 0)
    assert.ok(managed.documents.every(d => !d.restricted))
    const full = (await send('/api/lodge/download/vacancy/' + vacancy.id, undefined, owner)).value
    assert.equal(full.restricted.length, 2)
    assert.ok(full.documents.some(d => d.restricted))
  })

  await t.test('LDG-007 stage moves keep reason, actor and time; concurrent moves cannot both win', async () => {
    const v = (await state(manager)).vacancies.find(x => x.id === vacancy.id)
    assert.equal((await send('/api/lodge/command/move', { application: publicApp.id, to: v.stages[1].id }, manager)).status, 400)
    assert.equal((await send('/api/lodge/command/move', { application: publicApp.id, to: v.stages[1].id, reason: 'x' }, ivy)).status, 403)
    // Fire moves concurrently. Whatever interleaving happens, every committed move must start
    // from the stage the previous committed move ended in: no two moves from one state both win.
    const targets = [v.stages[1].id, v.stages[2].id, v.stages[3].id, v.stages[2].id]
    const results = await Promise.all(targets.map(to => send('/api/lodge/command/move', { application: publicApp.id, to, reason: 'Strong site experience' }, manager)))
    assert.ok(results.every(r => [200, 409].includes(r.status)), JSON.stringify(results.map(r => r.value)))
    const app = (await state(manager)).applications.find(a => a.id === publicApp.id)
    assert.equal(app.history.length, 1 + results.filter(r => r.status === 200).length, 'one history event per committed move')
    for (let i = 1; i < app.history.length; i++) assert.equal(app.history[i].from, app.history[i - 1].to, 'an unbroken chain of stages')
    assert.equal(app.stage, app.history.at(-1).to)
    const last = app.history.at(-1)
    assert.equal(last.actor, 'morgan@example.test')
    assert.equal(last.reason, 'Strong site experience')
    if (app.stage !== v.stages[2].id) await cmd('move', { application: publicApp.id, to: v.stages[2].id, reason: 'Ready for the site walk' }, manager)
  })

  let interview
  await t.test('LDG-008 interviews collect panel and candidate availability and download as calendar files', async () => {
    const v = (await state(manager)).vacancies.find(x => x.id === vacancy.id)
    const slots = ['2026-11-03T15:00:00.000Z', '2026-11-04T15:00:00.000Z']
    interview = await cmd('interview', { application: publicApp.id, planItem: v.plan[0].id, participants: ['ivy@example.test'], slots, location: '12 Pier St, Brooklyn', timezone: 'America/New_York' }, manager)
    assert.equal((await state(ivy)).interviews[0].candidateToken, undefined, 'the candidate link is for the hiring team only')
    await cmd('availability', { interview: interview.id, slots: [1] }, ivy)
    assert.equal((await send('/api/lodge/command/availability', { interview: interview.id, slots: [0] }, ian)).status, 403)
    const token = (await state(manager)).interviews.find(i => i.id === interview.id).candidateToken
    const page = await send('/availability/' + token)
    assert.match(page.text, /Choose times that work for you/)
    const pick = new FormData(); pick.append('slot', '1')
    assert.equal((await send('/availability/' + token, pick)).status, 200)
    const proposed = (await state(manager)).coordination.awaitingTimes.find(x => x.interview === interview.id)
    assert.equal(proposed.best[0].index, 1)
    assert.equal((await send('/api/lodge/download/calendar/' + interview.id, undefined, manager)).status, 409)
    assert.equal((await send('/api/lodge/download/calendar/' + interview.id, undefined, ivy)).status, 409)
    await cmd('schedule', { interview: interview.id, slot: 1 }, manager)
    const managedCalendar = await send('/api/lodge/download/calendar/' + interview.id, undefined, manager)
    assert.equal(managedCalendar.status, 200)
    assert.match(managedCalendar.text, /DTSTART:20261104T150000Z/)
    const ics = await send('/api/lodge/download/calendar/' + interview.id, undefined, ivy)
    assert.equal(ics.headers.get('content-type'), 'text/calendar; charset=utf-8')
    assert.match(ics.text, /DTSTART:20261104T150000Z/)
    assert.match(ics.text, /ATTENDEE;ROLE=REQ-PARTICIPANT:mailto:ivy@example.test/)
    assert.equal((await send('/api/lodge/download/calendar/' + interview.id, undefined, approver)).status, 404)
    // A panellist says they cannot attend, in their own words; someone off the panel offers to cover. Nothing moves.
    const reply = body => send('/api/lodge/command/interview-reply', { interview: interview.id, ...body }, ivy)
    assert.equal((await reply({ answer: 'can-cover', note: 'I am on it already' })).status, 403)
    await cmd('interview-reply', { interview: interview.id, answer: 'cannot-attend', note: 'Fever, sorry!' }, ivy)
    assert.equal((await send('/api/lodge/command/interview-reply', { interview: interview.id, answer: 'cannot-attend' }, manager)).status, 403)
    await cmd('interview-reply', { interview: interview.id, answer: 'can-cover', freeAt: '2026-11-04T19:00:00.000Z', note: 'Free that afternoon' }, manager)
    const replied = (await state(manager)).interviews.find(i => i.id === interview.id)
    assert.deepEqual(replied.replies.map(r => [r.by, r.answer, r.note]), [['ivy@example.test', 'cannot-attend', 'Fever, sorry!'], ['morgan@example.test', 'can-cover', 'Free that afternoon']])
    assert.equal(replied.status, 'scheduled')
    assert.ok((await state()).audit.some(e => e.action === 'interview-reply' && e.answer === 'cannot-attend' && e.note === 'Fever, sorry!'))
  })

  await t.test('LDG-009 scorecards are independent until the manager releases feedback', async () => {
    const v = (await state(manager)).vacancies.find(x => x.id === vacancy.id), [safety, scheduling] = v.rubrics[0].criteria
    const unsupported = await send('/api/lodge/command/scorecard', { application: publicApp.id, ratings: { [safety.id]: 4 }, evidence: {}, recommendation: 'yes', submit: true }, ivy)
    assert.equal(unsupported.status, 400)
    await cmd('scorecard', { application: publicApp.id, ratings: { [safety.id]: 4, [scheduling.id]: null }, evidence: { [safety.id]: 'Walked through her daily toolbox talks' }, recommendation: 'strong-yes', takeaways: 'Runs a safe site', submit: true, author: 'parker@example.test' }, ivy)
    assert.equal((await send('/api/lodge/command/scorecard', { application: publicApp.id, ratings: {}, evidence: {} }, ivy)).status, 409, 'submitted scorecards are final')
    const mine = (await state(ivy)).scorecards
    assert.equal(mine.length, 1)
    assert.equal(mine[0].author, 'ivy@example.test', 'the author is the session, not the request body')
    assert.equal(mine[0].ratings[scheduling.id], null, 'unrated stays unanswered')
    assert.equal((await state(ian)).scorecards.length, 0, 'colleagues cannot see it yet')
    assert.equal((await state(manager)).scorecards.length, 0, 'nor can the manager read its content')
    assert.equal((await send('/api/lodge/command/release-feedback', { application: publicApp.id }, manager)).status, 400, 'Ian has not submitted, so early release needs a reason')
    await cmd('release-feedback', { application: publicApp.id, reason: 'Decision meeting today' }, manager)
    assert.equal((await state(ian)).scorecards[0].recommendation, 'strong-yes')
  })

  await t.test('SCORE-001 recommendations and take-aways stay blind until release, then summarize by interview', async () => {
    const una = await h.member('una@example.test', ['interviewer'], 'Una Diaz')
    const ivyAgent = await h.member('ivy-agent@example.test', [], 'Ivy’s coding agent', { agent: true, actsFor: 'ivy@example.test' })
    const { application: app } = await cmd('candidate', { name: 'Kai Moreno', email: 'kai@example.test', source: 'Job board', consentBasis: 'application', vacancy: vacancy.id }, manager)
    await cmd('assign-reviewers', { application: app.id, reviewers: ['ivy@example.test', 'ian@example.test'] }, manager)
    const [safety] = (await state(manager)).vacancies.find(x => x.id === vacancy.id).rubrics[0].criteria
    const card = (recommendation, takeaways, rating) => ({ application: app.id, ratings: { [safety.id]: rating }, evidence: { [safety.id]: 'Explained a lockout procedure' }, recommendation, takeaways, submit: true })
    const missing = await send('/api/lodge/command/scorecard', card('yes', '', 3), ivy)
    assert.equal(missing.status, 400)
    assert.match(missing.value.error, /take-aways/)
    await cmd('scorecard', card('strong-yes', 'IVY-TAKEAWAY a clear safety leader', 4), ivy)
    await cmd('scorecard', card('no', 'IAN-TAKEAWAY thin on scheduling', 2), ian)
    // Before release each reader learns only who has submitted, through state, search, export and an agent read.
    for (const [who, hidden] of [[ivy, 'IAN-TAKEAWAY'], [ivyAgent, 'IAN-TAKEAWAY'], [ian, 'IVY-TAKEAWAY'], [manager, 'TAKEAWAY']]) {
      const s = await state(who)
      assert.ok(!JSON.stringify(s).includes(hidden))
      const summary = s.applications.find(a => a.id === app.id).scorecardSummary
      assert.deepEqual([summary.released, summary.counts, summary.panel.map(p => p.submitted)], [false, undefined, [true, true]])
      assert.deepEqual((await send('/api/lodge/search?q=TAKEAWAY', undefined, who)).value.results, [])
    }
    const othersCard = (await state(ivy)).scorecards.filter(c => c.application === app.id && c.author !== 'ivy@example.test')
    assert.deepEqual(othersCard, [], 'no colleague recommendation before release')
    assert.ok(!(await send('/api/lodge/download/vacancy/' + vacancy.id, undefined, manager)).text.includes('TAKEAWAY'))
    await cmd('release-feedback', { application: app.id }, manager)
    for (const who of [manager, ivy, ivyAgent, ian]) {
      const summary = (await state(who)).applications.find(a => a.id === app.id).scorecardSummary
      assert.equal(summary.released, true)
      assert.deepEqual(summary.counts, { 'strong-no': 0, no: 1, yes: 0, 'strong-yes': 1 })
      assert.deepEqual(summary.waiting, [])
      assert.deepEqual(summary.interviews.map(i => i.title), ['Application review'])
      assert.deepEqual(summary.interviews[0].cards.map(c => [c.author, c.recommendation, c.takeaways, c.ratings[safety.id]]).sort(), [['ian@example.test', 'no', 'IAN-TAKEAWAY thin on scheduling', 2], ['ivy@example.test', 'strong-yes', 'IVY-TAKEAWAY a clear safety leader', 4]])
    }
    const exported = (await send('/api/lodge/download/vacancy/' + vacancy.id, undefined, manager)).value
    assert.equal(exported.applications.find(a => a.id === app.id).scorecardSummary.counts.no, 1)
    // An interviewer outside the panel still reads nothing of it.
    const outside = await state(una)
    assert.ok(!JSON.stringify(outside).includes('TAKEAWAY'))
    assert.equal(outside.applications.some(a => a.id === app.id), false)
    await cmd('move', { application: app.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Took another role' }, manager)
  })

  let message
  await t.test('LDG-010 messages are approved as exact text and downloaded, never sent', async () => {
    message = await cmd('message', { application: publicApp.id, purpose: 'interview-invitation', subject: 'Site walk on 4 November', body: 'Hi Dana,\nWe look forward to the site walk.' }, manager)
    assert.equal((await send('/api/lodge/download/message/' + message.id, undefined, manager)).status, 409)
    assert.equal((await send('/api/lodge/command/request-message-approval', { id: message.id, approver: 'ivy@example.test' }, manager)).status, 400, 'approvers must hold the role')
    const own = await cmd('request-message-approval', { id: message.id, approver: 'morgan@example.test' }, manager)
    assert.equal((await send('/api/lodge/command/decide-approval', { id: own.id, decision: 'approved', reason: 'mine', version: own.version }, manager)).status, 403, 'no approving your own request')
    const owners = (await state()).members.find(m => m.owner).email
    const r = await cmd('request-message-approval', { id: message.id, approver: owners }, manager)
    await approve(r.id, owner)
    const eml = await send('/api/lodge/download/message/' + message.id, undefined, manager)
    assert.equal(eml.status, 200)
    assert.match(eml.text, /^From: Example Builders <morgan@example.test>\r\nTo: dana@example.test\r\nSubject: Site walk on 4 November\r\nX-Unsent: 1/)
    assert.match(Buffer.from(eml.text.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString(), /We look forward/)
    await cmd('message', { id: message.id, application: publicApp.id, purpose: 'interview-invitation', subject: 'Site walk on 5 November', body: 'Changed' }, manager)
    assert.equal((await send('/api/lodge/download/message/' + message.id, undefined, manager)).status, 409, 'edited text needs approval again')
    assert.ok((await state()).audit.some(e => e.action === 'message-downloaded'))
  })

  await t.test('LDG-011 an offer is approved on exact terms, its outcome recorded and handed to HR', async () => {
    const [opening] = (await state(manager)).vacancies.find(v => v.id === vacancy.id).openings
    let offer = await cmd('offer', { application: publicApp.id, title: 'Site supervisor', startDate: '2026-12-01', salary: { currency: 'USD', amount: 11500000, period: 'year' }, terms: 'Truck allowance', opening: opening.id }, manager)
    let packet = (await send('/api/lodge/download/packet/' + offer.id, undefined, manager)).value
    assert.equal(packet.rangeWarning, 'Outside the approved range')
    assert.equal(packet.scorecards.length, 1)
    assert.equal((await send('/api/lodge/download/handoff/' + offer.id, undefined, manager)).status, 409)
    const request = await cmd('request-offer-approval', { id: offer.id, approver: 'parker@example.test' }, manager)
    // The person asked to approve reads the same packet, warning included, though they see nothing else of the application.
    packet = (await send('/api/lodge/download/packet/' + offer.id, undefined, approver)).value
    assert.equal(packet.rangeWarning, 'Outside the approved range')
    assert.equal(packet.scorecards.length, 1)
    await approve(request.id)
    // Editing pay after approval makes the approval stale: the outcome cannot be recorded.
    offer = await cmd('offer', { ...offer, salary: { currency: 'USD', amount: 10800000, period: 'year' } }, manager)
    assert.equal((await send('/api/lodge/command/offer-outcome', { id: offer.id, outcome: 'accepted', reason: 'Signed' }, manager)).status, 409)
    await approve((await cmd('request-offer-approval', { id: offer.id, approver: 'parker@example.test' }, manager)).id)
    await cmd('offer-outcome', { id: offer.id, outcome: 'accepted', reason: 'Accepted by phone' }, manager)
    const s = await state(manager)
    assert.equal(s.applications.find(a => a.id === publicApp.id).status, 'hired')
    assert.equal(s.vacancies.find(v => v.id === vacancy.id).hires, 1)
    const handoff = (await send('/api/lodge/download/handoff/' + offer.id, undefined, manager)).value
    assert.equal(handoff.person.email, 'dana@example.test')
    assert.deepEqual(handoff.pay, { currency: 'USD', amount: 10800000, period: 'year' })
    // A closed application keeps its close: its approved offer can be withdrawn, never accepted.
    const closed = (await cmd('candidate', { name: 'Riley Park', email: 'riley@example.test', source: 'Referral', consentBasis: 'referral', vacancy: vacancy.id }, manager)).application
    const late = await cmd('offer', { application: closed.id, title: 'Site supervisor', startDate: '2026-12-01', salary: { currency: 'USD', amount: 10800000, period: 'year' } }, manager)
    await approve((await cmd('request-offer-approval', { id: late.id, approver: 'parker@example.test' }, manager)).id)
    await cmd('move', { application: closed.id, to: 'rejected', closeReason: 'skills', reason: 'Not progressing' }, manager)
    assert.equal((await send('/api/lodge/command/offer-outcome', { id: late.id, outcome: 'accepted', reason: 'Signed' }, manager)).status, 409)
    await cmd('offer-outcome', { id: late.id, outcome: 'withdrawn', reason: 'Application closed' }, manager)
    const after = await state(manager)
    assert.equal(after.applications.find(a => a.id === closed.id).status, 'rejected')
    assert.equal(after.vacancies.find(v => v.id === vacancy.id).hires, 1)
  })

  await t.test('LDG-012 holds block deletion; deletion leaves a receipt; access requests export everything', async () => {
    const request = await cmd('data-request', { candidate: staffCandidate.id, type: 'access', channel: 'email' })
    const exported = await send(`/api/lodge/download/candidate/${staffCandidate.id}?request=${request.id}`, undefined, owner)
    assert.equal(exported.status, 200)
    assert.equal(exported.value.candidate.id, staffCandidate.id)
    assert.equal(exported.value.candidate.phone, staffCandidate.phone)
    assert.equal(exported.value.candidate.consent.note, staffCandidate.consent.note)
    assert.ok(exported.value.mergedCandidates.length > 0)
    const canonical = value => value === null || typeof value !== 'object' ? value : Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    assert.equal((await state()).dataRequests.find(r => r.id === request.id).exportDigest, createHash('sha256').update(JSON.stringify(canonical(exported.value))).digest('hex'))
    assert.equal(Buffer.from(exported.value.document.find(d => d.kind === 'resume').base64, 'base64').toString(), '%PDF-1.4 Sam Okafor resume')
    assert.equal(exported.value.application.length, 2, 'one person, both vacancies')
    assert.match((await state()).dataRequests.find(r => r.id === request.id).outcome, /sha256 [0-9a-f]{64}/)
    const hold = await cmd('hold', { candidate: staffCandidate.id, reason: 'Pending EEOC inquiry' })
    const del = body => send('/api/lodge/delete-candidate', { candidate: staffCandidate.id, reason: 'Asked to be forgotten', ...body }, owner)
    assert.equal((await del({ confirm: 'Sam Okafor' })).status, 409, 'a legal hold refuses deletion')
    await cmd('release-hold', { id: hold.id, reason: 'Inquiry closed' })
    assert.equal((await del({ confirm: 'Sam' })).status, 400)
    assert.equal((await del({ confirm: 'Sam Okafor' })).status, 409, 'active applications must be closed first')
    for (const app of (await state()).applications.filter(a => a.candidate === staffCandidate.id && a.status === 'active')) await cmd('move', { application: app.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Asked to withdraw' })
    const docIds = (await state()).documents.filter(d => d.candidate === staffCandidate.id).map(d => d.id)
    const receipt = await del({ confirm: 'Sam Okafor' })
    assert.equal(receipt.status, 200, JSON.stringify(receipt.value))
    assert.equal(receipt.value.counts.document, 2)
    assert.ok(!JSON.stringify(receipt.value).includes('Okafor'))
    const s = await state()
    assert.ok(!JSON.stringify(s).includes('Okafor'))
    assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM l_records WHERE kind='blob' AND id IN (?,?)").bind(...docIds).first()).n, 0)
    assert.equal(s.deletionReceipts.length, 1)
    await checkErasure(h, vacancy, manager)
    await cmd('extend-retention', { candidate: publicApp.candidate, until: '2020-01-01', reason: 'Hired; HR keeps the employee file' })
    assert.deepEqual((await state()).retention.due.map(r => r.candidate), [publicApp.candidate], 'past-date records with no open application are listed for review')
  })

  const openJob = async title => {
    const draft = await cmd('vacancy', { title, location: 'Denver, CO', headcount: 1, compensation: RANGE, manager: 'morgan@example.test' }, manager)
    const v = await cmd('rubric', { id: draft.id, criteria: RUBRIC }, manager)
    await cmd('interview-plan', { id: v.id, plan: [{ name: 'Floor walk', stage: v.stages[2].id }] }, manager)
    await approve((await cmd('request-vacancy-approval', { id: v.id, approver: 'parker@example.test' }, manager)).id)
    return cmd('publish', { id: v.id }, manager)
  }

  await t.test('DISP-001 closes take a listed reason; a rejection schedules its template email, canceled on reopen or erasure', async () => {
    // The employer's list, grouped; only the owner or a hiring admin keeps it.
    const listed = (await state(manager)).rejectionReasons
    assert.ok(listed.some(r => r.label === 'Lacks required certification' && r.group === 'rejected') && listed.some(r => r.id === 'other-offer' && r.group === 'withdrew'))
    const keep = listed.filter(r => r.id !== 'pay').map(({ id, label, group }) => ({ id, label, group }))
    assert.equal((await send('/api/lodge/command/rejection-reasons', { reasons: [...keep, { label: 'Failed the site safety quiz', group: 'rejected' }] }, manager)).status, 403)
    assert.equal((await send('/api/lodge/command/rejection-reasons', { reasons: keep.filter(r => r.group === 'rejected') }, owner)).status, 400, 'both groups keep a reason')
    const saved = (await cmd('rejection-reasons', { reasons: [...keep, { label: 'Failed the site safety quiz', group: 'rejected' }] })).reasons
    assert.deepEqual(saved.filter(r => r.retired).map(r => r.id), ['pay'], 'a reason left out is retired, not deleted')
    // Templates with merge fields; an unknown field and a manager author are refused.
    const template = { name: 'Standard decline', subject: 'Your application for {job_title}', body: 'Dear {candidate_name},\nThank you for applying. We will not move forward.\n{business_name}' }
    assert.equal((await send('/api/lodge/command/rejection-template', template, manager)).status, 403)
    assert.equal((await send('/api/lodge/command/rejection-template', { ...template, body: 'Pay was {salary}' }, owner)).status, 400)
    declineTemplate = await cmd('rejection-template', template)

    const job = await openJob('Crane operator')
    const add = (name, mail) => cmd('candidate', { name, email: mail, source: 'Careers page', consentBasis: 'application', vacancy: job.id }, manager)
    const { application: first } = await add('Dara Lindqvist', 'dara.l@example.test'), { application: second } = await add('Eli Novak', 'eli@example.test')
    const close = (body, cookie = manager) => send('/api/lodge/command/move', { application: first.id, to: 'rejected', ...body }, cookie)
    assert.equal((await close({ reason: 'No card' })).status, 400, 'a close needs a listed reason')
    assert.equal((await close({ closeReason: 'other-offer' })).status, 400, 'a withdrawal reason does not reject')
    assert.equal((await close({ closeReason: 'pay' })).status, 400, 'a retired reason takes no new close')
    assert.equal((await close({ closeReason: 'certification', send: 'delay', businessDays: 2 })).status, 400, 'a scheduled email needs a template')
    assert.equal((await send('/api/lodge/command/move', { application: second.id, to: 'withdrawn', closeReason: 'other-offer', send: 'now', template: declineTemplate.id }, manager)).status, 400, 'a withdrawal sends no rejection')

    // Reject the first with a two-business-day email; the second withdrew, without email.
    await close({ closeReason: 'certification', reason: 'No NCCCO card', send: 'delay', businessDays: 2, template: declineTemplate.id })
    await cmd('move', { application: second.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Took a union job' }, manager)
    let s = await state(manager)
    const closed = s.applications.find(a => a.id === first.id).history.at(-1)
    assert.deepEqual([closed.to, closed.reason, closed.note, closed.closeReason, closed.closeGroup], ['rejected', 'Lacks required certification', 'No NCCCO card', 'certification', 'rejected'])
    assert.deepEqual(s.rejectionEmails.filter(m => m.application === second.id), [])
    const [scheduled] = s.rejectionEmails.filter(m => m.application === first.id)
    assert.deepEqual([scheduled.state, scheduled.to, scheduled.subject, scheduled.body], ['scheduled', 'dara.l@example.test', 'Your application for Crane operator', 'Dear Dara Lindqvist,\nThank you for applying. We will not move forward.\nExample Builders'])
    // Two business days later in New York, at the same wall-clock time: weekends do not count.
    const local = (iso, o) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', ...o }).format(new Date(iso))
    const clockOf = iso => local(iso, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    assert.equal(clockOf(scheduled.sendAt), clockOf(scheduled.scheduledAt))
    let weekdays = 0
    for (let d = Date.parse(local(scheduled.scheduledAt, {}) + 'T12:00:00Z') + 86400000; d <= Date.parse(local(scheduled.sendAt, {}) + 'T12:00:00Z'); d += 86400000) if (![0, 6].includes(new Date(d).getUTCDay())) weekdays++
    assert.equal(weekdays, 2)
    assert.ok(![0, 6].includes(new Date(local(scheduled.sendAt, {}) + 'T12:00:00Z').getUTCDay()))
    assert.deepEqual((await state(ivy)).rejectionEmails, [], 'an interviewer sees no rejection email')

    // Reopened before the send time: the email is canceled. Rejected again to send now: one live email, due.
    await cmd('reopen', { application: first.id, to: job.stages[1].id, reason: 'Card arrived' }, manager)
    assert.deepEqual((({ state, canceledReason }) => [state, canceledReason])((await state(manager)).rejectionEmails.find(m => m.id === scheduled.id)), ['canceled', 'Application reopened'])
    await close({ closeReason: 'certification', reason: 'Card expired', send: 'now', template: declineTemplate.id })
    s = await state(manager)
    const mine = s.rejectionEmails.filter(m => m.application === first.id)
    assert.deepEqual(mine.map(m => m.state), ['canceled', 'due-not-sent'], 'one live email; Lodge never calls it sent without a mailbox')
    assert.equal(mine[1].sendAt, mine[1].scheduledAt)

    // Rejection reasons by job, for the people who run it.
    assert.equal((await send('/api/lodge/reports/rejections', undefined, ivy)).status, 403)
    const report = (await send('/api/lodge/reports/rejections', undefined, manager)).value.jobs.find(j => j.id === job.id)
    assert.deepEqual([report.rejected.map(r => [r.label, r.count]), report.withdrew.map(r => [r.label, r.count])], [[['Lacks required certification', 1]], [['Accepted another offer', 1]]])

    // Erasing a candidate deletes their scheduled email with their other records.
    const { application: third } = await add('Fern Ota', 'fern@example.test')
    await cmd('move', { application: third.id, to: 'rejected', closeReason: 'skills', send: 'delay', businessDays: 3, template: declineTemplate.id }, manager)
    assert.equal((await state()).rejectionEmails.filter(m => m.application === third.id && m.state === 'scheduled').length, 1)
    const receipt = await send('/api/lodge/delete-candidate', { candidate: (await state()).applications.find(a => a.id === third.id).candidate, confirm: 'Fern Ota', reason: 'Asked to be forgotten' }, owner)
    assert.equal(receipt.value.counts['rejection-email'], 1)
    assert.deepEqual((await state()).rejectionEmails.filter(m => m.application === third.id), [])
  })

  await t.test('DISP-002 a rejected application reopens into a chosen stage with its whole history', async () => {
    const job = await openJob('Yard lead')
    const interviewStage = job.stages.find(st => st.name === 'Interview').id
    const { application: app, candidate: person } = await cmd('candidate', { name: 'Noor Haddad', email: 'noor@example.test', source: 'Careers page', consentBasis: 'application', vacancy: job.id }, manager)
    await cmd('move', { application: app.id, to: 'rejected', closeReason: 'certification', reason: 'No forklift licence' }, manager)
    const letter = await cmd('message', { application: app.id, purpose: 'rejection', subject: 'Your application', body: 'Thank you for applying.' }, manager)
    await approve((await cmd('request-message-approval', { id: letter.id, approver: (await state()).members.find(m => m.owner).email }, manager)).id, owner)
    const reopen = (body, cookie = manager) => send('/api/lodge/command/reopen', { application: app.id, to: interviewStage, reason: 'Licence arrived', ...body }, cookie)
    assert.equal((await reopen({ reason: '' })).status, 400, 'reopening needs a reason')
    assert.equal((await reopen({}, ivy)).status, 404)
    // A second active application to the same job refuses the reopen.
    const second = await cmd('apply', { candidate: person.id, vacancy: job.id, source: 'Reapplied' }, manager)
    assert.equal((await reopen({})).status, 409)
    await cmd('move', { application: second.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Duplicate of the first application' }, manager)
    const hold = await cmd('hold', { candidate: person.id, reason: 'Preserve as decided' })
    assert.equal((await reopen({})).status, 409, 'a hold keeps the record as it stands')
    await cmd('release-hold', { id: hold.id, reason: 'Review done' })
    const opened = await reopen({})
    assert.equal(opened.status, 200, opened.text)
    const s = await state(manager)
    const after = s.applications.find(a => a.id === app.id)
    assert.deepEqual([after.status, after.stage], ['active', interviewStage])
    assert.deepEqual(after.history.map(e => [e.to, e.reason]), [[job.stages[0].id, 'Application received (Careers page)'], ['rejected', 'Lacks required certification'], [interviewStage, 'Licence arrived']])
    assert.equal(after.history.at(-1).from, 'rejected')
    // The funnel counts the application once, in its new stage.
    const mine = s.applications.filter(a => a.vacancy === job.id && a.candidate === person.id)
    assert.deepEqual(mine.map(a => [a.id, a.status]).sort(), [[app.id, 'active'], [second.id, 'withdrawn']].sort())
    assert.equal(s.applications.filter(a => a.vacancy === job.id && a.status === 'active' && a.stage === interviewStage).length, 1)
    assert.equal((await send('/api/lodge/download/vacancy/' + job.id, undefined, manager)).value.applications.filter(a => a.id === app.id).length, 1)
    // The pending rejection letter is canceled and can no longer be downloaded.
    assert.equal(s.messages.find(m => m.id === letter.id).cancelled, true)
    assert.equal((await send('/api/lodge/download/message/' + letter.id, undefined, manager)).status, 409)
    assert.ok((await state()).audit.some(e => e.action === 'application-reopened' && e.record === 'application:' + app.id))
    assert.equal((await reopen({})).status, 409, 'an active application is not reopened')
    // After erasure there is nothing left to reopen.
    const { application: gone } = await cmd('candidate', { name: 'Remy Vance', email: 'remy@example.test', source: 'Careers page', consentBasis: 'application', vacancy: job.id }, manager)
    await cmd('move', { application: gone.id, to: 'rejected', closeReason: 'skills', reason: 'Not eligible' }, manager)
    const remy = (await state()).applications.find(a => a.id === gone.id).candidate
    assert.equal((await send('/api/lodge/delete-candidate', { candidate: remy, confirm: 'Remy Vance', reason: 'Asked to be forgotten' }, owner)).status, 200)
    assert.equal((await send('/api/lodge/command/reopen', { application: gone.id, to: interviewStage, reason: 'Mistake' }, manager)).status, 404)
    await cmd('move', { application: app.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Took another role' }, manager)
  })

  await t.test('DATA-005 add a candidate to another job, and transfer an application with its history', async () => {
    const warehouse = await openJob('Warehouse Associate'), forklift = await openJob('Forklift Operator')
    const { application: source, candidate: person } = await cmd('candidate', { name: 'Lena Ortiz', email: 'lena@example.test', source: 'Referral from Ivy', consentBasis: 'referral', vacancy: warehouse.id, resume: { name: 'lena.txt', mediaType: 'text/plain', base64: b64('Lena Ortiz resume') } }, manager)
    // Add another candidate to a second job: a new application with its own history, rubric version and reviewers.
    const { application: first, candidate: other } = await cmd('candidate', { name: 'Omar Fitz', email: 'omar@example.test', source: 'Job board', consentBasis: 'application', vacancy: warehouse.id }, manager)
    await cmd('assign-reviewers', { application: first.id, reviewers: ['ivy@example.test'] }, manager)
    const added = await cmd('apply', { candidate: other.id, vacancy: forklift.id, source: 'Also suits forklift' }, manager)
    let s = await state(manager)
    const addedView = s.applications.find(a => a.id === added.id)
    assert.deepEqual([addedView.status, addedView.reviewers, addedView.rubricVersion, addedView.history.length], ['active', [], forklift.rubrics.at(-1).version, 1])
    assert.equal(s.applications.find(a => a.id === first.id).status, 'active', 'adding leaves the first application open')
    // Feedback on the source job, released to its own panel.
    await cmd('assign-reviewers', { application: source.id, reviewers: ['ivy@example.test'] }, manager)
    const [criterion] = warehouse.rubrics[0].criteria
    await cmd('scorecard', { application: source.id, ratings: { [criterion.id]: 3 }, evidence: { [criterion.id]: 'SOURCE-EVIDENCE careful loader' }, recommendation: 'yes', takeaways: 'SOURCE-TAKEAWAY steady', submit: true }, ivy)
    await cmd('release-feedback', { application: source.id }, manager)
    assert.equal((await send('/api/lodge/command/transfer', { application: source.id, vacancy: forklift.id }, ivy)).status, 403, 'a reviewer cannot transfer')
    const target = await cmd('transfer', { application: source.id, vacancy: forklift.id, reason: 'Holds a forklift licence' }, manager)
    s = await state(manager)
    const closed = s.applications.find(a => a.id === source.id), opened = s.applications.find(a => a.id === target.id)
    assert.deepEqual([closed.status, closed.transferredTo, closed.history.at(-1).reason], ['transferred', target.id, 'Transferred to Forklift Operator: Holds a forklift licence'])
    assert.deepEqual([opened.status, opened.vacancy, opened.stage, opened.transferredFrom, opened.source], ['active', forklift.id, forklift.stages[0].id, source.id, 'Referral from Ivy'])
    assert.equal(opened.history[0].reason, 'Transferred from Warehouse Associate: Holds a forklift licence')
    assert.deepEqual(opened.earlier.map(e => [e.application, e.title, e.history.at(-1).to]), [[source.id, 'Warehouse Associate', 'transferred']])
    // An interviewer on the target job reads the linked history and resume, never the source job's scorecards.
    await cmd('assign-reviewers', { application: target.id, reviewers: ['ian@example.test'] }, manager)
    const ianView = await state(ian)
    assert.ok(!ianView.applications.some(a => a.id === source.id))
    assert.equal(ianView.applications.find(a => a.id === target.id).earlier[0].history.length, 2)
    assert.ok(!JSON.stringify(ianView).includes('SOURCE-EVIDENCE') && !JSON.stringify(ianView).includes('SOURCE-TAKEAWAY'))
    const resume = ianView.documents.find(d => d.candidate === person.id && d.kind === 'resume')
    assert.equal((await send('/api/lodge/download/document/' + resume.id, undefined, ian)).text, 'Lena Ortiz resume')
    assert.equal((await send('/api/lodge/download/vacancy/' + warehouse.id, undefined, ian)).status, 404)
    assert.ok((await state(ivy)).scorecards.some(c => c.application === source.id), 'the source panel keeps its released feedback')
    // One active application per job still holds.
    assert.equal((await send('/api/lodge/command/apply', { candidate: person.id, vacancy: forklift.id, source: 'again' }, manager)).status, 409)
    assert.equal((await send('/api/lodge/command/transfer', { application: source.id, vacancy: forklift.id }, manager)).status, 409, 'a closed application cannot transfer again')
    assert.equal((await send('/api/lodge/command/transfer', { application: added.id, vacancy: forklift.id }, manager)).status, 400)
    for (const id of [target.id, first.id, added.id]) await cmd('move', { application: id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Round closed' }, manager)
  })

  await t.test('DATA-004 spam leaves the pipeline and its counts with a reason; repeats are flagged for review', async () => {
    const job = await openJob('Dock hand')
    const notice = String((await state()).business.notices.at(-1).version)
    const apply = async (name, email) => {
      const f = new FormData()
      for (const [k, v] of Object.entries({ name, email, noticeVersion: notice, consent: 'yes', coverNote: 'Cheap pallets at wholesale prices' })) f.append(k, v)
      assert.equal((await send('/jobs/' + job.slug, f)).status, 200)
      return (await state(manager)).applications.filter(a => a.vacancy === job.id).at(-1)
    }
    const real = await apply('Jo Real', 'jo@example.test')
    const junk = await apply('Pallet Deals', 'deals@junk.example')
    assert.equal(junk.likelySpam, undefined, 'a first submission is not flagged')
    const funnel = async () => (await state(manager)).vacancies.find(v => v.id === job.id).funnel
    assert.deepEqual([(await funnel()).applicants, (await funnel()).stages[job.stages[0].id]], [2, 2])
    assert.equal((await send('/api/lodge/command/mark-spam', { application: junk.id }, manager)).status, 400, 'spam needs a reason')
    assert.equal((await send('/api/lodge/command/mark-spam', { application: junk.id, reason: 'x' }, ivy)).status, 404)
    await cmd('mark-spam', { application: junk.id, reason: 'Advertising, not an application' }, manager)
    let s = await state(manager)
    const marked = s.applications.find(a => a.id === junk.id)
    assert.deepEqual([marked.status, marked.spam.reason, marked.history.at(-1).to], ['spam', 'Advertising, not an application', 'spam'])
    assert.deepEqual(await funnel(), { applicants: 1, spam: 1, stages: Object.fromEntries(job.stages.map((st, i) => [st.id, i ? 0 : 1])), rejected: 0, withdrawn: 0, transferred: 0, hired: 0 })
    assert.equal(s.messages.filter(m => m.application === junk.id).length, 0, 'no rejection email is queued')
    assert.ok((await state()).audit.some(e => e.action === 'application-spam' && e.email === 'morgan@example.test' && e.reason === 'Advertising, not an application' && e.record === 'application:' + junk.id))
    // Unmarking restores the stage it left, with the history.
    assert.equal((await send('/api/lodge/command/unmark-spam', { application: junk.id }, manager)).status, 400)
    await cmd('unmark-spam', { application: junk.id, reason: 'Checked: a real dock worker' }, manager)
    s = await state(manager)
    const back = s.applications.find(a => a.id === junk.id)
    assert.deepEqual([back.status, back.stage, back.history.map(e => e.to)], ['active', job.stages[0].id, [job.stages[0].id, 'spam', job.stages[0].id]])
    assert.equal((await funnel()).applicants, 2)
    // The same email again: flagged for a person, still in Applied.
    const again = await apply('Pallet Deals', 'deals@junk.example')
    assert.deepEqual([again.status, again.stage], ['active', job.stages[0].id])
    assert.deepEqual(again.likelySpam.reasons, ['the same email was marked as spam before', 'the same email already applied to this job'])
    assert.equal((await funnel()).applicants, 3, 'a flag never removes an application')
    assert.equal((await send('/api/lodge/command/clear-spam-flag', { application: again.id }, manager)).status, 400)
    await cmd('clear-spam-flag', { application: again.id, reason: 'Second job interest' }, manager)
    assert.equal((await state(manager)).applications.find(a => a.id === again.id).likelySpam, undefined)
    assert.equal((await state(manager)).applications.find(a => a.id === real.id).likelySpam, undefined)
    for (const id of [real.id, junk.id]) await cmd('move', { application: id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Round closed' }, manager)
    await cmd('mark-spam', { application: again.id, reason: 'Repeat advert' }, manager)
    // Spam follows ordinary retention: once its date passes it is listed for review like any closed record.
    await cmd('extend-retention', { candidate: again.candidate, until: '2020-01-01', reason: 'Spam keeps no longer than needed' })
    assert.ok((await state()).retention.due.some(r => r.candidate === again.candidate))
  })

  await t.test('TEAM-001 shared notes and the activity feed reach the hiring team; private notes and unreleased scorecards do not', async () => {
    const rhea = await h.member('rhea@example.test', ['admin'], 'Rhea Stone')
    const ivyAgent = await h.signIn('ivy-agent@example.test'), una = await h.signIn('una@example.test')
    const { application: app } = await cmd('candidate', { name: 'Omar Haddad', email: 'omar@example.test', source: 'Referral', consentBasis: 'referral', vacancy: vacancy.id }, rhea)
    const mine = rows => rows.filter(r => r.candidate === app.candidate)
    const words = rows => mine(rows).map(r => r.text.split(' ')[0])
    await cmd('assign-reviewers', { application: app.id, reviewers: ['ivy@example.test', 'ian@example.test'] }, manager)
    const first = await cmd('team-note', { application: app.id, text: 'SHARED-1 Strong referral from the Queens site' }, rhea)
    await cmd('team-note', { candidate: app.candidate, text: 'SHARED-2 Agreed, booking a site walk' }, manager)
    await cmd('team-note', { application: app.id, text: 'PRIVATE-1 Current pay is above our band', private: true }, manager)
    assert.equal((await send('/api/lodge/command/team-note', { application: app.id, text: 'Approvers are not the hiring team' }, approver)).status, 403)
    assert.equal((await send('/api/lodge/command/team-note', { id: first.id, text: 'Rewritten' }, manager)).status, 403, 'only its author edits a note')
    await cmd('team-note', { id: first.id, text: 'SHARED-1 Strong referral from the Queens and Bronx sites' }, rhea)
    const v = (await state(manager)).vacancies.find(x => x.id === vacancy.id), [safety] = v.rubrics[0].criteria
    await cmd('move', { application: app.id, to: v.stages[1].id, reason: 'Referral checks out' }, manager)
    await cmd('message', { application: app.id, purpose: 'other', subject: 'Site walk next week', body: 'Hi Omar' }, manager)
    await cmd('offer', { application: app.id, title: 'Site supervisor', startDate: '2027-02-01', salary: { currency: 'USD', amount: 10000000, period: 'year' } }, manager)
    const card = (who, takeaways) => cmd('scorecard', { application: app.id, ratings: { [safety.id]: 3 }, evidence: { [safety.id]: 'Clear on lockout' }, recommendation: 'yes', takeaways, submit: true }, who)
    await card(ivy, 'IVY-UNRELEASED steady'); await card(ian, 'IAN-UNRELEASED careful')
    // The recruiter and the job's manager read every note, edits kept, in a feed of everything that happened.
    for (const who of [rhea, manager]) {
      const s = await state(who)
      assert.deepEqual(words(s.teamNotes), ['SHARED-1', 'SHARED-2', 'PRIVATE-1'])
      assert.deepEqual(s.teamNotes.find(n => n.id === first.id).edits.map(e => e.text), ['SHARED-1 Strong referral from the Queens site'])
      assert.deepEqual([...new Set(mine(s.activity).map(e => e.kind))].sort(), ['email', 'note', 'offer', 'scorecard', 'stage'])
      assert.ok(!JSON.stringify(mine(s.activity)).includes('UNRELEASED'), 'a submission shows as who and when, never its content')
    }
    // The assigned interviewer, and their agent, read the shared notes only, in the app state and the feed export.
    for (const who of [ivy, ivyAgent]) {
      const s = await state(who)
      assert.deepEqual(words(s.teamNotes), ['SHARED-1', 'SHARED-2'])
      assert.deepEqual(mine(s.activity).filter(e => e.kind === 'note').map(e => [e.text.split(' ')[0], e.edited]).sort(), [['SHARED-1', true], ['SHARED-2', false]])
      assert.ok(mine(s.activity).some(e => e.kind === 'scorecard' && e.actor === 'ian@example.test'))
      assert.ok(!mine(s.activity).some(e => ['email', 'offer'].includes(e.kind)))
      assert.ok(!JSON.stringify(s).includes('PRIVATE-1') && !JSON.stringify(s).includes('IAN-UNRELEASED'))
      const exported = await send('/api/lodge/download/activity/' + app.candidate, undefined, who)
      assert.equal(exported.status, 200)
      assert.deepEqual(exported.value.notes.map(n => n.text.split(' ')[0]), ['SHARED-1', 'SHARED-2'])
      assert.ok(!exported.text.includes('PRIVATE-1') && !exported.text.includes('IAN-UNRELEASED'))
    }
    // An interviewer outside the panel reaches none of it; the manager's job export and the admin's candidate export carry it all.
    assert.ok(!JSON.stringify(await state(una)).includes('SHARED-1'))
    assert.equal((await send('/api/lodge/download/activity/' + app.candidate, undefined, una)).status, 404)
    assert.deepEqual(words((await send('/api/lodge/download/vacancy/' + vacancy.id, undefined, manager)).value.teamNotes), ['SHARED-1', 'SHARED-2', 'PRIVATE-1'])
    assert.deepEqual(words((await send('/api/lodge/download/candidate/' + app.candidate, undefined, rhea)).value['team-note']), ['SHARED-1', 'SHARED-2', 'PRIVATE-1'])
    await cmd('move', { application: app.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Took another role' }, manager)
  })

  await t.test('TASK-001 follow-ups and tasks reach their owner, come due, close with the application and move on deprovisioning', async () => {
    const rhea = await h.signIn('rhea@example.test'), una = await h.signIn('una@example.test')
    const today = new Date().toLocaleDateString('en-CA', { timeZone: BUSINESS.timeZone })
    const friday = new Date(Date.parse(today) + 86400000 * (((5 - new Date(Date.parse(today)).getUTCDay() + 7) % 7) || 7)).toISOString().slice(0, 10)
    const { application: app } = await cmd('candidate', { name: 'Lena Brooks', email: 'lena@example.test', source: 'Referral', consentBasis: 'referral', vacancy: vacancy.id }, manager)
    const followUp = await cmd('task', { application: app.id, note: 'Check in after her site visit', due: today }, manager)
    const call = await cmd('task', { kind: 'task', candidate: app.candidate, note: 'Call references', due: friday, owner: 'rhea@example.test' }, manager)
    const later = await cmd('task', { candidate: app.candidate, note: 'Ask about her start date', due: friday }, manager)
    const walk = await cmd('task', { kind: 'task', application: app.id, note: 'Book her site walk', due: friday }, manager)
    assert.equal((await send('/api/lodge/command/task', { candidate: app.candidate, note: 'Panel follow-up', due: friday }, ivy)).status, 404, 'an unassigned interviewer cannot reach the candidate')
    await cmd('assign-reviewers', { application: app.id, reviewers: ['ivy@example.test'] }, manager)
    assert.equal((await send('/api/lodge/command/task', { kind: 'task', application: app.id, note: 'Panel task', due: friday }, ivy)).status, 403, 'tasks are for recruiters; panel members set follow-ups')
    await cmd('task', { application: app.id, note: 'IVY-FOLLOWUP chase the portfolio', due: friday }, ivy)
    assert.match((await send('/api/lodge/command/task', { application: app.id, note: 'Yours', due: friday, owner: 'una@example.test' }, manager)).value.error, /cannot see this candidate/)
    assert.equal((await send('/api/lodge/command/task', { application: app.id, note: 'No date', due: 'Friday' }, manager)).status, 400)
    // Each owner's home lists theirs; the follow-up due today notifies its owner, the Friday task does not yet.
    const mine = await state(manager)
    assert.deepEqual(mine.tasks.filter(x => x.candidate === app.candidate).map(x => [x.note, x.owner]).sort(), [['Ask about her start date', 'morgan@example.test'], ['Book her site walk', 'morgan@example.test'], ['Call references', 'rhea@example.test'], ['Check in after her site visit', 'morgan@example.test']])
    assert.deepEqual(mine.notifications.filter(n => n.kind === 'task-due').map(n => n.task), [followUp.id])
    const theirs = await state(rhea)
    assert.deepEqual(theirs.tasks.map(x => x.id), [call.id])
    assert.deepEqual(theirs.notifications.filter(n => n.kind === 'task-due'), [])
    assert.ok(!JSON.stringify(await state(una)).includes('Call references'))
    assert.ok(!JSON.stringify((await state(ivy)).tasks).includes('Call references'), 'a panel member sees only their own')
    // Rejecting the application cancels the follow-ups and tasks attached to it, kept as cancelled history;
    // the task and follow-up about the candidate that are not attached to it stay open.
    await cmd('move', { application: app.id, to: 'rejected', closeReason: 'skills', reason: 'Not progressing' }, manager)
    const after = (await state(manager)).tasks
    assert.deepEqual(after.filter(x => x.application === app.id).map(x => [x.kind, x.note, x.status, x.closedReason]).sort(), [['follow-up', 'Check in after her site visit', 'cancelled', 'Application rejected'], ['task', 'Book her site walk', 'cancelled', 'Application rejected']])
    assert.deepEqual([after.find(x => x.id === walk.id)?.status, after.find(x => x.id === call.id).status, after.find(x => x.id === later.id).status], ['cancelled', 'open', 'open'])
    assert.equal((await state(ivy)).tasks.find(x => x.note.startsWith('IVY-FOLLOWUP')).status, 'cancelled')
    assert.deepEqual((await state(manager)).notifications.filter(n => n.kind === 'task-due'), [], 'a closed follow-up no longer notifies')
    // Deprovisioning the colleague hands their task back to the person who set it.
    await cmd('member', { email: 'rhea@example.test', name: 'Rhea Stone', roles: [], active: false })
    const moved = (await state(manager)).tasks.find(x => x.id === call.id)
    assert.deepEqual([moved.owner, moved.history.map(e => [e.from, e.to, e.reason])], ['morgan@example.test', [['rhea@example.test', 'morgan@example.test', 'Owner deprovisioned']]])
    await cmd('complete-task', { id: moved.id }, manager)
    // Erasing the candidate removes what is left of their follow-ups.
    assert.equal((await send('/api/lodge/delete-candidate', { candidate: app.candidate, confirm: 'Lena Brooks', reason: 'Asked to be forgotten' }, owner)).status, 200)
    assert.ok(!(await state(manager)).tasks.some(x => x.id === later.id || x.candidate === app.candidate))
  })

  await t.test('REQ-005 a hiring manager kickoff becomes the job draft; changing its pay or headcount after approval makes the approval stale', async () => {
    const kickoff = { title: 'Concrete foreman', purpose: 'Run pours on our two Queens sites', mustHave: ['OSHA 30', 'Formwork crew lead'], niceToHave: ['Spanish'], plan: [{ name: 'Site walk', interviewers: ['ivy@example.test', 'ian@example.test'] }], payRange: { currency: 'USD', min: 8500000, max: 9500000, period: 'year' }, headcount: 2, targetStart: '2027-03-01' }
    assert.equal((await send('/api/lodge/command/kickoff', kickoff, ivy)).status, 403, 'interviewers do not start jobs')
    assert.equal((await send('/api/lodge/command/kickoff', { ...kickoff, payRange: { ...kickoff.payRange, currency: 'EUR' } }, manager)).status, 400, 'the pay request is in USD')
    assert.equal((await send('/api/lodge/command/kickoff', { ...kickoff, plan: [{ name: 'Walk', interviewers: ['parker@example.test'] }] }, manager)).status, 400, 'proposed interviewers hold the role')
    const k = await cmd('kickoff', kickoff, manager)
    assert.equal((await send('/api/lodge/command/vacancy-from-kickoff', { kickoff: k.id, location: 'Queens, NY' }, manager)).status, 403, 'a recruiter turns it into the job')
    const job = await cmd('vacancy-from-kickoff', { kickoff: k.id, location: 'Queens, NY' })
    assert.equal((await send('/api/lodge/command/vacancy-from-kickoff', { kickoff: k.id, location: 'Queens, NY' }, owner)).status, 409, 'one job per kickoff')
    let s = await state(manager), v = s.vacancies.find(x => x.id === job.id)
    assert.deepEqual([v.title, v.manager, v.compensation, v.headcount, v.kickoff, v.description], ['Concrete foreman', 'morgan@example.test', kickoff.payRange, 2, k.id, kickoff.purpose])
    assert.deepEqual(v.rubrics[0].criteria.map(c => [c.name, c.description]), [['OSHA 30', 'Must have: OSHA 30'], ['Formwork crew lead', 'Must have: Formwork crew lead'], ['Spanish', 'Nice to have: Spanish']])
    assert.deepEqual(v.plan.map(p => [p.name, v.stages.find(st => st.id === p.stage).name]), [['Site walk', 'Interview']])
    assert.deepEqual([s.kickoffs.find(x => x.id === k.id).vacancy, s.kickoffs.find(x => x.id === k.id).status], [job.id, 'converted'], 'the kickoff stays linked')
    await approve((await cmd('request-vacancy-approval', { id: job.id, approver: 'parker@example.test' }, manager)).id)
    assert.equal((await state(manager)).vacancies.find(x => x.id === job.id).approvedNow, true)
    // The manager raises the requested range afterward: the approval no longer matches and publishing is refused.
    await cmd('kickoff', { ...kickoff, id: k.id, payRange: { ...kickoff.payRange, max: 10500000 } }, manager)
    s = await state(manager)
    assert.equal(s.vacancies.find(x => x.id === job.id).approvedNow, false)
    assert.deepEqual(s.kickoffs.find(x => x.id === k.id).changes.map(c => c.payRange.max), [9500000])
    assert.equal((await send('/api/lodge/command/publish', { id: job.id }, manager)).status, 409)
    await approve((await cmd('request-vacancy-approval', { id: job.id, approver: 'parker@example.test' }, manager)).id)
    assert.equal((await cmd('publish', { id: job.id }, manager)).status, 'open')
    await cmd('close-vacancy', { id: job.id, reason: 'Kickoff journey done' }, manager)
  })

  await t.test('OPS-005 a confidential job and a private candidate reach only the people named and see-private holders', async () => {
    const rae = await h.member('rae@example.test', ['admin'], 'Rae Kim'), nia = await h.member('nia@example.test', ['admin'], 'Nia Patel')
    const sam = await h.member('sam@example.test', ['admin'], 'Sam Ortiz', { seePrivate: true })
    const raeAgent = await h.member('rae-agent@example.test', [], 'Rae’s coding agent', { agent: true, actsFor: 'rae@example.test' })
    const job = await cmd('vacancy', { title: 'Head of Operations', department: 'Leadership', location: 'Brooklyn, NY', headcount: 1, manager: 'morgan@example.test', compensation: RANGE }, manager)
    await cmd('rubric', { id: job.id, criteria: RUBRIC }, manager)
    await cmd('interview-plan', { id: job.id, plan: [{ name: 'Board panel', stage: job.stages[2].id, durationMinutes: 60 }] }, manager)
    await approve((await cmd('request-vacancy-approval', { id: job.id, approver: 'parker@example.test' }, manager)).id)
    assert.equal((await send('/api/lodge/command/vacancy-privacy', { id: job.id, confidential: true }, manager)).status, 403, 'admins mark a job confidential')
    await cmd('vacancy-privacy', { id: job.id, confidential: true, namedPeople: ['nia@example.test'] })
    const { slug } = await cmd('publish', { id: job.id }, manager)
    const { application: app } = await cmd('candidate', { name: 'Quinn Avery', email: 'quinn@example.test', source: 'Internal', consentBasis: 'referral', vacancy: job.id }, manager)
    // Off the careers page, unless posted under a neutral title.
    assert.ok(!(await send('/jobs')).text.includes('Head of Operations'))
    assert.equal((await send('/jobs/' + slug)).status, 404)
    await cmd('vacancy-privacy', { id: job.id, confidential: true, namedPeople: ['nia@example.test'], publicTitle: 'Operations leader' })
    const listed = (await send('/jobs')).text, posted = await send('/jobs/' + slug)
    assert.ok(listed.includes('Operations leader') && !listed.includes('Head of Operations'))
    assert.equal(posted.status, 200)
    assert.ok(!posted.text.includes('Head of Operations') && !posted.text.includes('Leadership'))
    // A regular recruiter and their agent find neither the job nor its candidate anywhere; the totals still count both.
    for (const who of [rae, raeAgent]) {
      const view = await state(who)
      assert.ok(!view.vacancies.some(v => v.id === job.id) && !view.candidates.some(c => c.id === app.candidate))
      assert.ok(!JSON.stringify(view).includes('Quinn Avery') && !JSON.stringify(view).includes('Head of Operations'))
      for (const q of ['Quinn', 'Head of Operations']) assert.deepEqual((await send('/api/lodge/search?q=' + encodeURIComponent(q), undefined, who)).value.results, [])
      for (const path of ['/api/lodge/download/vacancy/' + job.id, '/api/lodge/download/activity/' + app.candidate]) assert.equal((await send(path, undefined, who)).status, 404)
    }
    const raeView = await state(rae)
    assert.equal(raeView.totals.openVacancies, raeView.vacancies.filter(v => v.status === 'open').length + 1)
    assert.equal(raeView.totals.activeApplications, raeView.applications.filter(a => a.status === 'active').length + 1)
    assert.equal((await send('/api/lodge/download/candidate/' + app.candidate, undefined, rae)).status, 404)
    assert.equal((await send('/api/lodge/command/move', { application: app.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Probe' }, rae)).status, 404)
    // The job's manager, the named admin, a see-private holder and the owner see both.
    for (const who of [manager, nia, sam, owner]) {
      const view = await state(who)
      assert.ok(view.vacancies.some(v => v.id === job.id) && view.candidates.some(c => c.id === app.candidate))
    }
    assert.deepEqual((await send('/api/lodge/search?q=Quinn', undefined, sam)).value.results.map(r => r.id), [app.candidate])
    // A private candidate on an ordinary job disappears even for that job's manager unless named.
    const { application: ellis } = await cmd('candidate', { name: 'Ellis Grant', email: 'ellis@example.test', source: 'Internal', consentBasis: 'referral', vacancy: vacancy.id }, manager)
    await cmd('candidate-privacy', { id: ellis.candidate, private: true, namedPeople: ['nia@example.test'] })
    for (const [who, sees] of [[manager, false], [rae, false], [raeAgent, false], [nia, true], [sam, true]]) {
      const view = await state(who)
      assert.equal(view.candidates.some(c => c.id === ellis.candidate) || view.applications.some(a => a.id === ellis.id), sees)
      assert.equal(JSON.stringify(view).includes('Ellis Grant'), sees)
    }
    assert.equal((await state(rae)).totals.candidates, (await state(sam)).totals.candidates, 'aggregate counts include private people')
  })

  await t.test('KIT-001 each interview has a versioned kit, opened from its invitation by its panel, and its scorecard rates only its focus', async () => {
    const job = await cmd('vacancy', { title: 'Estimator', department: 'Operations', location: 'Brooklyn, NY', headcount: 1, manager: 'morgan@example.test', compensation: RANGE }, manager)
    const { rubrics: [{ criteria: [safety, scheduling] }], stages } = await cmd('rubric', { id: job.id, criteria: RUBRIC }, manager)
    await cmd('interview-plan', { id: job.id, plan: [{ name: 'Phone screen', stage: stages[1].id, durationMinutes: 30, criteria: [safety.id] }, { name: 'On-site', stage: stages[2].id, durationMinutes: 90, criteria: [scheduling.id] }] }, manager)
    let v = (await state(manager)).vacancies.find(x => x.id === job.id)
    await cmd('interview-kit', { id: job.id, item: v.plan[0].id, purpose: 'Check safety basics', questions: [{ text: 'Walk me through a toolbox talk', guidance: 'Listen for hazards named' }] }, manager)
    await cmd('interview-kit', { id: job.id, item: v.plan[1].id, purpose: 'Test schedule recovery', questions: [{ text: 'Recover this slipped pour', guidance: 'Look for sequencing' }, { text: 'Who do you call first?' }] }, manager)
    // Re-saving the plan keeps each item's kit; the kit is part of the approved plan and locks with it.
    v = (await state(manager)).vacancies.find(x => x.id === job.id)
    await cmd('interview-plan', { id: job.id, plan: v.plan.map(({ purpose, questions, ...item }) => item) }, manager)
    v = (await state(manager)).vacancies.find(x => x.id === job.id)
    assert.deepEqual(v.plan.map(p => [p.purpose, p.questions.length]), [['Check safety basics', 1], ['Test schedule recovery', 2]])
    await approve((await cmd('request-vacancy-approval', { id: job.id, approver: 'parker@example.test' }, manager)).id)
    const before = (await state(manager)).vacancies.find(x => x.id === job.id).version
    await cmd('publish', { id: job.id }, manager)
    assert.equal((await send('/api/lodge/command/interview-kit', { id: job.id, item: v.plan[0].id, purpose: 'Changed' }, manager)).status, 409, 'a published plan keeps its kits')
    const { application: app } = await cmd('candidate', { name: 'Theo Marsh', email: 'theo@example.test', source: 'Referral', consentBasis: 'referral', vacancy: job.id, resume: { name: 'theo.txt', mediaType: 'text/plain', base64: b64('Theo resume') } }, manager)
    const plan = async (item, who) => { const iv = await cmd('interview', { application: app.id, planItem: item.id, participants: [who], slots: ['2026-11-10T15:00:00Z'] }, manager); await cmd('schedule', { interview: iv.id, slot: 0 }, manager); return iv }
    const phone = await plan(v.plan[0], 'ivy@example.test'), onsite = await plan(v.plan[1], 'ian@example.test')
    // The invitation links to its kit; each panellist opens their own kit with only its focus and questions.
    const ics = (await send('/api/lodge/download/calendar/' + phone.id, undefined, ivy)).text.replace(/\r\n /g, '')
    assert.ok(ics.includes(`/app?kit=${phone.id}`))
    const kit = (await send('/api/lodge/kit/' + phone.id, undefined, ivy)).value
    assert.deepEqual([kit.purpose, kit.questions.map(q => q.text), kit.focus.map(c => c.name), kit.resume.map(d => d.name), kit.feedback, kit.scorecard], ['Check safety basics', ['Walk me through a toolbox talk'], ['Site safety'], ['theo.txt'], null, null])
    assert.deepEqual((await send('/api/lodge/kit/' + onsite.id, undefined, ian)).value.focus.map(c => c.name), ['Scheduling'])
    assert.equal((await send('/api/lodge/kit/' + onsite.id, undefined, ivy)).status, 404, 'an interviewer off that panel is refused')
    assert.equal((await send('/api/lodge/kit/' + phone.id, undefined, (await h.signIn('una@example.test')))).status, 404)
    assert.equal((await send('/api/lodge/kit/' + phone.id, undefined, manager)).status, 200, 'the job\'s manager reads every kit')
    // The phone screen's scorecard asks only its kit's attribute.
    const offFocus = await send('/api/lodge/command/scorecard', { application: app.id, interview: phone.id, ratings: { [safety.id]: 3, [scheduling.id]: 2 }, evidence: { [safety.id]: 'Named three hazards', [scheduling.id]: 'Not asked' }, recommendation: 'yes', takeaways: 'Safe', submit: true }, ivy)
    assert.equal(offFocus.status, 400)
    assert.match(offFocus.value.error, /kit does not assess/)
    await cmd('scorecard', { application: app.id, interview: phone.id, ratings: { [safety.id]: 3 }, evidence: { [safety.id]: 'Named three hazards' }, recommendation: 'yes', takeaways: 'Safe', submit: true }, ivy)
    const mine = (await send('/api/lodge/kit/' + phone.id, undefined, ivy)).value.scorecard
    assert.deepEqual([mine.status, Object.keys(mine.ratings)], ['submitted', [safety.id]])
    assert.equal((await state(manager)).vacancies.find(x => x.id === job.id).version, before, 'the approved version covered the kits')
    await cmd('close-vacancy', { id: job.id, reason: 'Kit journey done' }, manager)
  })

  await t.test('REPORT-006 interviewer timeliness: on time, late and missing against the due time, with released calls only', async () => {
    const v = (await state(manager)).vacancies.find(x => x.id === vacancy.id), [safety] = v.rubrics[0].criteria
    const { application: app } = await cmd('candidate', { name: 'Remi Duval', email: 'remi@example.test', source: 'Referral', consentBasis: 'referral', vacancy: vacancy.id }, manager)
    const at = hours => new Date(Date.now() + hours * 3600000).toISOString()
    const held = async (start, who = 'ivy@example.test') => { const iv = await cmd('interview', { application: app.id, planItem: v.plan[0].id, participants: [who], slots: [start], durationMinutes: 60 }, manager); await cmd('schedule', { interview: iv.id, slot: 0 }, manager); return iv }
    // Due 24 hours after each interview ends: two within it, two past it, one never scored, one still ahead.
    const [soon, recent, old1, old2, never, ahead] = [await held(at(-3)), await held(at(-5)), await held(at(-72)), await held(at(-80)), await held(at(-90)), await held(at(48))]
    const score = (iv, recommendation) => cmd('scorecard', { application: app.id, interview: iv.id, ratings: { [safety.id]: 3 }, evidence: { [safety.id]: 'Clear on permits' }, recommendation, takeaways: 'REMI-UNRELEASED notes', submit: true }, ivy)
    const cards = [[soon, await score(soon, 'yes')], [recent, await score(recent, 'yes')], [old1, await score(old1, 'no')], [old2, await score(old2, 'strong-yes')]]
    assert.equal((await send('/api/lodge/reports/interviewers', undefined, ivy)).status, 403, 'interviewers do not see the report')
    const read = async who => (await send('/api/lodge/reports/interviewers', undefined, who)).value
    let report = await read(manager), row = report.rows.find(r => r.interviewer === 'ivy@example.test' && r.vacancy === vacancy.id)
    const mine = row.items.filter(i => i.application === app.id)
    assert.deepEqual([report.dueHours, mine.filter(i => i.status !== 'upcoming').length, mine.filter(i => i.status === 'on-time').length, mine.filter(i => i.status === 'late').length, mine.filter(i => i.status === 'missing').map(i => i.interview), mine.filter(i => i.status === 'upcoming').map(i => i.interview)], [24, 5, 2, 2, [never.id], [ahead.id]])
    assert.ok(row.conducted >= 5 && row.late >= 2 && row.missing >= 1 && row.upcoming >= 1)
    for (const [iv, c] of cards) assert.equal(mine.find(i => i.interview === iv.id).hoursToSubmit, Math.round((Date.parse(c.submittedAt) - (Date.parse(iv.slots[0]) + 3600000)) / 3600000 * 10) / 10, 'hours to submit follow the recorded submission time')
    assert.equal(typeof row.averageHoursToSubmit, 'number')
    // Before release the report holds no recommendation or content from these cards; after release it counts them.
    assert.ok(!JSON.stringify(report).includes('REMI-UNRELEASED'))
    const before = { ...row.releasedRecommendations }
    await cmd('release-feedback', { application: app.id, reason: 'Calibration' }, manager)
    row = (await read(owner)).rows.find(r => r.interviewer === 'ivy@example.test' && r.vacancy === vacancy.id)
    assert.deepEqual(['yes', 'no', 'strong-yes'].map(r => row.releasedRecommendations[r] - before[r]), [2, 1, 1])
    assert.ok(!JSON.stringify(row).includes('REMI-UNRELEASED'))
    // The missing scorecard drills to its interview, which the manager can open; the overview shows it.
    assert.equal(row.items.find(i => i.status === 'missing' && i.application === app.id).interview, never.id)
    assert.ok((await state(manager)).interviewerActivity.rows.some(r => r.items.some(i => i.interview === never.id && i.status === 'missing')))
    await cmd('move', { application: app.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Report journey done' }, manager)
  })

  await t.test('SCORE-002 a correction is a linked version: the original stays, the manager hears, the packet goes stale', async () => {
    const { application: app } = await cmd('candidate', { name: 'Noor Haddad', email: 'noor@example.test', source: 'Referral', consentBasis: 'referral', vacancy: vacancy.id }, manager)
    await cmd('assign-reviewers', { application: app.id, reviewers: ['ivy@example.test', 'ian@example.test'] }, manager)
    const [safety, scheduling] = (await state(manager)).vacancies.find(x => x.id === vacancy.id).rubrics[0].criteria
    const rated = (s1, s2, e1) => ({ ratings: { [safety.id]: s1, [scheduling.id]: s2 }, evidence: { [safety.id]: e1, [scheduling.id]: 'Recovered a slipped pour' } })
    const fix = (card, body, who = ivy) => send('/api/lodge/command/correct-scorecard', { scorecard: card.id, ...body }, who)
    const first = await cmd('scorecard', { application: app.id, ...rated(2, 3, 'Unsure on permits'), recommendation: 'no', takeaways: 'NOOR-V1 not yet', submit: true }, ivy)
    assert.equal((await fix(first, rated(3, 3, 'Held the permits'))).status, 400, 'a correction needs a reason')
    assert.equal((await fix(first, { reason: 'Mine now' }, ian)).status, 404, 'a colleague cannot reach it before release')
    const v2 = await cmd('correct-scorecard', { scorecard: first.id, ...rated(3, 3, 'Checked: she held the permits'), recommendation: 'yes', takeaways: 'NOOR-V2 solid', reason: 'Misread my permit notes' }, ivy)
    assert.deepEqual([v2.corrects, v2.version, v2.rubricVersion, v2.correctionReason], [first.id, 2, first.rubricVersion, 'Misread my permit notes'])
    assert.equal((await fix(first, { reason: 'Again' })).status, 409, 'only the latest version takes a correction')
    // Blinding is unchanged: the correction is as private as the card, and nobody is told before release.
    for (const who of [ian, manager]) assert.ok(!JSON.stringify(await state(who)).includes('NOOR-V'))
    assert.deepEqual((await state(manager)).notifications.filter(n => n.application === app.id), [])
    const offer = await cmd('offer', { application: app.id, title: 'Site supervisor', startDate: '2027-01-04', salary: { currency: 'USD', amount: 10000000, period: 'year' } }, manager)
    await cmd('scorecard', { application: app.id, ...rated(3, 2, 'Solid permits answer'), recommendation: 'no', takeaways: 'Ian: scheduling thin', submit: true }, ian)
    await cmd('release-feedback', { application: app.id }, manager)
    let packet = (await send('/api/lodge/download/packet/' + offer.id, undefined, manager)).value
    assert.equal(packet.staleEvidence, null, 'the pre-release correction came before the packet was compiled')
    assert.deepEqual(packet.scorecards.filter(c => c.author === 'ivy@example.test').map(c => [c.id, c.corrected]), [[v2.id, true]])
    const v3 = await cmd('correct-scorecard', { scorecard: v2.id, ...rated(3, 4, 'Checked: she held the permits'), reason: 'Forgot her second schedule recovery' }, ivy)
    const seen = await state(ian)
    const versions = seen.scorecards.filter(c => c.application === app.id && c.author === 'ivy@example.test').sort((x, y) => (x.version ?? 1) - (y.version ?? 1))
    assert.deepEqual(versions.map(c => [c.version ?? 1, c.ratings[safety.id], c.ratings[scheduling.id], c.supersededBy ?? null]), [[1, 2, 3, v2.id], [2, 3, 3, v3.id], [3, 3, 4, null]])
    assert.deepEqual([versions[0].takeaways, versions[0].recommendation], ['NOOR-V1 not yet', 'no'], 'the original stays as submitted')
    const summary = seen.applications.find(a => a.id === app.id).scorecardSummary
    assert.deepEqual(summary.counts, { 'strong-no': 0, no: 1, yes: 1, 'strong-yes': 0 }, 'released views count the latest version')
    const marked = summary.interviews[0].cards.find(c => c.author === 'ivy@example.test')
    assert.deepEqual([marked.corrected, marked.version, marked.ratings[scheduling.id], marked.takeaways], [true, 3, 4, 'NOOR-V2 solid'])
    assert.deepEqual((await state(manager)).notifications.filter(n => n.application === app.id).map(n => [n.kind, n.by, n.scorecard, n.reason]), [['scorecard-corrected', 'ivy@example.test', v3.id, 'Forgot her second schedule recovery']])
    packet = (await send('/api/lodge/download/packet/' + offer.id, undefined, manager)).value
    assert.match(packet.staleEvidence, /corrected after this packet was compiled/)
    assert.deepEqual(packet.correctedSince.map(c => [c.scorecard, c.corrects]), [[v3.id, v2.id]])
    // Asking for approval again compiles the packet on the corrected evidence.
    await cmd('request-offer-approval', { id: offer.id, approver: 'parker@example.test' }, manager)
    assert.equal((await send('/api/lodge/download/packet/' + offer.id, undefined, approver)).value.staleEvidence, null)
    await cmd('close-vacancy', { id: vacancy.id, reason: 'Role filled' }, manager)
    const closed = await fix(v3, { reason: 'One more thought' })
    assert.equal(closed.status, 409)
    assert.match(closed.value.error, /job is closed/)
  })

  await t.test('REQ-001 one opening per approved headcount, filled by a named accepted offer, closed with a reason, added only with approval', async () => {
    const job = carpenter = await cmd('vacancy', { title: 'Carpenter', location: 'Queens, NY', headcount: 3, manager: 'morgan@example.test', compensation: RANGE }, manager)
    await cmd('rubric', { id: job.id, criteria: RUBRIC }, manager)
    await cmd('interview-plan', { id: job.id, plan: [{ name: 'Shop test', stageName: 'Interview', durationMinutes: 60 }] }, manager)
    const asked = await cmd('request-vacancy-approval', { id: job.id, approver: 'parker@example.test' }, manager)
    const read = async () => (await state(manager)).vacancies.find(v => v.id === job.id)
    assert.deepEqual((await read()).openings ?? [], [], 'no openings before the headcount is approved')
    await approve(asked.id)
    let v = await read()
    assert.deepEqual(v.openings.map(o => o.status), ['open', 'open', 'open'])
    assert.equal(new Set(v.openings.map(o => o.code)).size, 3, 'each opening has its own generated ID')
    assert.ok(v.openings.every(o => o.openedAt))
    const [first, second, third] = v.openings

    // Employer-defined IDs are unique ignoring case; the approved headcount cannot drop below its openings.
    await cmd('opening', { vacancy: job.id, opening: first.id, code: 'CARP-2026-01', targetStart: '2027-01-11' }, manager)
    assert.equal((await send('/api/lodge/command/opening', { vacancy: job.id, opening: second.id, code: 'carp-2026-01' }, manager)).status, 409)
    assert.equal((await send('/api/lodge/command/vacancy', { ...job, headcount: 2 }, manager)).status, 409)
    assert.equal((await send('/api/lodge/command/close-opening', { vacancy: job.id, opening: second.id, reason: 'x' }, ivy)).status, 403)
    await cmd('publish', { id: job.id }, manager)

    // An accepted offer fills the opening it names; an offer naming none cannot be accepted on a job with openings.
    const hire = (await cmd('candidate', { name: 'Theo Grant', email: 'theo@example.test', source: 'Referral', consentBasis: 'referral', vacancy: job.id }, manager)).application
    const other = (await cmd('candidate', { name: 'Uma Bell', email: 'uma@example.test', source: 'Referral', consentBasis: 'referral', vacancy: job.id }, manager)).application
    const terms = { title: 'Carpenter', startDate: '2027-01-11', salary: { currency: 'USD', amount: 9500000, period: 'year' } }
    const named = await cmd('offer', { application: hire.id, ...terms, opening: first.id }, manager)
    await approve((await cmd('request-offer-approval', { id: named.id, approver: 'parker@example.test' }, manager)).id)
    await cmd('offer-outcome', { id: named.id, outcome: 'accepted', reason: 'Signed' }, manager)
    const unnamed = await cmd('offer', { application: other.id, ...terms }, manager)
    await approve((await cmd('request-offer-approval', { id: unnamed.id, approver: 'parker@example.test' }, manager)).id)
    assert.equal((await send('/api/lodge/command/offer-outcome', { id: unnamed.id, outcome: 'accepted', reason: 'Signed' }, manager)).status, 409)
    assert.equal((await send('/api/lodge/command/offer', { ...unnamed, opening: first.id }, manager)).status, 409, 'a filled opening cannot be named again')
    v = await read()
    const filled = v.openings.find(o => o.id === first.id)
    assert.deepEqual([filled.status, filled.code, filled.offer, filled.application], ['filled', 'CARP-2026-01', named.id, hire.id])
    assert.ok(filled.filledAt >= filled.openedAt, 'time to fill runs from the opening’s own open date')
    const fillReport = (await send('/api/lodge/reports/openings', undefined, manager)).value.openings.filter(x => x.vacancy === job.id)
    assert.deepEqual(fillReport.map(x => [x.opening, x.status, x.daysToFill]), [['CARP-2026-01', 'filled', 0], [second.code, 'open', null], [third.code, 'open', null]], 'REPORT-001 time to fill per opening, from its own open date')
    assert.equal((await send('/api/lodge/reports/openings', undefined, ivy)).status, 403)
    assert.deepEqual((await send('/api/lodge/download/handoff/' + named.id, undefined, manager)).value.opening, { id: 'CARP-2026-01', targetStart: '2027-01-11', openedAt: filled.openedAt, filledAt: filled.filledAt }, 'the HR handoff names the filled opening')

    // Closing an opening without a hire needs a reason.
    assert.equal((await send('/api/lodge/command/close-opening', { vacancy: job.id, opening: second.id }, manager)).status, 400)
    await cmd('close-opening', { vacancy: job.id, opening: second.id, reason: 'budget cut' }, manager)
    assert.deepEqual((({ status, closeReason, closedBy }) => [status, closeReason, closedBy])((await read()).openings.find(o => o.id === second.id)), ['closed', 'budget cut', 'morgan@example.test'])

    // A fourth opening raises the headcount and waits on LDG-001 approval; a refused one falls back to the approved three.
    await cmd('request-opening', { id: job.id, approver: 'parker@example.test', code: 'CARP-2026-04' }, manager)
    v = await read()
    const fourth = v.openings.find(o => o.code === 'CARP-2026-04')
    assert.deepEqual([v.headcount, fourth.status, v.approvedNow], [4, 'requested', false])
    assert.equal((await send('/api/lodge/command/offer', { ...unnamed, opening: fourth.id }, manager)).status, 409, 'a requested opening cannot be offered yet')
    await approve(v.approval.id)
    v = await read()
    assert.deepEqual(v.openings.map(o => o.status), ['filled', 'closed', 'open', 'open'])
    assert.ok(v.openings[3].openedAt > third.openedAt, 'the new opening opens from its own approval')
    await cmd('request-opening', { id: job.id, approver: 'parker@example.test' }, manager)
    const refusal = (await read()).approval
    await cmd('decide-approval', { id: refusal.id, decision: 'rejected', reason: 'No budget', version: (await state(approver)).approvals.find(x => x.id === refusal.id).currentVersion }, approver)
    v = await read()
    assert.deepEqual([v.headcount, v.openings.at(-1).status, v.approvedNow], [4, 'refused', true])
  })

  await t.test('SCREEN-001 a versioned question library: typed answers on the job, kept on the version answered; protected traits refused', async () => {
    const ask = (body, cookie = owner) => send('/api/lodge/command/question', body, cookie)
    const authorized = await cmd('question', { text: 'Are you legally authorized to work in the US?', type: 'yes-no' })
    const relocate = await cmd('question', { text: 'Willing to relocate?', type: 'single-choice', options: ['Yes', 'No', 'Within New York'] })
    const cdl = await cmd('question', { text: 'Years holding a Class A CDL', type: 'number' })
    const trades = await cmd('question', { text: 'Which trades have you worked?', type: 'multiple-choice', options: ['Framing', 'Finish carpentry', 'Concrete forms'], required: false })
    const ticket = await cmd('question', { text: 'Your OSHA 30 card', type: 'file', required: false })
    const story = await cmd('question', { text: 'Tell us about a job you finished early', type: 'long-text', required: false })
    assert.deepEqual([authorized, relocate, cdl, trades, story].map(q => q.versions[0].objective), [true, true, true, true, false], 'free text never drives a rule')
    for (const [body, pattern] of [[{ text: 'What is your age?', type: 'number' }, /protected trait/], [{ text: 'How old are you?', type: 'number' }, /protected trait/], [{ text: 'What is your date of birth?', type: 'date' }, /protected trait/], [{ text: 'Your current salary?', type: 'number' }, /salary-history/], [{ text: 'Pick one', type: 'single-choice', options: ['Only one'] }, /two different choices/]]) {
      const refused = await ask(body)
      assert.equal(refused.status, 400, body.text); assert.match(refused.value.error, pattern)
    }
    assert.equal((await ask({ text: 'Do you have a CDL?', type: 'yes-no' }, manager)).status, 403, 'admins keep the library')
    const attach = questions => send('/api/lodge/command/job-questions', { id: carpenter.id, questions }, manager)
    assert.equal((await send('/api/lodge/command/job-questions', { id: carpenter.id, questions: [{ question: cdl.id }] }, ivy)).status, 403)
    assert.equal((await attach([{ question: cdl.id }, { question: cdl.id }])).status, 400)
    assert.equal((await attach([{ question: authorized.id }, { question: relocate.id }, { question: cdl.id }, { question: trades.id }, { question: ticket.id }, { question: story.id, required: true }])).status, 200)

    const { slug: jobSlug } = (await state(manager)).vacancies.find(v => v.id === carpenter.id)
    const page = await send('/jobs/' + jobSlug)
    for (const q of ['Are you legally authorized to work in the US?', 'Willing to relocate?', 'Years holding a Class A CDL', 'Which trades have you worked? (optional)']) assert.ok(page.text.includes(q), q)
    assert.match(page.text, new RegExp(`name="q-${cdl.id}" type="number"`))
    const notice = page.text.match(/name="noticeVersion" value="(\d+)"/)[1]
    const apply = (name, email, answers, file) => {
      const f = new FormData()
      for (const [k, v] of Object.entries({ name, email, noticeVersion: notice, consent: 'yes' })) f.append(k, v)
      for (const [id, v] of Object.entries(answers)) for (const x of [v].flat()) f.append('q-' + id, x)
      if (file) f.append('q-' + ticket.id, new Blob([file], { type: 'text/plain' }), 'osha30.txt')
      return send('/jobs/' + jobSlug, f)
    }
    const first = { [authorized.id]: 'yes', [relocate.id]: 'Within New York', [cdl.id]: '4', [trades.id]: ['Framing', 'Concrete forms'], [story.id]: 'Closed out a framing job a week early.' }
    assert.equal((await apply('Vic Moreno', 'vic@example.test', { ...first, [cdl.id]: '' })).status, 400, 'a required answer is missing')
    assert.equal((await apply('Vic Moreno', 'vic@example.test', { ...first, [cdl.id]: 'four' })).status, 400, 'a number is a number')
    assert.equal((await apply('Vic Moreno', 'vic@example.test', { ...first, [relocate.id]: 'Anywhere' })).status, 400, 'a choice is one of the choices')
    const received = await apply('Vic Moreno', 'vic@example.test', first, 'OSHA 30 card 2024')
    assert.equal(received.status, 200, received.text.slice(0, 600))

    // Editing a question saves a new version; the earlier application keeps the version it answered.
    await cmd('question', { id: cdl.id, text: 'Years holding a Class A commercial driver’s license', type: 'number' })
    assert.equal((await apply('Wren Ito', 'wren@example.test', { ...first, [authorized.id]: 'no', [cdl.id]: '0.5', [trades.id]: [] })).status, 200)
    const apps = (await state(manager)).applications.filter(x => x.vacancy === carpenter.id)
    const answer = (who, q) => apps.find(x => x.candidateName === who).answers.find(a => a.question === q.id)
    assert.deepEqual((({ version, text, value }) => [version, text, value])(answer('Vic Moreno', cdl)), [1, 'Years holding a Class A CDL', 4])
    assert.deepEqual((({ version, text, value }) => [version, text, value])(answer('Wren Ito', cdl)), [2, 'Years holding a Class A commercial driver’s license', 0.5])
    assert.deepEqual([answer('Vic Moreno', authorized).value, answer('Wren Ito', authorized).value, answer('Vic Moreno', trades).value], ['yes', 'no', ['Framing', 'Concrete forms']])
    assert.equal(answer('Wren Ito', trades), undefined, 'an optional question left blank is not an answer')
    const file = answer('Vic Moreno', ticket).value
    assert.equal((await send('/api/lodge/download/document/' + file.document, undefined, manager)).text, 'OSHA 30 card 2024')
  })

  await t.test('REQ-004 departments and offices: jobs, openings and members attach; the careers page filters; a manager granted Operations runs only Operations', async () => {
    const ops = await cmd('department', { name: 'Operations' }), eng = await cmd('department', { name: 'Engineering' })
    const yard = await cmd('department', { name: 'Warehouse', parent: ops.id })
    assert.equal((await send('/api/lodge/command/department', { name: 'warehouse', parent: ops.id }, owner)).status, 409, 'sibling names are unique')
    assert.equal((await send('/api/lodge/command/department', { id: ops.id, name: 'Operations', parent: yard.id }, owner)).status, 409, 'no department inside itself')
    assert.equal((await send('/api/lodge/command/department', { name: 'Finance' }, manager)).status, 403, 'admins keep the hierarchy')
    const denver = await cmd('office', { name: 'Denver, CO' }), remote = await cmd('office', { name: 'Remote (US)' }), spare = await cmd('office', { name: 'Austin, TX' })
    const job = async (title, departmentId, officeId) => {
      const v = await cmd('vacancy', { title, departmentId, officeId, headcount: 1, manager: 'morgan@example.test', compensation: RANGE }, manager)
      await cmd('rubric', { id: v.id, criteria: RUBRIC }, manager)
      await cmd('interview-plan', { id: v.id, plan: [{ name: 'Walk', stageName: 'Interview', durationMinutes: 45 }] }, manager)
      await approve((await cmd('request-vacancy-approval', { id: v.id, approver: 'parker@example.test' }, manager)).id)
      return cmd('publish', { id: v.id }, manager)
    }
    const picker = await job('Picker', yard.id, denver.id), platform = await job('Platform engineer', eng.id, remote.id)
    assert.deepEqual([picker.department, picker.location], ['Operations › Warehouse', 'Denver, CO'])
    // Renaming keeps the earlier name; the job keeps its link and its approved text.
    await cmd('department', { id: yard.id, name: 'Warehouse & Yard', parent: ops.id })
    const view = await state(manager)
    assert.deepEqual(view.departments.find(d => d.id === yard.id).names.map(n => n.name), ['Warehouse'])
    assert.deepEqual((({ departmentId, approvedNow }) => [departmentId, approvedNow])(view.vacancies.find(v => v.id === picker.id)), [yard.id, true])

    // The careers page filters by department (with sub-departments) and by office, openings included.
    const titles = async query => [...(await send('/jobs' + query)).text.matchAll(/<li><a href="\/jobs\/[^"]+">([^<]+)<\/a>/g)].map(m => m[1]).sort()
    assert.deepEqual(await titles(`?department=${ops.id}`), ['Picker'])
    assert.deepEqual(await titles(`?office=${remote.id}`), ['Platform engineer'])
    assert.match((await send('/jobs')).text, /<label>Department<select name="department">/)
    await cmd('candidate', { name: 'Pia Lund', email: 'pia@example.test', source: 'Referral', consentBasis: 'referral', vacancy: picker.id }, manager)
    const report = async query => (await send('/api/lodge/reports/openings' + query, undefined, manager)).value
    const byOps = await report(`?department=${ops.id}`), byRemote = await report(`?office=${remote.id}`)
    assert.deepEqual([byOps.jobs.map(j => j.title), byOps.funnel.applicants, byOps.funnel.active], [['Picker'], 1, 1], 'the REPORT-001 funnel filtered by department')
    assert.deepEqual([byRemote.jobs.map(j => j.title), byRemote.funnel.applicants], [['Platform engineer'], 0], 'and by office')
    await cmd('opening', { vacancy: picker.id, opening: picker.openings[0].id, code: 'PICK-01', office: remote.id }, manager)
    assert.deepEqual(await titles(`?office=${remote.id}`), ['Picker', 'Platform engineer'])

    // A manager granted Operations runs every Operations job and reaches no Engineering job through any door.
    const mona = await h.member('mona@example.test', ['manager'], 'Mona Diaz')
    assert.equal((await send('/api/lodge/command/member-org', { email: 'ivy@example.test', grantDepartments: [ops.id] }, owner)).status, 409, 'grants are for managers')
    await cmd('member-org', { email: 'mona@example.test', department: ops.id, office: denver.id, grantDepartments: [ops.id] })
    const monaView = await state(mona)
    assert.deepEqual(monaView.vacancies.map(v => [v.title, v.manages]), [['Picker', true]])
    assert.deepEqual((await send('/api/lodge/search?q=Platform', undefined, mona)).value.results, [])
    assert.equal((await send(`/api/lodge/download/vacancy/${platform.id}`, undefined, mona)).status, 404)
    assert.equal((await send(`/api/lodge/download/vacancy/${picker.id}`, undefined, mona)).status, 200)
    assert.equal((await send('/api/lodge/command/close-opening', { vacancy: platform.id, opening: platform.openings[0].id, reason: 'x' }, mona)).status, 403)
    await cmd('member-org', { email: 'mona@example.test', department: ops.id, office: denver.id, grantDepartments: [] })
    assert.deepEqual((await state(mona)).vacancies, [], 'removing the grant removes access at once')

    // Deleting what is still in use is refused; an unused office goes.
    for (const [kind, id] of [['office', denver.id], ['office', remote.id], ['department', ops.id], ['department', yard.id]]) assert.equal((await send('/api/lodge/command/delete-org', { kind, id }, owner)).status, 409, kind + ' in use')
    await cmd('delete-org', { kind: 'office', id: spare.id })
    assert.equal((await state()).offices.some(o => o.id === spare.id), false)
  })

  await t.test('SCREEN-002 rules on objective answers route, tag and queue rejections; edits never re-run past applications except by preview and apply', async () => {
    const library = (await state()).questions, q = text => library.find(x => x.versions[0].text === text).id
    const [authorized, relocate, cdl, story] = [q('Are you legally authorized to work in the US?'), q('Willing to relocate?'), q('Years holding a Class A CDL'), q('Tell us about a job you finished early')]
    const stages = (await state(manager)).vacancies.find(v => v.id === carpenter.id).stages
    const rule = (body, cookie = owner) => send('/api/lodge/command/screening-rule', { vacancy: carpenter.id, ...body }, cookie)
    assert.equal((await rule({ name: 'x', question: authorized, when: { equals: 'no' }, then: { kind: 'tag', tag: 'x' } }, manager)).status, 403, 'admins author rules')
    assert.equal((await rule({ name: 'x', question: story, when: { equals: 'yes' }, then: { kind: 'tag', tag: 'x' } })).status, 409, 'free text never drives a rule')
    const noAuth = (await rule({ name: 'Work authorization', question: authorized, when: { equals: 'no' }, then: { kind: 'propose-reject', reason: 'Not authorized to work in the US', closeReason: 'work-authorization', send: 'delay', businessDays: 2, template: declineTemplate.id } })).value
    const cdlRoute = (await rule({ name: 'Short CDL', question: cdl, when: { min: 1, below: 3 }, then: { kind: 'route', stage: stages[1].id } })).value
    await rule({ name: 'New York only', question: relocate, when: { equals: ['Within New York'] }, then: { kind: 'tag', tag: 'NY only' } })

    const { slug: jobSlug } = (await state(manager)).vacancies.find(v => v.id === carpenter.id)
    const notice = (await send('/jobs/' + jobSlug)).text.match(/name="noticeVersion" value="(\d+)"/)[1]
    const apply = async (name, answers) => {
      const f = new FormData()
      for (const [k, v] of Object.entries({ name, email: name.split(' ')[0].toLowerCase() + '@example.test', noticeVersion: notice, consent: 'yes', ['q-' + story]: 'Finished a deck early.', ...answers })) f.append(k, v)
      assert.equal((await send('/jobs/' + jobSlug, f)).status, 200)
      return (await state(manager)).applications.find(x => x.candidateName === name)
    }
    const hit = await apply('Xena Park', { ['q-' + authorized]: 'no', ['q-' + relocate]: 'Within New York', ['q-' + cdl]: '2' })
    const miss = await apply('Yuri Long', { ['q-' + authorized]: 'yes', ['q-' + relocate]: 'No', ['q-' + cdl]: '5' })
    assert.deepEqual([hit.status, hit.stage, hit.tags], ['active', stages[1].id, ['NY only']], 'routed and tagged, still a person’s decision')
    assert.deepEqual([miss.status, miss.stage, miss.tags], ['active', stages[0].id, undefined], 'a near miss is untouched')
    let queue = (await state(manager)).ruleMatches.filter(m => m.status === 'queued')
    assert.deepEqual(queue.map(m => [m.application, m.ruleName, m.version, m.question, m.answer, m.intakePath, m.reason, m.templateName]), [[hit.id, 'Work authorization', 1, 'Are you legally authorized to work in the US?', 'no', 'Careers page', 'Not authorized to work in the US', 'Standard decline']])
    assert.deepEqual((await state(ivy)).ruleMatches, [], 'the queue is for the people who run the job')

    // An edited rule applies to later applications; earlier ones change only through an explicit preview and apply.
    await rule({ id: cdlRoute.id, name: 'Short CDL', question: cdl, when: { below: 1 }, then: { kind: 'route', stage: stages[2].id } })
    const preview = (await send('/api/lodge/command/preview-rule', { id: cdlRoute.id }, owner)).value
    const wren = (await state(manager)).applications.find(x => x.candidateName === 'Wren Ito')
    assert.deepEqual(preview.applications, [{ application: wren.id, answer: 0.5 }])
    assert.equal((await state(manager)).applications.find(x => x.id === wren.id).stage, wren.stage, 'a preview changes nothing')
    await cmd('apply-rule', { id: cdlRoute.id, applications: [wren.id] })
    assert.equal((await state(manager)).applications.find(x => x.id === wren.id).stage, stages[2].id)
    assert.equal((await state(manager)).applications.find(x => x.id === hit.id).stage, stages[1].id, 'the earlier routing stands')

    // A recruiter confirms the queued rejection and is recorded as the decider.
    assert.equal((await send('/api/lodge/command/decide-rule-matches', { id: queue[0].id, decision: 'confirm' }, ivy)).status, 403)
    await cmd('decide-rule-matches', { id: queue[0].id, decision: 'confirm' }, manager)
    let s = await state(manager)
    assert.equal(s.applications.find(x => x.id === hit.id).status, 'rejected')
    assert.deepEqual((({ status, decidedBy }) => [status, decidedBy])(s.ruleMatches.find(m => m.id === queue[0].id)), ['confirmed', 'morgan@example.test'])

    // An admin approves the rule for automatic rejection: later answers close with the version and approver recorded.
    await cmd('approve-auto-reject', { id: noAuth.id })
    const auto = await apply('Zane Fox', { ['q-' + authorized]: 'no', ['q-' + relocate]: 'No', ['q-' + cdl]: '6' })
    s = await state(manager)
    assert.equal(auto.status, 'rejected')
    assert.deepEqual((({ status, version, approvedBy }) => [status, version, approvedBy])(s.ruleMatches.find(m => m.application === auto.id)), ['auto-rejected', 1, 'owner@example.test'])
    // Wren answered before the approval: applying the rule to her only queues it; the whole queue is confirmed in one action.
    await cmd('apply-rule', { id: noAuth.id, applications: [wren.id] })
    assert.equal((await state(manager)).applications.find(x => x.id === wren.id).status, 'active')
    await cmd('decide-rule-matches', { vacancy: carpenter.id, all: true, decision: 'confirm' }, manager)
    s = await state(manager)
    assert.equal(s.applications.find(x => x.id === wren.id).status, 'rejected')
    // DISP-001: every rule close, confirmed or automatic, carries the rule's listed reason and schedules its template after the delay.
    assert.deepEqual([hit.id, auto.id, wren.id].map(id => s.applications.find(x => x.id === id).history.at(-1).closeReason), ['work-authorization', 'work-authorization', 'work-authorization'])
    assert.deepEqual([hit.id, auto.id, wren.id].map(id => s.rejectionEmails.filter(m => m.application === id).map(m => [m.templateName, m.businessDays, m.state])), [hit.id, auto.id, wren.id].map(() => [['Standard decline', 2, 'scheduled']]))
  })

  await t.test('REQ-003 a job names its hiring team; each sees and hears only that job, and a swap moves reminders and access at once', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: BUSINESS.timeZone })
    const job = async (title, manager) => {
      const v = await cmd('vacancy', { title, location: 'Newark, NJ', headcount: 1, manager, compensation: RANGE })
      await cmd('rubric', { id: v.id, criteria: RUBRIC })
      await cmd('interview-plan', { id: v.id, plan: [{ name: 'Walk', stageName: 'Interview', durationMinutes: 45 }] })
      await approve((await cmd('request-vacancy-approval', { id: v.id, approver: 'parker@example.test' })).id)
      return cmd('publish', { id: v.id })
    }
    const yard = await job('Yard lead', 'morgan@example.test'), dock = await job('Dock clerk', 'mona@example.test')
    const team = []
    for (const [n, roles] of [['rory', ['manager']], ['coco', ['manager']], ['cleo', ['manager']], ['hal', ['manager']], ['sol', ['interviewer']], ['neve', ['manager']]]) team.push(await h.member(`${n}@example.test`, roles, n[0].toUpperCase() + n.slice(1) + ' Team'))
    const [rory, coco, cleo, hal, sol, neve] = team
    const mona = await h.signIn('mona@example.test')
    const { application: yardApp } = await cmd('candidate', { name: 'Tess Yardley', email: 'tess@example.test', source: 'Referral', consentBasis: 'referral', vacancy: yard.id })
    const { application: dockApp } = await cmd('candidate', { name: 'Dov Clerkson', email: 'dov@example.test', source: 'Referral', consentBasis: 'referral', vacancy: dock.id })
    const setTeam = (body, cookie = owner) => send('/api/lodge/command/hiring-team', { id: yard.id, ...body }, cookie)
    assert.equal((await setTeam({ recruiters: ['rory@example.test'] }, manager)).status, 403, 'the owner and hiring admins set the team')
    assert.match((await setTeam({ recruiters: ['ivy@example.test'] })).value.error, /needs the manager or admin role/)
    await cmd('hiring-team', { id: yard.id, recruiters: ['rory@example.test'], coordinators: ['coco@example.test'], hiringManagers: ['hal@example.test'], sourcers: ['sol@example.test'] })

    // A recruiter, a coordinator and two hiring managers each see this job's items and none of the other job's, through state and search.
    for (const who of [rory, coco, hal, manager]) {
      const view = await state(who)
      assert.ok(view.applications.some(x => x.id === yardApp.id && x.manages), 'the yard team runs the yard job')
      assert.ok(!view.applications.some(x => x.id === dockApp.id) && !JSON.stringify(view).includes('Dov Clerkson'))
      assert.deepEqual((await send('/api/lodge/search?q=Clerkson', undefined, who)).value.results, [])
    }
    assert.ok(!JSON.stringify(await state(mona)).includes('Tess Yardley'), 'the other job’s manager sees nothing of this one')
    await cmd('move', { application: yardApp.id, to: yard.stages[1].id, reason: 'Coordinator screened her' }, coco)
    // Notified only about this job: each reminder reaches its owner, and a scorecard correction reaches both hiring managers.
    const remind = await cmd('task', { application: yardApp.id, note: 'Confirm her yard walk', due: today, owner: 'coco@example.test' }, rory)
    const chase = await cmd('task', { application: yardApp.id, note: 'Chase her references', due: today, owner: 'hal@example.test' }, rory)
    await cmd('task', { application: dockApp.id, note: 'Dock reminder', due: today }, mona)
    assert.match((await send('/api/lodge/command/task', { application: yardApp.id, note: 'x', due: today, owner: 'neve@example.test' }, rory)).value.error, /cannot see this candidate/)
    const due = async who => (await state(who)).notifications.filter(n => n.kind === 'task-due').map(n => n.task)
    assert.deepEqual([await due(coco), await due(hal), await due(rory)], [[remind.id], [chase.id], []])
    await cmd('assign-reviewers', { application: yardApp.id, reviewers: ['ivy@example.test'] }, coco)
    const criteria = (await state(manager)).vacancies.find(x => x.id === yard.id).rubrics[0].criteria
    const rated = { ratings: Object.fromEntries(criteria.map(c => [c.id, 3])), evidence: Object.fromEntries(criteria.map(c => [c.id, 'Ran the yard'])) }
    const card = await cmd('scorecard', { application: yardApp.id, ...rated, recommendation: 'yes', takeaways: 'Steady lead', submit: true }, ivy)
    await cmd('release-feedback', { application: yardApp.id }, hal)
    await cmd('correct-scorecard', { scorecard: card.id, ...rated, reason: 'Added the forklift answer' }, ivy)
    const told = async who => (await state(who)).notifications.filter(n => n.kind === 'scorecard-corrected' && n.application === yardApp.id).length
    assert.deepEqual([await told(manager), await told(hal), await told(rory), await told(coco), await told(mona)], [1, 1, 0, 0, 0], 'notices go to each hiring manager on the job')
    // Running the job stops at approving offers and terms, which stay with the approver role.
    const offer = await cmd('offer', { application: yardApp.id, title: 'Yard lead', startDate: '2027-02-01', salary: { currency: 'USD', amount: 10000000, period: 'year' } }, rory)
    assert.match((await send('/api/lodge/command/request-offer-approval', { id: offer.id, approver: 'rory@example.test' }, rory)).value.error, /approver role/)
    // A sourcer sees the job and who is on it, as names and current stage only, and adds candidates to it;
    // no application content, contact, scorecard, note or offer reaches them.
    await cmd('team-note', { application: yardApp.id, text: 'YARD-NOTE shared with the team' }, rory)
    const sourced = await state(sol)
    assert.deepEqual(sourced.vacancies.map(x => [x.title, x.manages, x.sources, x.pipeline]), [['Yard lead', false, true, [{ candidateName: 'Tess Yardley', stage: 'Screen' }]]])
    assert.ok(!sourced.applications.length && !sourced.candidates.length && !sourced.scorecards.length && !sourced.offers.length && !sourced.teamNotes.length)
    for (const hidden of [yardApp.id, 'tess@example.test', 'Steady lead', 'YARD-NOTE', offer.id, 'Coordinator screened her']) assert.ok(!JSON.stringify(sourced).includes(hidden), hidden)
    assert.equal((await send(`/api/lodge/download/activity/${yardApp.candidate}`, undefined, sol)).status, 404)
    assert.equal((await send('/api/lodge/command/candidate', { name: 'Sam Sourced', source: 'LinkedIn search', consentBasis: 'manual', vacancy: yard.id }, sol)).status, 200)
    assert.deepEqual((await state(sol)).vacancies[0].pipeline.map(x => [x.candidateName, x.stage]), [['Sam Sourced', 'Applied'], ['Tess Yardley', 'Screen']])
    assert.ok(!(await state(rory)).vacancies.find(x => x.id === yard.id).pipeline, 'the list is the sourcer’s view; the people who run the job see the applications')
    assert.equal((await send('/api/lodge/command/candidate', { name: 'Sam Elsewhere', source: 'LinkedIn search', consentBasis: 'manual', vacancy: dock.id }, sol)).status, 403)
    assert.equal((await send('/api/lodge/command/team-note', { application: yardApp.id, text: 'x' }, sol)).status, 404)

    // Swap the coordinator: the pending reminder moves to the new one, and the old one loses access at once through the app, API, search and export.
    await cmd('hiring-team', { id: yard.id, recruiters: ['rory@example.test'], coordinators: ['cleo@example.test'], hiringManagers: ['hal@example.test'], sourcers: ['sol@example.test'] })
    const moved = (await state(cleo)).tasks.find(x => x.id === remind.id)
    assert.deepEqual([moved.owner, moved.history.map(e => [e.from, e.to])], ['cleo@example.test', [['coco@example.test', 'cleo@example.test']]])
    assert.deepEqual(await due(cleo), [remind.id])
    const old = await state(coco)
    assert.ok(!old.vacancies.length && !old.applications.length && !old.tasks.length && !JSON.stringify(old).includes('Tess Yardley'), 'the app')
    assert.equal((await send('/api/lodge/command/move', { application: yardApp.id, to: yard.stages[2].id, reason: 'x' }, coco)).status, 404, 'the API')
    assert.deepEqual((await send('/api/lodge/search?q=Yardley', undefined, coco)).value.results, [], 'search')
    for (const path of [`/api/lodge/download/vacancy/${yard.id}`, `/api/lodge/download/activity/${yardApp.candidate}`]) assert.equal((await send(path, undefined, coco)).status, 404, 'export')
    // Taking someone off without a replacement hands their reminders to the first recruiter, then to the hiring manager.
    await cmd('hiring-team', { id: yard.id, recruiters: ['rory@example.test'], coordinators: ['cleo@example.test'], sourcers: ['sol@example.test'] })
    assert.equal((await state(rory)).tasks.find(x => x.id === chase.id).owner, 'rory@example.test')
    await cmd('hiring-team', { id: yard.id, coordinators: ['cleo@example.test'] })
    assert.equal((await state(manager)).tasks.find(x => x.id === chase.id).owner, 'morgan@example.test')
    assert.ok(!(await state(sol)).vacancies.length, 'a removed sourcer no longer sees the job')
    // On a confidential job the hiring team counts as named.
    await cmd('vacancy-privacy', { id: yard.id, confidential: true, namedPeople: [] })
    assert.ok((await state(cleo)).vacancies.some(x => x.id === yard.id && x.manages))
    assert.ok(!(await state(neve)).vacancies.some(x => x.id === yard.id))
  })

  await t.test('REQ-002 job templates and clones: jobs keep what they copied; a clone carries no candidates, approvals or openings and needs its own approval', async () => {
    const library = (await state()).questions, q = text => library.find(x => x.versions[0].text === text).id
    const authorized = q('Are you legally authorized to work in the US?')
    // A job set up the long way: stages, rubric, an interview with its kit, a screening question and a rule.
    const base = await cmd('vacancy', { title: 'Associate (setup)', location: 'Newark, NJ', headcount: 1, manager: 'morgan@example.test', compensation: RANGE })
    await cmd('rubric', { id: base.id, criteria: RUBRIC })
    await cmd('interview-plan', { id: base.id, plan: [{ name: 'Floor walk', stageName: 'Interview', durationMinutes: 30, purpose: 'See how they move a pallet safely', questions: [{ text: 'Walk me through a near miss', guidance: 'Listens for reporting it' }] }] })
    await cmd('job-questions', { id: base.id, questions: [{ question: authorized, required: true }] }, manager)
    await cmd('screening-rule', { vacancy: base.id, name: 'Work authorization', question: authorized, when: { equals: 'no' }, then: { kind: 'propose-reject', reason: 'Not authorized to work in the US', closeReason: 'work-authorization' } })
    assert.equal((await send('/api/lodge/command/job-template', { name: 'Warehouse Associate', fromVacancy: base.id }, manager)).status, 403, 'admins keep templates')
    const tpl = await cmd('job-template', { name: 'Warehouse Associate', fromVacancy: base.id, team: { coordinators: ['cleo@example.test'] } })
    assert.equal((await send('/api/lodge/command/job-template', { name: 'warehouse associate', fromVacancy: base.id }, owner)).status, 409, 'template names are unique')
    assert.deepEqual([tpl.plan[0].purpose, tpl.plan[0].questions[0].text, tpl.questions.map(x => x.question), tpl.rules.map(r => r.name), tpl.team.coordinators], ['See how they move a pallet safely', 'Walk me through a near miss', [authorized], ['Work authorization'], ['cleo@example.test']])

    // Two location jobs from the template, each copying its stages, rubric, plan and kits, questions, rule and team.
    const denver = await cmd('vacancy-from-template', { template: tpl.id, title: 'Warehouse Associate', location: 'Denver, CO', headcount: 1, manager: 'morgan@example.test', compensation: RANGE }, manager)
    const austin = await cmd('vacancy-from-template', { template: tpl.id, title: 'Warehouse Associate', location: 'Austin, TX', headcount: 1, manager: 'morgan@example.test', compensation: RANGE })
    const setup = async id => {
      const w = await state(), v = w.vacancies.find(x => x.id === id)
      return { stages: v.stages.map(x => x.name), rubric: v.rubrics.map(r => [r.version, r.criteria.map(c => c.name)]), kit: v.plan.map(p => [p.name, p.purpose, p.questions.length]), questions: v.questions.map(x => x.question), team: v.team.coordinators, rules: w.screeningRules.filter(r => r.vacancy === id).map(r => [r.name, r.versions.length, r.auto]), approval: v.approval, openings: (v.openings ?? []).length, applications: w.applications.filter(x => x.vacancy === id).length }
    }
    const copied = { stages: ['Applied', 'Screen', 'Interview', 'Decision'], rubric: [[1, ['Site safety', 'Scheduling']]], kit: [['Floor walk', 'See how they move a pallet safely', 1]], questions: [authorized], team: ['cleo@example.test'], rules: [['Work authorization', 1, null]], approval: null, openings: 0, applications: 0 }
    assert.deepEqual(await setup(denver.id), copied)
    assert.deepEqual(await setup(austin.id), copied)
    // Changing the template's rubric is its next version; both jobs keep theirs.
    const edited = await cmd('job-template', { id: tpl.id, criteria: [{ name: 'Forklift', description: 'Holds a current forklift certificate' }] })
    assert.deepEqual(edited.rubrics.map(r => [r.version, r.criteria.map(c => c.name)]), [[1, ['Site safety', 'Scheduling']], [2, ['Forklift']]])
    for (const id of [denver.id, austin.id]) assert.deepEqual((await setup(id)).rubric, [[1, ['Site safety', 'Scheduling']]])

    // Denver is approved, opens, takes a candidate and fills nothing yet; its clone carries none of that and needs its own approval.
    await approve((await cmd('request-vacancy-approval', { id: denver.id, approver: 'parker@example.test' }, manager)).id)
    await cmd('publish', { id: denver.id }, manager)
    await cmd('candidate', { name: 'Gia Pallets', email: 'gia@example.test', source: 'Referral', consentBasis: 'referral', vacancy: denver.id }, manager)
    const clone = await cmd('clone-vacancy', { id: denver.id, title: 'Warehouse Associate (Aurora)', location: 'Aurora, CO' }, manager)
    assert.deepEqual([clone.status, clone.clonedFrom, clone.title, clone.location, clone.compensation, clone.kickoff ?? null], ['draft', denver.id, 'Warehouse Associate (Aurora)', 'Aurora, CO', RANGE, null])
    assert.deepEqual(await setup(clone.id), copied)
    assert.equal((await send('/api/lodge/command/publish', { id: clone.id }, manager)).status, 409, 'the clone needs its own approval')
    const denverNow = await setup(denver.id)
    assert.deepEqual([denverNow.applications, denverNow.openings, denverNow.approval.status], [1, 1, 'approved'], 'the source keeps its candidate, opening and approval')
    await approve((await cmd('request-vacancy-approval', { id: clone.id, approver: 'parker@example.test' }, manager)).id)
    assert.equal((await cmd('publish', { id: clone.id }, manager)).status, 'open')
  })

  await t.test('LDG-016 every private route checks the live session, origin and saved role', async () => {
    assert.equal((await send('/api/lodge/state')).status, 401)
    assert.equal((await send('/api/lodge/state', undefined, owner, { 'sec-fetch-site': 'cross-site' })).status, 403)
    assert.equal((await send('/api/lodge/command/member', { email: 'x@example.test', name: 'X', roles: ['admin'] }, owner, { origin: 'https://evil.example' })).status, 403)
    assert.equal((await send('/api/lodge/command/nope', {}, owner)).status, 404)
    assert.equal((await send('/api/lodge/command/member', { email: 'eve@example.test', name: 'Eve', roles: ['admin'] }, manager)).status, 403)
    assert.equal((await send('/api/lodge/import/preview', { filename: 'x.zip', base64: 'AA==' }, manager)).status, 403)
    await cmd('member', { email: 'ian@example.test', name: 'Ian Ruiz', roles: ['interviewer'], active: false })
    assert.equal((await send('/api/lodge/state', undefined, ian)).status, 403, 'deactivation refuses the private route at once')
    const before = await h.db.prepare('SELECT COUNT(*) AS n FROM l_records').first()
    assert.equal((await send('/api/lodge/command/vacancy', { title: 'Sneaky', manager: 'ian@example.test' }, ian)).status, 403)
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM l_records').first()).n, before.n, 'refusals change nothing')
  })
})
