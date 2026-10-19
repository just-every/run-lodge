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

  const openJob = async (title, location = 'Denver, CO') => {
    const draft = await cmd('vacancy', { title, location, headcount: 1, compensation: RANGE, manager: 'morgan@example.test' }, manager)
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

  await t.test('REVIEW-001 a review queue of new applications: the manager advances, rejects and skips; a reviewer only recommends', async () => {
    const job = await openJob('Roofer')
    const apps = []
    for (const name of ['Ada Brook', 'Ben Cruz', 'Cal Dunn', 'Dee Ewing', 'Eve Frost']) apps.push((await cmd('candidate', { name, email: name.split(' ')[0].toLowerCase() + '.roof@example.test', source: 'Careers page', consentBasis: 'application', vacancy: job.id }, manager)).application)
    for (const app of apps.slice(3)) await cmd('assign-reviewers', { application: app.id, reviewers: ['ivy@example.test'] }, manager)
    const queueOf = async cookie => (await state(cookie)).reviewQueues.find(q => q.vacancy === job.id)
    let q = await queueOf(manager)
    assert.deepEqual([q.manages, q.remaining, q.queue], [true, 5, apps.map(a => a.id)], 'oldest first, one at a time')

    // The manager advances two, rejects one with a DISP-001 reason and skips one.
    const decide = (app, body, cookie = manager) => send('/api/lodge/command/review-decision', { application: app.id, ...body }, cookie)
    for (const app of apps.slice(0, 2)) assert.equal((await decide(app, { decision: 'advance' })).status, 200)
    assert.equal((await decide(apps[2], { decision: 'reject' })).status, 400, 'a rejection needs a listed reason')
    assert.equal((await decide(apps[2], { decision: 'reject', closeReason: 'skills', reason: 'No roofing work' })).status, 200)
    assert.equal((await decide(apps[3], { decision: 'skip' })).status, 200)
    assert.equal((await decide(apps[0], { decision: 'advance' })).status, 409, 'an advanced application has left the queue')
    q = await queueOf(manager)
    assert.deepEqual([q.remaining, q.queue], [2, [apps[4].id, apps[3].id]], 'the skipped application waits at the back')
    let s = await state(manager)
    const last = id => s.applications.find(a => a.id === id).history.at(-1)
    assert.deepEqual(apps.slice(0, 2).map(a => [last(a.id).to, last(a.id).reason, last(a.id).actor]), apps.slice(0, 2).map(() => [job.stages[1].id, 'Advanced from the review queue', 'morgan@example.test']))
    assert.deepEqual([last(apps[2].id).to, last(apps[2].id).reason, last(apps[2].id).note], ['rejected', 'Skills or experience do not match', 'No roofing work'])
    assert.equal(last(apps[3].id).to, job.stages[0].id, 'a skip changes nothing')

    // An assigned interviewer reviewer sees only their applications and records recommendations; advance is refused.
    q = await queueOf(ivy)
    assert.deepEqual([q.manages, q.remaining, q.queue.sort()], [false, 2, [apps[3].id, apps[4].id].sort()])
    assert.equal((await decide(apps[3], { decision: 'advance' }, ivy)).status, 403)
    assert.equal((await send('/api/lodge/command/review-recommendation', { application: apps[3].id, recommendation: 'yes' }, ian)).status, 404, 'an unassigned interviewer cannot see it')
    assert.equal((await send('/api/lodge/command/review-recommendation', { application: apps[3].id, recommendation: 'yes' }, manager)).status, 409, 'the manager decides instead')
    await cmd('review-recommendation', { application: apps[3].id, recommendation: 'maybe', note: 'Some flat-roof work' }, ivy)
    q = await queueOf(ivy)
    assert.deepEqual([q.remaining, q.queue, q.reviews.map(r => [r.application, r.recommendation])], [1, [apps[4].id], [[apps[3].id, 'maybe']]])
    assert.equal(last(apps[3].id).to, job.stages[0].id, 'a recommendation moves nothing')
    // The manager sees who reviewed what; the queue count is what their home shows.
    q = await queueOf(manager)
    assert.deepEqual(q.reviews.map(r => [r.application, r.by, r.decision ?? r.recommendation]), [[apps[0].id, 'morgan@example.test', 'advance'], [apps[1].id, 'morgan@example.test', 'advance'], [apps[2].id, 'morgan@example.test', 'reject'], [apps[3].id, 'morgan@example.test', 'skip'], [apps[3].id, 'ivy@example.test', 'maybe']])
    assert.equal(q.remaining, 2)
    await cmd('review-recommendation', { application: apps[4].id, recommendation: 'no' }, ivy)
    assert.equal((await queueOf(ivy)).remaining, 0, 'nothing left on the reviewer’s home')
    assert.equal((await state(ian)).reviewQueues.some(x => x.vacancy === job.id), false)
    for (const app of apps.slice(3)) await cmd('move', { application: app.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Queue test done' }, manager)
    assert.equal((await queueOf(manager)).remaining, 0)
  })

  await t.test('PIPE-001 the job board: stage counts and days in stage from the history, per-person saved filters and sort, a needs-decision flag, moves with reasons', async () => {
    const job = await openJob('Glazier')
    assert.ok(job.stages.length >= 4, 'four stages to fill')
    // Ten candidates in four stages; [stage, days in it]. Odd ones came from a trade show.
    const placed = [[0, 0], [0, 2], [0, 5], [1, 1], [1, 3], [1, 8], [2, 4], [2, 6], [3, 2], [3, 9]], apps = []
    for (const [i, [stage, days]] of placed.entries()) {
      const { application } = await cmd('candidate', { name: `Glen Pane ${i}`, email: `glen${i}.pane@example.test`, source: i % 2 ? 'Trade show' : 'Careers page', consentBasis: 'application', vacancy: job.id }, manager)
      if (stage) await cmd('move', { application: application.id, to: job.stages[stage].id, reason: 'Placed for the board' }, manager)
      apps.push({ ...application, stage, days })
    }
    // Age the stored history: each arrived 20 days ago (or `days` ago when still in the first stage) and entered its stage `days` ago.
    const ago = d => new Date(Date.now() - d * 86400000 - 3600000).toISOString()
    for (const a of apps) {
      const arrived = ago(a.stage ? 20 : a.days)
      await h.db.prepare("UPDATE l_records SET value=json_set(value,'$.at',?) WHERE kind='stage-event' AND json_extract(value,'$.application')=? AND json_extract(value,'$.to')=?").bind(arrived, a.id, job.stages[0].id).run()
      await h.db.prepare("UPDATE l_records SET value=json_set(value,'$.at',?) WHERE kind='stage-event' AND json_extract(value,'$.application')=? AND json_extract(value,'$.to')=?").bind(ago(a.days), a.id, job.stages[a.stage].id).run()
      await h.db.prepare("UPDATE l_records SET value=json_set(value,'$.submittedAt',?) WHERE kind='application' AND id=?").bind(arrived, a.id).run()
    }
    const boardOf = async (cookie = manager) => { const r = await send('/api/lodge/board/' + job.id, undefined, cookie); assert.equal(r.status, 200, JSON.stringify(r.value)); return r.value }
    const cards = b => b.columns.flatMap(c => c.cards)
    let b = await boardOf()
    assert.deepEqual(b.columns.map(c => [c.name, c.cards.length, c.total]), [...job.stages.map((st, i) => [st.name, [3, 3, 2, 2][i] ?? 0, [3, 3, 2, 2][i] ?? 0]), ['Closed', 0, 0]])
    const history = new Map((await state(manager)).applications.map(x => [x.id, x.history]))
    for (const a of apps) {
      const card = cards(b).find(c => c.application === a.id)
      assert.deepEqual([card.stage, card.enteredStage, card.daysInStage], [job.stages[a.stage].id, history.get(a.id).at(-1).at, a.days], 'days in stage count from the move into it in the history')
      assert.equal(card.lastActivity, history.get(a.id).at(-1).at)
    }
    assert.deepEqual(b.columns[1].cards.map(c => c.daysInStage), [1, 3, 8], 'last activity first by default')

    // A filter by source and a sort are saved for this manager on this job only.
    assert.deepEqual(b.options.source, ['Careers page', 'Trade show'])
    assert.equal((await send('/api/lodge/command/board-view', { vacancy: job.id, sort: 'random' }, manager)).status, 400)
    await cmd('board-view', { vacancy: job.id, sort: 'days', filters: { source: 'Trade show' } }, manager)
    b = await boardOf()
    assert.deepEqual([b.filtered, b.view.sort, b.columns.map(c => [c.cards.length, c.total])], [true, 'days', [[1, 3], [2, 3], [1, 2], [1, 2], [0, 0]]])
    assert.ok(cards(b).every(c => c.source === 'Trade show'))
    assert.deepEqual(b.columns[1].cards.map(c => c.daysInStage), [8, 1], 'longest in stage first')
    assert.deepEqual((await state(manager)).boardViews.map(v => [v.vacancy, v.filters]), [[job.id, { source: 'Trade show' }]])
    assert.equal((await boardOf(owner)).filtered, false, 'another person keeps their own view')
    assert.equal((await send('/api/lodge/board/' + job.id, undefined, ian)).status, 404, 'an interviewer with nothing on the job has no board')
    assert.equal((await send('/api/lodge/command/board-view', { vacancy: job.id }, ian)).status, 404)

    // Needs decision appears when the last panel scorecard is in; a filter by reviewer finds the panel.
    const [safety] = job.rubrics.at(-1).criteria, target = apps[7]
    await cmd('assign-reviewers', { application: target.id, reviewers: ['ivy@example.test', 'ian@example.test'] }, manager)
    const card = (who, takeaways) => cmd('scorecard', { application: target.id, ratings: { [safety.id]: 3 }, evidence: { [safety.id]: 'Measured twice' }, recommendation: 'yes', takeaways, submit: true }, who)
    await cmd('board-view', { vacancy: job.id, filters: { reviewer: 'ian@example.test' } }, manager)
    const flagged = async () => { const x = await boardOf(); assert.deepEqual(cards(x).map(c => c.application), [target.id]); return x.columns.flatMap(c => c.cards)[0] }
    await card(ivy, 'Neat cuts')
    assert.deepEqual([(await flagged()).needsDecision, (await flagged()).scorecards], [false, { submitted: 1, panel: 2, outstanding: ['ian@example.test'] }])
    await card(ian, 'Careful with glass')
    assert.deepEqual([(await flagged()).needsDecision, (await flagged()).scorecards.outstanding], [true, []])

    // A move from the board needs its LDG-007 reason; the card then starts again in its new stage.
    assert.equal((await send('/api/lodge/command/move', { application: target.id, to: job.stages[3].id }, manager)).status, 400)
    await cmd('move', { application: target.id, to: job.stages[3].id, reason: 'Panel agrees: offer stage' }, manager)
    const moved = await flagged()
    assert.deepEqual([moved.stage, moved.daysInStage, moved.needsDecision], [job.stages[3].id, 0, false])
    assert.equal((await state(manager)).applications.find(x => x.id === target.id).history.at(-1).reason, 'Panel agrees: offer stage')
    await cmd('board-view', { vacancy: job.id }, manager)
    assert.deepEqual((await boardOf()).columns.map(c => c.cards.length), [3, 3, 1, 3, 0])
    for (const a of apps) await cmd('move', { application: a.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Board test done' }, manager)
  })

  await t.test('HOME-001 one home across jobs: interviews, scorecards, approvals, reviews, follow-ups, offers and jobs needing attention, each linked and gone once done or revoked', async () => {
    const hana = await h.member('hana@example.test', ['manager', 'approver'], 'Hana Ito')
    const jobA = await openJob('Tiler'), jobB = await openJob('Plasterer')
    // Interviewer rights on job A and manager rights on job B (REQ-003).
    await cmd('hiring-team', { id: jobA.id, interviewers: ['hana@example.test'] })
    await cmd('hiring-team', { id: jobB.id, hiringManagers: ['hana@example.test'] })
    const add = async (job, name) => (await cmd('candidate', { name, email: name.split(' ')[0].toLowerCase() + '.home@example.test', source: 'Careers page', consentBasis: 'application', vacancy: job.id }, manager)).application
    const [a1, a2, b1, b2] = [await add(jobA, 'Tess Grout'), await add(jobA, 'Ned Bond'), await add(jobB, 'Pia Skim'), await add(jobB, 'Lou Float')]
    const inDays = d => new Date(Math.floor(Date.now() / 3600000) * 3600000 + d * 86400000).toISOString()
    const booked = async (app, start) => { const iv = await cmd('interview', { application: app.id, planItem: jobA.plan[0].id, participants: ['hana@example.test'], slots: [start], durationMinutes: 60 }, manager); await cmd('schedule', { interview: iv.id, slot: 0 }, manager); return iv }
    // Job A: an upcoming interview, an interview held three days ago whose scorecard is overdue, and an application review.
    const upcoming = await booked(a1, inDays(7)), held = await booked(a2, inDays(1))
    await h.db.prepare("UPDATE l_records SET value=json_set(value,'$.start',?) WHERE kind='interview' AND id=?").bind(inDays(-3), held.id).run()
    await cmd('assign-reviewers', { application: a1.id, reviewers: ['hana@example.test'] }, manager)
    const offerA = await cmd('offer', { application: a1.id, title: 'Tiler', startDate: '2027-02-01', salary: { currency: 'USD', amount: 9500000, period: 'year' } }, manager)
    const approval = await cmd('request-offer-approval', { id: offerA.id, approver: 'hana@example.test' }, manager)
    // Job B: her follow-up, a draft offer not yet sent for approval, a candidate 15 days in stage and an interview still collecting times.
    const followUp = await cmd('task', { application: b1.id, note: 'Chase the portfolio', due: inDays(3).slice(0, 10), owner: 'hana@example.test' }, manager)
    await cmd('move', { application: b2.id, to: jobB.stages[1].id, reason: 'Phone screen passed' }, manager)
    await cmd('offer', { application: b2.id, title: 'Plasterer', startDate: '2027-03-01', salary: { currency: 'USD', amount: 9500000, period: 'year' } }, manager)
    await cmd('interview', { application: b2.id, planItem: jobB.plan[0].id, participants: ['ivy@example.test'], slots: [inDays(5)] }, manager)
    await h.db.prepare("UPDATE l_records SET value=json_set(value,'$.at',?) WHERE kind='stage-event' AND json_extract(value,'$.application')=?").bind(inDays(-15), b1.id).run()

    const homeOf = async (cookie = hana) => { const r = await send('/api/lodge/home', undefined, cookie); assert.equal(r.status, 200, JSON.stringify(r.value)); return r.value }
    const links = x => Object.fromEntries(['interviews', 'scorecards', 'approvals', 'reviews', 'mentions', 'tasks', 'offers', 'attention'].map(k => [k, x[k].map(i => i.link).sort()]))
    let home = await homeOf()
    assert.deepEqual(links(home), {
      interviews: ['/app?kit=' + upcoming.id], scorecards: ['/app?application=' + a1.id, '/app?application=' + a2.id].sort(), approvals: ['/app?approval=' + approval.id],
      reviews: ['/app?job=' + jobA.id, '/app?job=' + jobB.id].sort(), mentions: [], tasks: ['/app?application=' + b1.id], offers: ['/app?application=' + b2.id], attention: ['/app?job=' + jobB.id],
    })
    assert.deepEqual(home.counts, { interviews: 1, scorecards: 2, approvals: 1, reviews: 2, mentions: 0, tasks: 1, offers: 1, attention: 1 })
    const late = home.scorecards.find(x => x.application === a2.id), review = home.scorecards.find(x => x.application === a1.id)
    assert.deepEqual([late.overdue, late.due, review.due], [true, new Date(Date.parse(inDays(-3)) + 3600000 + 24 * 3600000).toISOString(), null], 'due a day after the interview ends')
    assert.deepEqual([home.reviews.find(q => q.vacancy === jobB.id).remaining, home.offers[0].action, home.attention[0].stalled, home.attention[0].unscheduled, home.tasks[0].overdue], [1, 'request-approval', 1, 1, false])
    // Every link opens its exact item for her: the kit, the applications, the approval and the jobs.
    assert.equal((await send('/api/lodge/kit/' + upcoming.id, undefined, hana)).status, 200)
    const seen = await state(hana)
    assert.ok([a1, a2, b1, b2].every(x => seen.applications.some(a => a.id === x.id)) && seen.approvals.some(x => x.id === approval.id && x.status === 'pending'))
    assert.ok([jobA, jobB].every(j => seen.vacancies.some(v => v.id === j.id)))
    assert.equal((await homeOf(ian)).counts.scorecards, 0, 'nobody else gets her items')

    // Submit the scorecards, decide the approval, revoke job B and cancel the interview: each item leaves.
    const [safety] = jobA.rubrics.at(-1).criteria
    for (const app of [a1, a2]) await cmd('scorecard', { application: app.id, ratings: { [safety.id]: 3 }, evidence: { [safety.id]: 'Even grout lines' }, recommendation: 'yes', takeaways: 'Careful finisher', submit: true }, hana)
    await cmd('review-recommendation', { application: a1.id, recommendation: 'yes' }, hana)
    home = await homeOf()
    assert.deepEqual([home.counts.scorecards, links(home).reviews], [0, ['/app?job=' + jobB.id]])
    await cmd('decide-approval', { id: approval.id, decision: 'approved', reason: 'Within range', version: (await state(hana)).approvals.find(x => x.id === approval.id).currentVersion }, hana)
    assert.equal((await homeOf()).counts.approvals, 0)
    await cmd('hiring-team', { id: jobB.id })
    home = await homeOf()
    assert.deepEqual([home.counts.reviews, home.counts.tasks, home.counts.offers, home.counts.attention], [0, 0, 0, 0], 'job B is gone from her home at once')
    assert.ok((await homeOf(manager)).tasks.some(x => x.id === followUp.id), 'her follow-up moved to the job’s hiring manager')
    await cmd('cancel-interview', { interview: upcoming.id, reason: 'Candidate rescheduling' }, manager)
    assert.deepEqual(Object.values((await homeOf()).counts), [0, 0, 0, 0, 0, 0, 0, 0])
    for (const app of [a1, a2, b1, b2]) await cmd('move', { application: app.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Home test done' }, manager)
  })

  await t.test('CRM-008 a managed source list with mapped texts; each hire shows its source and credited sourcer, agency or employee; credit changes keep history; merges follow the rule', async () => {
    // The application page put its own entry on the list; admins add the rest.
    assert.ok((await state(manager)).sources.some(x => x.name === 'Application page' && x.type === 'careers-site' && x.automatic), 'the intake door Lodge runs created its source')
    assert.equal((await send('/api/lodge/command/source', { name: 'Spring job fair', type: 'event' }, manager)).status, 403, 'only admins keep the list')
    const fair = await cmd('source', { name: 'Spring job fair', type: 'event' })
    await cmd('source', { name: 'Northside Staffing', type: 'agency' }); await cmd('source', { name: 'Employee referral', type: 'referral' })
    assert.equal((await send('/api/lodge/command/source', { name: 'spring JOB fair', type: 'other' }, owner)).status, 409, 'names stay unique')
    const suki = await h.member('suki@example.test', ['interviewer'], 'Suki Mori')
    const [j1, j2, j3] = [await openJob('Mason'), await openJob('Roofer lead'), await openJob('Drywaller')]
    await cmd('hiring-team', { id: j1.id, sourcers: ['suki@example.test'] })
    const add = async (body, cookie = manager) => (await cmd('candidate', { consentBasis: 'manual', ...body }, cookie)).application
    // The same person reached first through the fair (sourced by Suki), later through the agency on another job as a second record.
    const early = await add({ name: 'Ada Stone', email: 'ada.stone@example.test', source: 'Spring job fair', vacancy: j1.id }, suki)
    const viaAgency = await add({ name: 'Ada Stone', email: 'ada.stone.work@example.test', source: 'Northside Staffing', agency: 'Northside Staffing', vacancy: j2.id })
    const referred = await add({ name: 'Rafe Lin', email: 'rafe@example.test', source: 'Employee referral', referrer: 'dev.okafor@example.test', consentBasis: 'referral', vacancy: j3.id })
    const freeText = await add({ name: 'Ola Fair', email: 'ola@example.test', source: 'job fair 2026', vacancy: j3.id })
    let s = await state(manager)
    const app = id => s.applications.find(x => x.id === id)
    assert.deepEqual([early, viaAgency, referred].map(x => [app(x.id).sourceEntry?.name, app(x.id).credit.kind, app(x.id).credit.who]),
      [['Spring job fair', 'sourcer', 'suki@example.test'], ['Northside Staffing', 'agency', 'Northside Staffing'], ['Employee referral', 'employee', 'dev.okafor@example.test']])
    assert.deepEqual([app(freeText.id).sourceEntry, app(freeText.id).credit.kind], [null, 'recruiter'])
    // Mapping a free-text source reaches the application already made.
    await cmd('source', { id: fair.id, name: 'Spring job fair', type: 'event', aliases: ['job fair 2026'] })
    s = await state(manager)
    assert.equal(app(freeText.id).sourceEntry.name, 'Spring job fair')
    // Hire all three, the sourced one on its own job too.
    const hire = async (application, title) => {
      const [opening] = (await state(manager)).vacancies.find(v => v.id === application.vacancy).openings
      const offer = await cmd('offer', { application: application.id, title, startDate: '2027-04-01', salary: { currency: 'USD', amount: 9500000, period: 'year' }, opening: opening.id }, manager)
      await approve((await cmd('request-offer-approval', { id: offer.id, approver: 'parker@example.test' }, manager)).id)
      await cmd('offer-outcome', { id: offer.id, outcome: 'accepted', reason: 'Signed' }, manager)
    }
    await cmd('move', { application: freeText.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Took another job' }, manager)
    await hire(viaAgency, 'Roofer lead'); await hire(referred, 'Drywaller')
    // A recruiter changes one credit with a reason; the earlier credit stays in its history.
    assert.equal((await send('/api/lodge/command/source-credit', { application: referred.id, kind: 'employee', who: 'kim.lee@example.test', reason: 'Kim referred Rafe first' }, ivy)).status, 404)
    assert.equal((await send('/api/lodge/command/source-credit', { application: referred.id, kind: 'employee', who: 'kim.lee@example.test' }, manager)).status, 400, 'a change needs its reason')
    await cmd('source-credit', { application: referred.id, kind: 'employee', who: 'kim.lee@example.test', reason: 'Kim referred Rafe first' }, manager)
    s = await state(manager)
    assert.deepEqual([app(referred.id).credit.who, app(referred.id).credit.reason, app(referred.id).creditHistory.map(c => [c.who, c.automatic])], ['kim.lee@example.test', 'Kim referred Rafe first', [['dev.okafor@example.test', true]]])
    const report = async () => { const r = await send('/api/lodge/reports/sources', undefined, manager); assert.equal(r.status, 200, JSON.stringify(r.value)); return r.value }
    assert.equal((await send('/api/lodge/reports/sources', undefined, ivy)).status, 403)
    let r = await report()
    // Only this test's hires and the sources and credits it named: earlier tests hired through the application page.
    const ours = new Set([early.id, viaAgency.id, referred.id]), names = ['Spring job fair', 'Northside Staffing', 'Employee referral']
    const hiresOf = x => Object.fromEntries(x.bySource.filter(row => names.includes(row.name) && row.hires).map(row => [row.name, row.hires]))
    const credits = x => x.byCredit.filter(row => ['Northside Staffing', 'kim.lee@example.test', 'dev.okafor@example.test', 'suki@example.test'].includes(row.who)).map(row => [row.kind, row.who, row.hires])
    assert.deepEqual([r.rule, hiresOf(r), r.hires.filter(x => ours.has(x.application)).length], ['own', { 'Northside Staffing': 1, 'Employee referral': 1 }, 2])
    assert.deepEqual(credits(r), [['agency', 'Northside Staffing', 1], ['employee', 'kim.lee@example.test', 1]])
    assert.equal(r.bySource.find(x => x.name === 'Spring job fair').applications, 2, 'the mapped text counts under the fair')
    await hire(early, 'Mason')
    r = await report()
    assert.deepEqual(credits(r), [['agency', 'Northside Staffing', 1], ['employee', 'kim.lee@example.test', 1], ['sourcer', 'suki@example.test', 1]], 'hires by credited sourcer')
    // Merging the two Ada records: each hire keeps its own source, or under "first touch" the fair's.
    await cmd('review-duplicate', { keep: app(viaAgency.id).candidate, other: app(early.id).candidate, decision: 'merge', reason: 'Same person, two emails' })
    assert.deepEqual((await report()).hires.filter(x => x.candidateName === 'Ada Stone').map(x => [x.name, x.credit.kind]).sort(), [['Northside Staffing', 'agency'], ['Spring job fair', 'sourcer']])
    assert.equal((await send('/api/lodge/command/source-settings', { onMerge: 'first-touch' }, manager)).status, 403)
    await cmd('source-settings', { onMerge: 'first-touch' })
    r = await report()
    assert.deepEqual([r.rule, r.hires.filter(x => x.candidateName === 'Ada Stone').map(x => [x.name, x.credit.kind, x.attributedTo])], ['first-touch', [['Spring job fair', 'sourcer', early.id], ['Spring job fair', 'sourcer', early.id]]])
    assert.deepEqual([hiresOf(r), credits(r)], [{ 'Spring job fair': 2, 'Employee referral': 1 }, [['sourcer', 'suki@example.test', 2], ['employee', 'kim.lee@example.test', 1]]])
    await cmd('source-settings', { onMerge: 'own' })
  })

  await t.test('OPS-001 the complete audit: every event in a period, searched and exported whole by admins; corrections are new events; erasure leaves no personal text', async () => {
    const day = d => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10), period = `?from=${day(-1)}&to=${day(1)}`
    // A stage move, an approval, a provider attempt, a role revocation, a correction and an erasure, all through public doors.
    const job = await openJob('Audit glazier')
    const { application, candidate } = await cmd('candidate', { name: 'Zed Quill', email: 'zed.quill@example.test', source: 'Careers page', consentBasis: 'manual', vacancy: job.id }, manager)
    await cmd('move', { application: application.id, to: job.stages[1].id, reason: 'AUDITMOVE strong portfolio' }, manager)
    await h.member('tom@example.test', ['interviewer'], 'Tom Ash')
    await cmd('member', { email: 'tom@example.test', name: 'Tom Ash', roles: ['interviewer'], active: false })
    const trail = async (query = period, cookie = owner) => { const r = await send('/api/lodge/audit' + query, undefined, cookie); assert.equal(r.status, 200, JSON.stringify(r.value)); return r.value }
    assert.equal((await send('/api/lodge/audit' + period, undefined, manager)).status, 403, 'admins only')
    assert.equal((await send('/api/lodge/download/audit', undefined, manager)).status, 403)
    assert.equal((await send('/api/lodge/audit?from=19-10-2026', undefined, owner)).status, 400)
    let r = await trail()
    const one = (action, record) => r.events.filter(e => e.action === action && (!record || e.record === record))
    assert.equal(one('stage-moved', 'application:' + application.id)[0].reason, 'AUDITMOVE strong portfolio')
    assert.equal(one('approval-approved', 'vacancy:' + job.id).length, 1)
    assert.deepEqual(one('invitation-handed-to-mail-provider', 'member:tom@example.test').map(e => [e.provider, e.outcome]), [['development', 'accepted']], 'the provider attempt, never called delivered')
    assert.deepEqual(one('member-updated', 'member:tom@example.test').map(e => e.active), [false], 'the access revocation')
    // Nothing is capped: the whole period comes back, oldest first, beyond the 300 the workspace shows.
    for (let i = 1; i <= 8; i++) await cmd('correct-candidate', { id: candidate.id, name: 'Zed Quill', email: 'zed.quill@example.test', reason: 'Routine check ' + i })
    const everything = await trail('')
    const stored = (await h.db.prepare("SELECT COUNT(*) AS n FROM l_records WHERE kind='audit'").first()).n
    assert.ok(everything.total > 300 && everything.events.length === everything.total && everything.total === stored, `${everything.total} of ${stored}`)
    assert.equal((await state()).audit.length, 300, 'the workspace shows only the latest 300')
    assert.ok(everything.events.every((e, i, all) => !i || all[i - 1].at <= e.at), 'oldest first')
    assert.equal((await trail(`?from=${day(3)}&to=${day(4)}`)).total, 0, 'a later period holds nothing yet')
    assert.deepEqual((await trail(period + '&q=AUDITMOVE')).events.map(e => e.record), ['application:' + application.id])
    // A correction is a new event; the earlier one is unchanged.
    const added = one('candidate-added', 'candidate:' + candidate.id)[0]
    await cmd('correct-candidate', { id: candidate.id, name: 'Zed Quill', email: 'zed.q@example.test', reason: 'Typo in email' })
    r = await trail()
    assert.deepEqual(one('candidate-added', 'candidate:' + candidate.id), [added])
    assert.deepEqual(one('candidate-corrected', 'candidate:' + candidate.id).map(e => e.reason).slice(-2), ['Routine check 8', 'Typo in email'])
    // The export holds every event of the period and is itself recorded afterwards.
    const exported = await send('/api/lodge/download/audit' + period, undefined, owner)
    assert.equal(exported.status, 200); assert.match(exported.headers.get('content-disposition'), /attachment; filename="lodge-audit-/)
    assert.deepEqual([exported.value.total, exported.value.events.map(e => e.id)], [r.total, r.events.map(e => e.id)])
    assert.deepEqual((await trail()).events.at(-1).action, 'audit-exported')
    // Erasure keeps the receipt event and removes every event that carried the person's text.
    await cmd('move', { application: application.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Audit test done' }, manager)
    assert.equal((await send('/api/lodge/delete-candidate', { candidate: candidate.id, confirm: 'Zed Quill', reason: 'Asked to be forgotten' }, owner)).status, 200)
    const after = (await send('/api/lodge/download/audit' + period, undefined, owner)).text
    for (const personal of ['Zed Quill', 'zed.q', 'AUDITMOVE']) assert.ok(!after.includes(personal), personal + ' is gone from the audit')
    assert.ok(JSON.parse(after).events.some(e => e.action === 'candidate-deleted' && e.record === 'candidate:' + candidate.id))
  })

  await t.test('HIRE-007 fair-chance places: no criminal-history question before a conditional offer, then assessment, notice and a waiting period, restricted to admins', async () => {
    assert.equal((await send('/api/lodge/command/fair-chance-places', { places: [{ place: 'California' }] }, manager)).status, 403)
    await cmd('fair-chance-places', { places: [{ place: 'California', waitingDays: 5 }] })
    const la = await openJob('Forklift operator', 'Los Angeles, CA'), denver = await openJob('Forklift lead')
    const conviction = await cmd('question', { text: 'Have you ever been convicted of a felony?', type: 'yes-no' })
    const forklift = await cmd('question', { text: 'Do you hold a forklift certificate?', type: 'yes-no' })
    const attach = (job, qs) => send('/api/lodge/command/job-questions', { id: job.id, questions: qs.map(q => ({ question: q.id, required: false })) }, manager)
    const refused = await attach(la, [forklift, conviction])
    assert.equal(refused.status, 400); assert.match(refused.value.error, /California is a fair-chance place/)
    assert.equal((await attach(la, [forklift])).status, 200)
    assert.equal((await attach(denver, [forklift, conviction])).status, 200, 'Denver is not a fair-chance place')
    const page = async job => (await send('/jobs/' + (await state(manager)).vacancies.find(v => v.id === job.id).slug)).text
    assert.ok((await page(denver)).includes('convicted of a felony'))
    // Naming Colorado later takes the attached question off the Denver application page too.
    await cmd('fair-chance-places', { places: [{ place: 'California', waitingDays: 5 }, { place: 'CO', waitingDays: 3 }] })
    assert.ok(!(await page(denver)).includes('convicted of a felony') && (await page(denver)).includes('forklift certificate'))
    await cmd('fair-chance-places', { places: [{ place: 'California', waitingDays: 5 }] })

    // Nothing before a conditional offer; then the assessment, the notice and the waiting period, in that order.
    const { application: app } = await cmd('candidate', { name: 'Cruz Vega', email: 'cruz.vega@example.test', source: 'Careers page', consentBasis: 'manual', vacancy: la.id }, manager)
    const step = (body, cookie = owner) => send('/api/lodge/command/fair-chance-step', { application: app.id, ...body }, cookie)
    assert.equal((await step({ step: 'assessment', text: 'Early' })).status, 409, 'no conditional offer yet')
    const [opening] = (await state(manager)).vacancies.find(v => v.id === la.id).openings
    const plain = await cmd('offer', { application: app.id, title: 'Forklift operator', startDate: '2027-05-03', salary: { currency: 'USD', amount: 9500000, period: 'year' }, opening: opening.id }, manager)
    await approve((await cmd('request-offer-approval', { id: plain.id, approver: 'parker@example.test' }, manager)).id)
    assert.equal((await step({ step: 'assessment', text: 'Early' })).status, 409, 'an offer not marked conditional does not open the steps')
    const offer = await cmd('offer', { id: plain.id, application: app.id, title: 'Forklift operator', startDate: '2027-05-03', salary: { currency: 'USD', amount: 9500000, period: 'year' }, opening: opening.id, conditional: true }, manager)
    assert.equal((await step({ step: 'assessment', text: 'Early' })).status, 409, 'marking it conditional changed the terms: it needs approval again')
    await approve((await cmd('request-offer-approval', { id: offer.id, approver: 'parker@example.test' }, manager)).id)
    assert.equal((await step({ step: 'assessment', text: 'Manager view' }, manager)).status, 403, 'admins only')
    assert.equal((await step({ step: 'pre-adverse-notice', date: new Date().toISOString().slice(0, 10), text: 'Letter' })).status, 409, 'the assessment comes first')
    await cmd('fair-chance-step', { application: app.id, step: 'assessment', text: 'FCA-ASSESS 2014 conviction unrelated to forklift duties; ten years since' })
    const today = (await state(owner)).fairChance && new Date().toLocaleDateString('en-CA', { timeZone: BUSINESS.timeZone })
    const noticed = await cmd('fair-chance-step', { application: app.id, step: 'pre-adverse-notice', date: today, text: 'Letter and report copy handed over' })
    assert.equal(noticed.adverseFrom, new Date(Date.parse(today) + 5 * 86400000).toISOString().slice(0, 10))
    const early = await step({ step: 'final-decision', outcome: 'adverse', text: 'Too soon' })
    assert.equal(early.status, 409); assert.match(early.value.error, new RegExp('runs until ' + noticed.adverseFrom))
    // Five days later (the stored notice day moved back), the final adverse decision may be recorded.
    await h.db.prepare("UPDATE l_records SET value=json_set(value,'$.notice.date',?) WHERE kind='fair-chance-record' AND id=?").bind(new Date(Date.parse(today) - 5 * 86400000).toISOString().slice(0, 10), app.id).run()
    await cmd('fair-chance-step', { application: app.id, step: 'final-decision', outcome: 'adverse', text: 'Individualized assessment and response considered' })
    assert.equal((await step({ step: 'assessment', text: 'Late' })).status, 409, 'the decision closes the steps')
    // Restricted: the owner and admins see it; the manager, interviewers, search and agents do not; the access export carries it.
    const ownerView = await state(owner)
    assert.deepEqual(ownerView.fairChance.records.map(r => [r.application, r.decision.outcome, r.assessments.length]), [[app.id, 'adverse', 1]])
    for (const who of [manager, ivy]) { const v = await state(who); assert.equal(v.fairChance, null); assert.ok(!JSON.stringify(v).includes('FCA-ASSESS')) }
    assert.deepEqual((await send('/api/lodge/search?q=FCA-ASSESS', undefined, owner)).value.results, [])
    const exported = (await send('/api/lodge/download/candidate/' + app.candidate, undefined, owner)).value
    assert.equal(exported['fair-chance-record'][0].assessments[0].text.slice(0, 10), 'FCA-ASSESS')
    await cmd('offer-outcome', { id: offer.id, outcome: 'withdrawn', reason: 'Final adverse decision' }, manager)
    await cmd('move', { application: app.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Fair-chance test done' }, manager)
  })

  await t.test('OFFER-006 a recruiter records an offer signed outside Lodge: bytes bound to the approved terms, hire recorded, honest label', async () => {
    const job = await openJob('Glazier')
    const rosa = await h.member('rosa@example.test', ['manager'], 'Rosa Pike')
    await cmd('hiring-team', { id: job.id, recruiters: ['rosa@example.test'] })
    const { application: app } = await cmd('candidate', { name: 'Gus Hale', email: 'gus.glass@example.test', source: 'Careers page', consentBasis: 'application', vacancy: job.id }, manager)
    await cmd('assign-reviewers', { application: app.id, reviewers: ['ivy@example.test'] }, manager)
    const [opening] = (await state(manager)).vacancies.find(v => v.id === job.id).openings
    const offer = await cmd('offer', { application: app.id, title: 'Glazier', startDate: '2026-12-07', salary: { currency: 'USD', amount: 9500000, period: 'year' }, opening: opening.id }, rosa)
    const scan = '%PDF-1.4 scanned offer letter signed by Gus Hale on paper'
    const upload = (body, cookie = rosa) => send('/api/lodge/command/offer-signed-outside', { id: offer.id, method: 'paper', attest: true, name: 'signed-offer.pdf', mediaType: 'application/pdf', base64: b64(scan), ...body }, cookie)
    assert.equal((await upload({})).status, 409, 'an offer whose terms are not approved cannot be recorded as signed')
    await approve((await cmd('request-offer-approval', { id: offer.id, approver: 'parker@example.test' }, rosa)).id)
    assert.equal((await upload({}, ivy)).status, 403, 'the interviewer reviewing the application is refused')
    assert.equal((await upload({ attest: false })).status, 400, 'the attestation is required')
    assert.equal((await upload({ method: 'fax' })).status, 400)
    const signed = await upload({ differences: 'Start date initialled as Dec 7' })
    assert.equal(signed.status, 200, signed.text)

    const s = await state(rosa)
    const o = s.offers.find(x => x.id === offer.id)
    assert.deepEqual([o.status, o.signature.label, o.signature.method, o.signature.differences, o.signature.attestedBy, o.signature.providerVerified], ['accepted', 'accepted, signed outside Lodge (not provider-verified)', 'paper', 'Start date initialled as Dec 7', 'rosa@example.test', false])
    assert.equal(o.signature.sha256, createHash('sha256').update(scan).digest('hex'))
    assert.equal(o.signature.termsVersion, o.approval.version, 'bound to the approved terms')
    assert.equal(s.applications.find(x => x.id === app.id).status, 'hired')
    assert.equal(s.vacancies.find(v => v.id === job.id).openings.find(x => x.id === opening.id).status, 'filled')
    assert.equal((await send('/api/lodge/download/document/' + o.signature.document, undefined, rosa)).text, scan, 'the signed original keeps its bytes')
    // The HR handoff, the door HIRE-001–HIRE-005 previews read, carries the outside signature.
    const handoff = (await send('/api/lodge/download/handoff/' + offer.id, undefined, rosa)).value
    assert.deepEqual([handoff.signature.label, handoff.signature.sha256, handoff.signature.providerVerified], [o.signature.label, o.signature.sha256, false])
    assert.equal((await upload({})).status, 409, 'an offer with an outcome is not signed again')
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
    // OPS-001: the complete audit and its export leave the job and the candidate out for her too; the owner's include them.
    for (const path of ['/api/lodge/audit', '/api/lodge/download/audit']) assert.ok(!(await send(path, undefined, rae)).text.includes(job.id))
    assert.ok((await send('/api/lodge/audit', undefined, owner)).value.events.some(e => e.record === 'vacancy:' + job.id))
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

  await t.test('ATTR-009 the public job board: published jobs as JSON for the employer’s own careers page; applications with a board key or from an allowed site', async () => {
    const board = '/api/board/v1/example-builders'
    const fulfil = await cmd('department', { name: 'Fulfilment' }), nights = await cmd('department', { name: 'Night shift', parent: fulfil.id }), legal = await cmd('department', { name: 'Legal affairs' })
    const aurora = await cmd('office', { name: 'Aurora, CO' })
    const lift = await cmd('question', { text: 'Can you lift 50 pounds?', type: 'yes-no', required: true })
    const job = async (title, departmentId) => {
      const v = await cmd('vacancy', { title, departmentId, officeId: aurora.id, headcount: 1, manager: 'morgan@example.test', compensation: RANGE, description: title + ' duties.' }, manager)
      await cmd('rubric', { id: v.id, criteria: RUBRIC }, manager)
      await cmd('interview-plan', { id: v.id, plan: [{ name: 'Walk', stageName: 'Interview', durationMinutes: 45 }] }, manager)
      await approve((await cmd('request-vacancy-approval', { id: v.id, approver: 'parker@example.test' }, manager)).id)
      return cmd('publish', { id: v.id }, manager)
    }
    const loader = await job('Night loader', nights.id), counsel = await job('Counsel', legal.id)
    await cmd('job-questions', { id: loader.id, questions: [{ question: lift.id, required: true }] }, manager)
    await cmd('screening-rule', { vacancy: loader.id, name: 'Lifts', question: lift.id, when: { equals: 'yes' }, then: { kind: 'tag', tag: 'Can lift' } })
    await cmd('vacancy-privacy', { id: counsel.id, confidential: true, publicTitle: 'Advisor' })
    const draft = await cmd('vacancy', { title: 'Paralegal', departmentId: legal.id, headcount: 1, manager: 'morgan@example.test', compensation: RANGE }, manager)

    // The board exists once an admin names it; only admins keep it, and keys are shown once and stored as hashes.
    assert.equal((await send(board + '/jobs')).status, 404)
    assert.equal((await send('/api/lodge/command/job-board', { token: 'example-builders' }, manager)).status, 403)
    assert.equal((await send('/api/lodge/command/job-board', { token: 'example-builders', allowedOrigins: ['https://careers.example.test/jobs'] }, owner)).status, 400, 'an allowed origin is a scheme and host only')
    await cmd('job-board', { token: 'example-builders', allowedOrigins: ['https://careers.example.test'] })
    const created = await cmd('board-key', { label: 'Website server' })
    assert.match(created.key, /^lbk_[0-9a-f]{64}$/)
    const settings = (await state()).jobBoard
    assert.deepEqual(settings.keys.map(k => [k.label, k.last4, 'hash' in k]), [['Website server', created.key.slice(-4), false]])
    assert.equal((await state(manager)).jobBoard, null)

    // The list: published, non-confidential jobs with departments, offices and pay; any origin, cached with an ETag.
    const list = await send(board + '/jobs')
    assert.equal(list.status, 200)
    assert.deepEqual([list.headers.get('access-control-allow-origin'), list.headers.get('cache-control')], ['*', 'public, max-age=60'])
    const listed = list.value.jobs.find(j => j.id === loader.id)
    assert.deepEqual(listed.departments.map(d => d.name), ['Fulfilment', 'Night shift'])
    assert.deepEqual(listed.offices.map(o => o.name), ['Aurora, CO'])
    assert.deepEqual(listed.pay, [{ location: 'Aurora, CO', currency: 'USD', min: 9000000, max: 11000000, period: 'year', minorUnits: 2 }])
    assert.equal(listed.payTransparency, 'Pay for Aurora, CO: $90,000–$110,000 a year')
    assert.ok(listed.url.endsWith('/jobs/' + loader.slug) && listed.publishedAt && !('content' in listed))
    for (const hidden of [counsel.id, draft.id]) assert.equal(list.value.jobs.some(j => j.id === hidden), false, 'confidential and unpublished jobs never list')
    assert.equal(list.value.jobs.some(j => j.title === 'Advisor'), false, 'not even under a neutral title')
    assert.equal((await send(board + '/jobs?content=true')).value.jobs.find(j => j.id === loader.id).content, 'Night loader duties.')
    assert.equal((await send(board + '/jobs', undefined, '', { 'if-none-match': list.headers.get('etag') })).status, 304)
    assert.equal((await send('/api/board/v1/someone-else/jobs')).status, 404)

    // The detail carries the application form: questions, the notice version and the voluntary question set.
    const detail = (await send(`${board}/jobs/${loader.id}`)).value
    assert.deepEqual(detail.questions.map(q => [q.id, q.type, q.required]), [[lift.id, 'yes-no', true]])
    assert.deepEqual([detail.privacyNotice.version, detail.voluntaryQuestions[0].options.includes('Woman'), detail.fields.find(f => f.name === 'resume').maxBytes], [(await state()).business.notices.at(-1).version, true, 1000000])
    for (const hidden of [counsel.id, draft.id]) assert.equal((await send(`${board}/jobs/${hidden}`)).status, 404)
    const departments = (await send(board + '/departments')).value.departments
    assert.deepEqual(departments.filter(d => [fulfil.id, nights.id, legal.id].includes(d.id)).map(d => [d.path, d.jobs]), [['Fulfilment', 1], ['Fulfilment › Night shift', 1]], 'department counts leave out confidential and unpublished jobs')
    assert.deepEqual((await send(board + '/offices')).value.offices.filter(o => o.id === aurora.id).map(o => o.jobs), [1])

    // Submitting with the board key: each refusal names its field; a good submission returns a receipt once.
    const submit = (body, headers = {}, id = loader.id) => send(`${board}/jobs/${id}/applications`, body, '', { origin: 'https://agency.example.test', authorization: 'Bearer ' + created.key, 'cf-connecting-ip': '203.0.113.7', ...headers })
    const good = { name: 'Rae Okafor', email: 'rae@example.test', noticeVersion: detail.privacyNotice.version, consent: true, resume: { name: 'rae.pdf', mediaType: 'application/pdf', base64: b64('%PDF-1.4 Rae Okafor, forklift certified') }, answers: { [lift.id]: 'yes' }, campaign: { utm_source: 'webflow', utm_campaign: 'spring-hiring' } }
    const refused = async (body, status, field, headers) => { const r = await submit(body, headers); assert.deepEqual([r.status, r.value.field], [status, field], JSON.stringify(r.value)) }
    await refused({ ...good, answers: {} }, 400, 'answers.' + lift.id)
    await refused({ ...good, noticeVersion: detail.privacyNotice.version + 1 }, 409, 'noticeVersion')
    await refused({ ...good, resume: { ...good.resume, base64: Buffer.alloc(1_100_000, 7).toString('base64') } }, 413, 'resume')
    await refused({ ...good, resume: { ...good.resume, name: 'rae.exe' } }, 400, 'resume')
    await refused({ ...good, website: 'https://spam.example' }, 400, 'website')
    await refused(good, 401, 'authorization', { authorization: 'Bearer lbk_' + '0'.repeat(64) })
    const first = await submit(good, { 'idempotency-key': 'form-1' })
    assert.equal(first.status, 201, JSON.stringify(first.value))
    const again = await submit(good, { 'idempotency-key': 'form-1' })
    assert.deepEqual([again.status, again.value.receipt, again.value.replayed], [200, first.value.receipt, true])
    const repeat = await submit(good, { 'idempotency-key': 'form-2' })
    assert.ok(repeat.status === 201 && repeat.value.receipt !== first.value.receipt, 'a repeat gets its own receipt and reveals nothing')
    let view = await state()
    const apps = view.applications.filter(a => a.vacancy === loader.id)
    assert.equal(apps.length, 1, 'one email applies to a job once: no duplicate application')
    assert.deepEqual([apps[0].source, apps[0].campaign, apps[0].repeatSubmissions.map(r => r.receipt)], ['Careers page (API)', { utm_source: 'webflow', utm_campaign: 'spring-hiring' }, [repeat.value.receipt]])
    assert.ok(view.documents.some(d => d.application === apps[0].id && d.name === 'rae.pdf' && d.kind === 'resume'))
    assert.deepEqual([apps[0].answers.map(a => a.value), apps[0].tags], [['yes'], ['Can lift']], 'SCREEN-002 rules run on board submissions')
    assert.deepEqual(view.sources.filter(x => x.name === 'Careers page (API)').map(x => [x.type, x.automatic]), [['careers-site', true]], 'the door joins the CRM-008 list by itself')

    // From a browser: only an allowed origin, answered with CORS for that origin alone.
    const browser = { authorization: '', origin: 'https://careers.example.test', 'cf-connecting-ip': '203.0.113.8' }
    const fromSite = await submit({ ...good, email: 'sol@example.test', name: 'Sol Reyes' }, browser)
    assert.deepEqual([fromSite.status, fromSite.headers.get('access-control-allow-origin')], [201, 'https://careers.example.test'])
    await refused({ ...good, email: 'tia@example.test' }, 403, 'authorization', { ...browser, origin: 'https://elsewhere.example.test' })
    const preflight = async origin => (await h.mf.dispatchFetch(`${h.origin}${board}/jobs/${loader.id}/applications`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST' } }))
    assert.deepEqual([(await preflight('https://careers.example.test')).status, (await preflight('https://elsewhere.example.test')).status], [204, 403])

    // Rotating stops the old key at once; a revoked key is refused; no board key opens the private API.
    const rotated = await cmd('rotate-board-key', { id: settings.keys[0].id })
    await refused({ ...good, email: 'uma@example.test' }, 401, 'authorization')
    assert.equal((await submit({ ...good, email: 'uma@example.test', name: 'Uma Bell' }, { authorization: 'Bearer ' + rotated.key })).status, 201)
    await cmd('revoke-board-key', { id: rotated.keys.find(k => !k.revokedAt).id })
    const revoked = await submit({ ...good, email: 'vic@example.test' }, { authorization: 'Bearer ' + rotated.key })
    assert.deepEqual([revoked.status, revoked.value.field, revoked.value.error], [401, 'authorization', 'This board key was revoked'])
    for (const path of ['/api/lodge/state', '/api/lodge/search?q=Rae']) assert.equal((await send(path, undefined, '', { authorization: 'Bearer ' + rotated.key })).status, 401, path)
    assert.equal((await send('/api/lodge/command/vacancy', { title: 'x' }, '', { authorization: 'Bearer ' + created.key })).status, 401)
    view = await state()
    assert.ok(['board-key-created', 'board-key-rotated', 'board-key-revoked'].every(action => view.audit.some(e => e.action === action)))

    // Spam controls: at most ten attempts an hour from one connection.
    const flood = []
    for (let i = 0; i < 11; i++) flood.push((await submit({ ...good, website: 'x' }, { ...browser, 'cf-connecting-ip': '198.51.100.9' })).status)
    assert.deepEqual([flood.slice(0, 10).every(s => s === 400), flood[10]], [true, 429])
  })

  await t.test('ATTR-008 the embedded job board and form: framed only by listed sites, filtered, applied to inside the frame with the host page’s campaign', async () => {
    const support = await cmd('department', { name: 'Customer support' })
    const v = await cmd('vacancy', { title: 'Support specialist', departmentId: support.id, workMode: 'remote', location: 'Remote (US)', headcount: 1, manager: 'morgan@example.test', compensation: RANGE }, manager)
    await cmd('rubric', { id: v.id, criteria: RUBRIC }, manager)
    await cmd('interview-plan', { id: v.id, plan: [{ name: 'Call', stageName: 'Interview', durationMinutes: 30 }] }, manager)
    await approve((await cmd('request-vacancy-approval', { id: v.id, approver: 'parker@example.test' }, manager)).id)
    const job = await cmd('publish', { id: v.id }, manager)
    const roles = page => [...page.text.matchAll(/<li><a href="\/embed\/jobs\/([^"?]+)[^"]*">([^<]+)<\/a>/g)].map(m => m[2]).sort()

    // Framing: only the board's listed origins may frame the embed; hosted pages refuse every frame.
    const list = await send('/embed/jobs?utm_source=newsletter')
    assert.equal(list.status, 200)
    assert.match(list.headers.get('content-security-policy'), /frame-ancestors https:\/\/careers\.example\.test;/)
    assert.match((await send('/jobs')).headers.get('content-security-policy'), /frame-ancestors 'none'/)
    assert.match((await send('/embed.js')).text, /\/embed\/jobs/)
    const titles = roles(list)
    assert.ok(titles.includes('Support specialist') && titles.includes('Night loader'))
    for (const hidden of ['Advisor', 'Counsel', 'Paralegal']) assert.equal(titles.includes(hidden), false, hidden + ' never renders in the embed')
    // Filters: department (preset by the snippet's data-department), office and remote; links carry the campaign.
    assert.deepEqual(roles(await send(`/embed/jobs?department=${support.id}`)), ['Support specialist'])
    assert.ok(roles(await send('/embed/jobs?remote=true')).every(t => t !== 'Night loader') && roles(await send('/embed/jobs?remote=true')).includes('Support specialist'))
    assert.match(list.text, new RegExp(`href="/embed/jobs/${job.slug}\\?utm_source=newsletter"`))

    // The form inside the frame: labelled fields, notice, accommodation contact, and the campaign as hidden fields.
    const detail = await send(`/embed/jobs/${job.slug}?utm_source=newsletter&utm_campaign=spring`)
    assert.match(detail.headers.get('content-security-policy'), /frame-ancestors https:\/\/careers\.example\.test;.*script-src 'self'/)
    for (const label of ['Full name', 'Email', 'Resume', 'Adjustments you need', 'I have read privacy notice']) assert.ok(detail.text.includes(label), label)
    assert.match(detail.text, /action="\/embed\/jobs\/[^"]+"/)
    assert.match(detail.text, /name="utm_source" value="newsletter"/)
    assert.equal((await send(`/embed/jobs/${(await state()).vacancies.find(x => x.title === 'Counsel').slug}`)).status, 404, 'a confidential job never opens in the embed')
    const notice = detail.text.match(/name="noticeVersion" value="(\d+)"/)[1]
    const body = (version, email) => { const f = new FormData(); for (const [k, x] of Object.entries({ name: 'Wren Hale', email, noticeVersion: version, consent: 'yes', utm_source: 'newsletter', utm_campaign: 'spring', monitoring: 'Woman' })) f.set(k, x); f.set('resume', new Blob(['Wren Hale resume'], { type: 'text/plain' }), 'wren.txt'); return f }
    const stale = await send(`/embed/jobs/${job.slug}`, body(String(Number(notice) + 1), 'wren@example.test'))
    assert.equal(stale.status, 409, 'an older notice version is refused')
    assert.match(stale.headers.get('content-security-policy'), /frame-ancestors https:\/\/careers\.example\.test/)
    assert.equal((await send(`/embed/jobs/${job.slug}`, body(notice, 'wren@example.test'), '', { origin: 'https://careers.example.test' })).status, 403, 'the form posts only from its own frame')
    const done = await send(`/embed/jobs/${job.slug}`, body(notice, 'wren@example.test'))
    assert.equal(done.status, 200, done.text)
    const receipt = done.text.match(/<dt>Receipt<\/dt><dd>(LDG-[0-9A-F]+)<\/dd>/)[1]
    const view = await state()
    const app = view.applications.find(a => view.receipts.some(r => r.id === receipt && r.application === a.id))
    assert.deepEqual([app.source, app.campaign], ['Careers page (embedded)', { utm_source: 'newsletter', utm_campaign: 'spring' }])
    assert.ok(view.restricted.some(m => m.application === app.id && m.type === 'voluntary-monitoring'), 'the voluntary answer stays restricted')
    assert.deepEqual(view.sources.filter(x => x.name === 'Careers page (embedded)').map(x => [x.type, x.automatic]), [['careers-site', true]])
    // The job's SCREEN-001 questions are asked in the frame and its SCREEN-002 rules run on the answers.
    const loader = view.vacancies.find(x => x.title === 'Night loader'), lift = loader.questions[0].question
    assert.match((await send(`/embed/jobs/${loader.slug}`)).text, new RegExp(`name="q-${lift}"`))
    const answered = body(notice, 'yuki@example.test'); answered.set('name', 'Yuki Sato'); answered.set('q-' + lift, 'yes')
    assert.equal((await send(`/embed/jobs/${loader.slug}`, answered)).status, 200)
    const tagged = (await state()).applications.find(a => a.vacancy === loader.id && a.source === 'Careers page (embedded)')
    assert.deepEqual([tagged.answers.map(a => a.value), tagged.tags], [['yes'], ['Can lift']])
  })

  await t.test('ATTR-005 the internal job board: employees see public and internal-only jobs and apply as members; internal applications stay with the hiring team and count as internal moves', async () => {
    const shifts = await cmd('department', { name: 'Shift operations' })
    const job = async (title, internalOnly) => {
      const v = await cmd('vacancy', { title, departmentId: internalOnly ? shifts.id : undefined, location: 'Denver, CO', headcount: 1, manager: 'morgan@example.test', compensation: RANGE }, manager)
      await cmd('rubric', { id: v.id, criteria: RUBRIC }, manager)
      await cmd('interview-plan', { id: v.id, plan: [{ name: 'Talk', stageName: 'Interview', durationMinutes: 30 }] }, manager)
      await approve((await cmd('request-vacancy-approval', { id: v.id, approver: 'parker@example.test' }, manager)).id)
      if (internalOnly) await cmd('vacancy-internal', { id: v.id, internalOnly: true }, manager)
      return cmd('publish', { id: v.id }, manager)
    }
    const lead = await job('Shift lead (internal)', true), planner = await job('Route planner', false)
    assert.equal((await send('/api/lodge/command/vacancy-internal', { id: lead.id, internalOnly: false }, ivy)).status, 403, 'only the people who run the job set it')
    const emma = await h.member('emma@example.test', ['interviewer'], 'Emma Stone'), otto = await h.member('otto@example.test', ['interviewer'], 'Otto Berg')
    await cmd('reports-to', { email: 'emma@example.test', reportsTo: 'ian@example.test' })
    await cmd('internal-policy', { notifyManager: true })

    // An employee sees both jobs and applies to the internal one with their member identity.
    const board = (await state(emma)).internalBoard
    assert.deepEqual([lead.id, planner.id].map(id => board.find(j => j.id === id)?.internalOnly), [true, false])
    const applied = await cmd('apply-internal', { vacancy: lead.id }, emma)
    assert.equal((await send('/api/lodge/command/apply-internal', { vacancy: lead.id }, emma)).status, 409, 'once per job')
    assert.ok((await state(emma)).internalBoard.find(j => j.id === lead.id).applied, 'the applicant sees that they applied, and when')
    assert.equal((await state(emma)).applications.some(a => a.id === applied.id), false, 'and nothing more of the application')

    // The internal-only job never leaves Lodge: not on /jobs, the embed or the public board.
    assert.ok(!(await send('/jobs')).text.includes('Shift lead (internal)') && (await send('/jobs')).text.includes('Route planner'))
    assert.ok(!(await send('/embed/jobs')).text.includes('Shift lead (internal)'))
    const boardApi = (await send('/api/board/v1/example-builders/jobs')).value.jobs
    assert.ok(!boardApi.some(j => j.id === lead.id) && boardApi.some(j => j.id === planner.id))
    assert.equal((await send(`/api/board/v1/example-builders/jobs/${lead.id}`)).status, 404)
    assert.equal((await send('/api/board/v1/example-builders/departments')).value.departments.some(d => d.id === shifts.id), false, 'nor in the department counts')

    // Source "Internal"; seen by the owner and the job's hiring manager, never by another employee or a reviewer outside the team.
    const app = (await state()).applications.find(a => a.id === applied.id)
    assert.deepEqual([app.source, app.internal, app.sourceEntry?.type], ['Internal', true, 'internal'])
    assert.ok((await state(manager)).applications.some(a => a.id === applied.id), 'the hiring manager sees it')
    assert.equal((await state(otto)).applications.some(a => a.id === applied.id), false, 'another employee does not')
    await cmd('assign-reviewers', { application: applied.id, reviewers: ['otto@example.test'] }, manager)
    assert.equal((await state(otto)).applications.some(a => a.id === applied.id), false, 'not even when assigned, while outside the hiring team')
    // The manager it reports to hears who applied to which job, only because the admins turned it on.
    assert.deepEqual((await state(ian)).internalNotices.map(n => [n.who, n.title]), [['Emma Stone', 'Shift lead (internal)']])
    assert.equal((await state(ian)).applications.some(a => a.id === applied.id), false)

    // REPORT-001: internal applications and moves apart from external ones.
    const offer = await cmd('offer', { application: applied.id, title: 'Shift lead', salary: { currency: 'USD', amount: 9500000, period: 'year' }, startDate: '2026-12-01', opening: lead.openings[0].id }, manager)
    await approve((await cmd('request-offer-approval', { id: offer.id, approver: 'parker@example.test' }, manager)).id)
    await cmd('offer-outcome', { id: offer.id, outcome: 'accepted', reason: 'Accepted the move' }, manager)
    const report = (await send('/api/lodge/reports/openings', undefined, manager)).value
    assert.deepEqual([report.internal.moves >= 1, report.internal.applications >= 1], [true, true])
    assert.equal(report.external.hires, report.funnel.hired - report.internal.moves, 'external hires leave out internal moves')
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
