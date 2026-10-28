import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { BUSINESS, harness } from './harness.mjs'
import { RANGE, RUBRIC, hiringScenario } from './hiring-fixture.mjs'
const b64 = text => Buffer.from(text).toString('base64')

import { checkMerge } from './merge-flow.mjs'
import { checkResumeIntake } from './resume-driver.mjs'
import { checkErasure } from './retention-flow.mjs'
import { checkMessageTemplates } from './message-template-flow.mjs'

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

})

test('Candidate intake, job setup and reviewed bulk flows through real HTTP and D1', async t => {
  const { h, cmd, send, state, owner, manager, approver, ivy, ian, approve, openJob } = await hiringScenario(t)
  const vacancy = await openJob('Closed site supervisor', 'Brooklyn, NY')
  await cmd('candidate', { name: 'Dana Whitfield', email: 'dana@example.test', source: 'Application page', consentBasis: 'application', vacancy: vacancy.id }, manager)
  await cmd('close-vacancy', { id: vacancy.id, reason: 'Role filled before the event journey' }, manager)
  let carpenter
  const declineTemplate = await cmd('rejection-template', { name: 'Standard decline', subject: 'Your application for {job_title}', body: 'Dear {candidate_name},\nThank you for applying. We will not move forward.\n{business_name}' })

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

  await t.test('a receipt for a repeat job-board submission verifies no privacy request about the earlier application', async () => {
    const view = await state()
    const loader = view.vacancies.find(v => v.title === 'Night loader'), lift = view.questions.find(q => q.versions[0].text === 'Can you lift 50 pounds?')
    const fromSite = () => send(`/api/board/v1/example-builders/jobs/${loader.id}/applications`, { name: 'Nell Price', email: 'nell@example.test', noticeVersion: view.business.notices.at(-1).version, consent: true, answers: { [lift.id]: 'yes' } }, '', { origin: 'https://careers.example.test', 'cf-connecting-ip': '203.0.113.31' })
    const own = await fromSite(), repeat = await fromSite()
    assert.deepEqual([own.status, repeat.status], [201, 201])
    const ask = receipt => { const f = new FormData(); for (const [k, x] of Object.entries({ type: 'deletion', name: 'Nell Price', email: 'nell@example.test', receipt })) f.append(k, x); return send('/privacy-requests', f) }
    assert.match((await ask(repeat.value.receipt)).text, /Not verified/)
    assert.match((await ask(own.value.receipt)).text, /Verified by receipt code and email on record/)
    const after = await state(), nell = after.candidates.find(c => c.email === 'nell@example.test')
    const request = receipt => after.dataRequests.find(r => r.identity?.receipt === receipt)
    assert.deepEqual([repeat.value.receipt, own.value.receipt].map(code => [request(code).candidate, request(code).status]), [[null, 'unverified'], [nell.id, 'open']])
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

  await t.test('ATTR-012 several posts per job: each post lists with its own title and approved locations on its destinations; applications land on the one job with the post; pausing, an unapproved location and closing the job', async () => {
    const offices = (await state()).offices, denver = offices.find(o => o.name === 'Denver, CO'), aurora = offices.find(o => o.name === 'Aurora, CO')
    const boulder = await cmd('office', { name: 'Boulder, CO' })
    const lift = (await state()).questions.find(q => q.versions[0].text === 'Can you lift 50 pounds?')
    const v = await cmd('vacancy', { title: 'Warehouse Associate', officeId: denver.id, locations: [aurora.id], payRanges: [denver, aurora].map(o => ({ officeId: o.id, compensation: RANGE })), headcount: 2, manager: 'morgan@example.test', compensation: RANGE, description: 'Pick and pack.' }, manager)
    assert.deepEqual(v.locations, [aurora.id], 'approved for Denver (its office) and Aurora')
    await cmd('rubric', { id: v.id, criteria: RUBRIC }, manager)
    await cmd('interview-plan', { id: v.id, plan: [{ name: 'Floor walk', stageName: 'Interview', durationMinutes: 30 }] }, manager)
    await approve((await cmd('request-vacancy-approval', { id: v.id, approver: 'parker@example.test' }, manager)).id)
    const everywhere = ['careers', 'embed', 'api']
    const denverPost = (await cmd('job-post', { vacancy: v.id, title: 'Warehouse Associate — Denver', description: 'Denver warehouse, day shift.', locations: [denver.id], destinations: everywhere }, manager)).posts[0]
    const status = (post, s, cookie = manager) => send('/api/lodge/command/post-status', { vacancy: v.id, post: post.id, status: s }, cookie)
    assert.equal((await status(denverPost, 'live')).status, 409, 'a post goes live only on a published job')
    const job = await cmd('publish', { id: v.id }, manager)
    const careers = async () => [...(await send('/jobs')).text.matchAll(/<li><a href="\/jobs\/[^"]+">([^<]+)<\/a>/g)].map(m => m[1])
    const embedded = async () => [...(await send('/embed/jobs')).text.matchAll(/<li><a href="\/embed\/jobs\/[^"?]+[^"]*">([^<]+)<\/a>/g)].map(m => m[1])
    const api = async () => (await send('/api/board/v1/example-builders/jobs')).value.jobs.filter(j => j.jobId === v.id)
    assert.ok((await send('/jobs')).text.includes(`/jobs/${job.slug}"`), 'until a post goes live the job keeps its own page')

    // Two posts go live; the job now reaches applicants only through them, each with its own title, wording and location.
    await cmd('post-status', { vacancy: v.id, post: denverPost.id, status: 'live' }, manager)
    const auroraPost = (await cmd('job-post', { vacancy: v.id, title: 'Material Handler — Aurora', description: 'Aurora cross-dock, nights.', locations: [aurora.id], destinations: everywhere, questions: [{ question: lift.id, required: true }] }, manager)).posts[1]
    await cmd('post-status', { vacancy: v.id, post: auroraPost.id, status: 'live' }, manager)
    const both = ['Material Handler — Aurora', 'Warehouse Associate — Denver']
    for (const titles of [await careers(), await embedded()]) assert.deepEqual(both.map(x => titles.includes(x)), [true, true])
    for (const path of ['/jobs', '/embed/jobs']) assert.ok(!(await send(path)).text.includes(job.slug), path + ' no longer lists the job’s own page')
    assert.equal((await send('/jobs/' + job.slug)).status, 404, 'the job’s own page gives way to its posts')
    const listed = await api()
    assert.deepEqual(listed.map(j => [j.title, j.postId, j.offices.map(o => o.name), j.pay[0].max]).sort(), [['Material Handler — Aurora', auroraPost.id, ['Aurora, CO'], RANGE.max], ['Warehouse Associate — Denver', denverPost.id, ['Denver, CO'], RANGE.max]], 'each post carries the job’s one approved pay range')
    const denverPage = await send('/jobs/' + denverPost.slug), auroraPage = await send('/jobs/' + auroraPost.slug)
    assert.ok(denverPage.text.includes('Denver warehouse, day shift.') && denverPage.text.includes('Denver, CO') && !denverPage.text.includes(`name="q-${lift.id}"`))
    assert.ok(auroraPage.text.includes('Aurora cross-dock, nights.') && auroraPage.text.includes(`name="q-${lift.id}"`), 'the Aurora post asks its own extra question')

    // Apply through each: the hosted Denver post and the Aurora post through the board API land on the one job, post and source recorded.
    const notice = denverPage.text.match(/name="noticeVersion" value="(\d+)"/)[1]
    const f = new FormData(); for (const [k, x] of Object.entries({ name: 'Ines Park', email: 'ines@example.test', noticeVersion: notice, consent: 'yes' })) f.set(k, x)
    const hosted = await send('/jobs/' + denverPost.slug, f)
    assert.equal(hosted.status, 200, hosted.text.slice(0, 400))
    assert.match(hosted.text, /<dt>Role<\/dt><dd>Warehouse Associate — Denver<\/dd>/)
    const viaApi = body => send(`/api/board/v1/example-builders/jobs/${auroraPost.id}/applications`, { name: 'Omar Haddad', email: 'omar@example.test', noticeVersion: Number(notice), consent: true, ...body }, '', { origin: 'https://careers.example.test', 'cf-connecting-ip': '203.0.113.21' })
    assert.deepEqual([(await viaApi({})).status, (await viaApi({})).value.field], [400, 'answers.' + lift.id], 'the post’s extra question is required')
    assert.equal((await viaApi({ answers: { [lift.id]: 'yes' } })).status, 201)
    const apps = (await state(manager)).applications.filter(a => a.vacancy === v.id)
    assert.deepEqual(apps.map(a => [a.candidateName, a.post, a.postTitle, a.source]).sort(), [['Ines Park', denverPost.id, 'Warehouse Associate — Denver', 'Application page'], ['Omar Haddad', auroraPost.id, 'Material Handler — Aurora', 'Careers page (API)']])

    // A post's title changes without a new approval; pay or headcount still needs one.
    await cmd('job-post', { vacancy: v.id, post: denverPost.id, title: 'Warehouse Associate — Denver days', description: 'Denver warehouse, day shift.', locations: [denver.id], destinations: everywhere }, manager)
    assert.deepEqual([(await careers()).includes('Warehouse Associate — Denver days'), (await state(manager)).vacancies.find(x => x.id === v.id).approvedNow], [true, true])
    assert.equal((await send('/api/lodge/command/vacancy', { ...job, headcount: 3 }, manager)).status, 409, 'headcount changes need the job unpublished and approved again')
    // A location the job was not approved for is refused, on a new post or an edit.
    const boulderPost = await send('/api/lodge/command/job-post', { vacancy: v.id, title: 'Warehouse Associate — Boulder', locations: [boulder.id], destinations: everywhere }, manager)
    assert.equal(boulderPost.status, 409)
    assert.match(boulderPost.value.error, /Boulder, CO is not one of this job’s approved locations/)
    assert.equal((await send('/api/lodge/command/job-post', { vacancy: v.id, post: denverPost.id, title: 'x', locations: [denver.id, boulder.id], destinations: everywhere }, manager)).status, 409)
    assert.equal((await status(auroraPost, 'paused', ivy)).status, 403, 'only the people who run the job change its posts')

    // Pausing the Aurora post takes it off the careers page, the embed and the API; the Denver post stays. Each destination is chosen per post.
    await cmd('post-status', { vacancy: v.id, post: auroraPost.id, status: 'paused' }, manager)
    for (const titles of [await careers(), await embedded(), (await api()).map(j => j.title)]) assert.deepEqual([titles.includes('Material Handler — Aurora'), titles.includes('Warehouse Associate — Denver days')], [false, true])
    assert.deepEqual([(await send('/jobs/' + auroraPost.slug)).status, (await send(`/api/board/v1/example-builders/jobs/${auroraPost.id}`)).status], [404, 404])
    await cmd('job-post', { vacancy: v.id, post: denverPost.id, title: 'Warehouse Associate — Denver days', locations: [denver.id], destinations: ['careers'] }, manager)
    assert.deepEqual([(await careers()).includes('Warehouse Associate — Denver days'), (await embedded()).includes('Warehouse Associate — Denver days'), (await api()).length], [true, false, 0])
    await cmd('job-post', { vacancy: v.id, post: denverPost.id, title: 'Warehouse Associate — Denver days', locations: [denver.id], destinations: everywhere }, manager)
    await cmd('post-status', { vacancy: v.id, post: auroraPost.id, status: 'live' }, manager)

    // REPORT-001 by post: applications, source and conversion for each post.
    const byPost = (await send('/api/lodge/reports/sources', undefined, manager)).value.byPost.filter(r => r.vacancy === v.id)
    assert.deepEqual(byPost.map(r => [r.post, r.applications, r.sources.map(x => x.name), r.advanced]).sort(), [[auroraPost.id, 1, ['Careers page (API)'], 0], [denverPost.id, 1, ['Application page'], 0]].sort())

    // Closing the job closes every post on every destination.
    await cmd('close-vacancy', { id: v.id, reason: 'Filled from the agency pool' }, manager)
    for (const titles of [await careers(), await embedded()]) assert.ok(!titles.some(x => x === 'Material Handler — Aurora' || x === 'Warehouse Associate — Denver days'))
    for (const post of [denverPost, auroraPost]) assert.equal((await send('/jobs/' + post.slug)).status, 404)
    assert.deepEqual(await api(), [])
    assert.deepEqual((await state(manager)).vacancies.find(x => x.id === v.id).posts.map(p => p.status), ['closed', 'closed'])
  })

  await t.test('CRM-009 a campus career fair: staff and QR captures join the event pool with source, notice and consent; a repeated sync adds nobody; duplicates go to review; nobody applies until a recruiter adds them; the report counts attendees and the hire with cost per hire', async () => {
    const intern = await cmd('vacancy', { title: 'Summer Site Intern', location: 'Brooklyn, NY', headcount: 1, manager: 'morgan@example.test', compensation: { currency: 'USD', min: 4000000, max: 4500000, period: 'year' }, description: 'Ten weeks on site.' }, manager)
    await cmd('rubric', { id: intern.id, criteria: RUBRIC }, manager)
    await cmd('interview-plan', { id: intern.id, plan: [{ name: 'Campus chat', stageName: 'Interview', durationMinutes: 30 }] }, manager)
    await approve((await cmd('request-vacancy-approval', { id: intern.id, approver: 'parker@example.test' }, manager)).id)
    await cmd('publish', { id: intern.id }, manager)
    const fair = await cmd('event', { name: 'State U spring career fair', kind: 'campus', date: '2026-11-04', location: 'State U student center', owner: 'morgan@example.test', jobs: [intern.id], budget: 300000 }, manager)
    const source = 'Event: State U spring career fair', nv = (await state()).business.notices.at(-1).version
    assert.deepEqual([fair.status, /^[a-f0-9]{48}$/.test(fair.token), (await state()).sources.find(x => x.name === source)?.type], ['open', true, 'event'], 'the event opens with its QR token and its own CRM-008 source')
    assert.equal((await send('/api/lodge/command/event', { name: 'Other fair', kind: 'campus', date: '2026-11-05', location: 'Gym', jobs: [intern.id] }, approver)).status, 403, 'only recruiters create events')

    // An attendee registers at the QR link: the current notice and its version, contact consent unchecked, a honeypot.
    const page = await send('/events/' + fair.token)
    assert.equal(page.status, 200)
    assert.ok(page.text.includes(`name="noticeVersion" value="${nv}"`))
    assert.match(page.text, /<input type="checkbox" name="consentToContact" value="yes"> You may contact me/)
    assert.match(page.text, /name="website"/)
    const form = fields => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f }
    const lena = { name: 'Priya Natarajan', email: 'priya.natarajan@example.test', interests: 'Civil engineering internships', noticeVersion: String(nv), noticeShown: 'yes', consentToContact: 'yes' }
    assert.equal((await send('/events/' + fair.token, form({ ...lena, noticeVersion: '0' }))).status, 409, 'a stale notice is refused')
    assert.equal((await send('/events/' + fair.token, form({ ...lena, noticeShown: '' }))).status, 400, 'the notice must be acknowledged')
    assert.equal((await send('/events/' + fair.token, form({ ...lena, website: 'spam.example' }))).status, 400, 'the honeypot refuses bots')
    assert.equal((await send('/events/' + fair.token, form(lena), '', { origin: 'https://elsewhere.example' })).status, 403, 'another site cannot post the form')
    const registered = await send('/events/' + fair.token, form(lena))
    assert.equal(registered.status, 200, registered.text.slice(0, 400))
    assert.ok(registered.text.includes(`privacy notice version ${nv}`))

    // Staff capture on a phone: one online with a resume photo, one made offline and synced twice (one person), one already a candidate.
    const capture = (body, cookie = manager) => send('/api/lodge/command/event-capture', { event: fair.id, noticeVersion: nv, noticeShown: true, ...body }, cookie)
    const jordan = await capture({ captureId: 'cap-online-0001', name: 'Jordan Bell', email: 'jordan.bell@example.test', interests: 'Site engineering', consentToContact: true, resume: { name: 'jordan-resume.jpg', mediaType: 'image/jpeg', base64: b64('a photo of a resume') } })
    assert.equal(jordan.status, 200, JSON.stringify(jordan.value))
    const offline = { captureId: 'cap-offline-0002', name: 'Theo Lindqvist', phone: '+1 555 0142', interests: 'Estimating', consentToContact: false }
    const [first, again] = [await capture(offline), await capture(offline)]
    assert.deepEqual([first.value.replayed, again.value.replayed, again.value.candidate], [false, true, first.value.candidate], 'a repeated sync of one capture adds nobody')
    const dana = await capture({ captureId: 'cap-online-0003', name: 'Dana Whitfield', email: 'dana@example.test', consentToContact: true })
    assert.equal(dana.status, 200)
    assert.equal((await capture({ captureId: 'cap-online-0004', name: 'No Way To Reach' })).status, 400, 'a capture needs an email or a phone')
    assert.equal((await capture({ captureId: 'cap-online-0005', name: 'Old Notice', email: 'old@example.test', noticeVersion: 0 })).status, 409)
    for (const outsider of [approver, ivy]) assert.equal((await capture({ captureId: 'cap-outsider-01', name: 'Sneaky', email: 'sneak@example.test' }, outsider)).status, 404, 'an event outside the reader’s view is not found')

    // After sync the pool holds four people with the event source, the notice version and their consent; nobody has an application.
    let ev = (await state(manager)).events.find(e => e.id === fair.id)
    assert.deepEqual(ev.pool.map(p => [p.name, p.source, p.consent.basis, p.consent.noticeVersion, p.consent.toContact, p.applications.length]).sort(), [
      ['Dana Whitfield', source, 'event-capture', nv, true, 0], ['Jordan Bell', source, 'event-capture', nv, true, 0],
      ['Priya Natarajan', source, 'event-capture', nv, true, 0], ['Theo Lindqvist', source, 'event-capture', nv, false, 0]])
    assert.deepEqual([ev.report.attendees, ev.report.applications], [4, 0])
    assert.equal(ev.pool.find(p => p.name === 'Priya Natarajan').by, 'attendee')
    const photo = (await state(manager)).documents.find(d => d.candidate === jordan.value.candidate)
    assert.deepEqual([photo.kind, photo.source, (await send('/api/lodge/download/document/' + photo.id, undefined, manager)).text], ['resume', source, 'a photo of a resume'])
    // The existing candidate is offered for LDG-005 review, never merged.
    const dup = (await state()).duplicates.find(d => [d.first, d.second].includes(dana.value.candidate))
    assert.ok(dup?.reasons.includes('same email'), JSON.stringify((await state()).duplicates))
    // The pool is the event owner's and the linked job's team's: a manager or interviewer outside them sees nobody.
    for (const outsider of [approver, ivy]) {
      const w = await state(outsider)
      assert.deepEqual([w.events.length, w.candidates.some(c => ev.pool.some(p => p.candidate === c.id))], [0, false])
    }

    // Only a recruiter adds someone, and only to a linked job.
    assert.equal((await send('/api/lodge/command/event-apply', { event: fair.id, candidate: jordan.value.candidate, vacancy: vacancy.id }, manager)).status, 409)
    assert.equal((await send('/api/lodge/command/event-apply', { event: fair.id, candidate: jordan.value.candidate, vacancy: intern.id }, approver)).status, 404)
    const app = await cmd('event-apply', { event: fair.id, candidate: jordan.value.candidate, vacancy: intern.id }, manager)
    assert.deepEqual([app.source, app.event, app.status], [source, fair.id, 'active'])
    const plan = (await state(manager)).vacancies.find(v => v.id === intern.id).plan
    const iv = await cmd('interview', { application: app.id, planItem: plan[0].id, participants: ['ivy@example.test'], slots: [new Date(Date.now() + 5 * 86400000).toISOString()] }, manager)
    await cmd('schedule', { interview: iv.id, slot: 0 }, manager)
    const [opening] = (await state(manager)).vacancies.find(v => v.id === intern.id).openings
    const offer = await cmd('offer', { application: app.id, title: 'Summer Site Intern', startDate: '2027-06-01', salary: { currency: 'USD', amount: 4200000, period: 'year' }, opening: opening.id }, manager)
    await approve((await cmd('request-offer-approval', { id: offer.id, approver: 'parker@example.test' }, manager)).id)
    await cmd('offer-outcome', { id: offer.id, outcome: 'accepted', reason: 'Accepted at the fair follow-up' }, manager)
    await cmd('event-cost', { id: fair.id, label: 'Booth fee', amount: 120000 }, manager)
    await cmd('event-cost', { id: fair.id, label: 'Travel', amount: 45001 }, manager)
    assert.equal((await send('/api/lodge/command/event-cost', { id: fair.id, label: 'Lunch', amount: 100 }, approver)).status, 404, 'an event outside the reader’s view is not found')

    // The event report: attendees, applications, interviews, the one hire, and recorded costs over hires (cents, half up).
    const report = (await send('/api/lodge/reports/events', undefined, manager)).value.events.find(e => e.id === fair.id)
    assert.deepEqual([report.attendees, report.applications, report.interviews, report.hires, report.costs, report.budget, report.costPerHire], [4, 1, 1, 1, 165001, 300000, 165001])
    assert.deepEqual((await send('/api/lodge/reports/events', undefined, approver)).value.events, [])

    // Closing registration closes the QR door; staff capture still syncs.
    await cmd('event-status', { id: fair.id, status: 'closed' }, manager)
    assert.deepEqual([(await send('/events/' + fair.token)).status, (await send('/events/' + fair.token, form({ ...lena, email: 'late@example.test' }))).status], [410, 410])
    assert.equal((await capture({ captureId: 'cap-after-0006', name: 'Late Walk-up', email: 'walkup@example.test' })).status, 200)
    ev = (await state(manager)).events.find(e => e.id === fair.id)
    assert.equal(ev.report.attendees, 5)
  })

  await t.test('DATA-003 reviewed bulk actions across two jobs: preview per item, apply only unchanged and still-authorized items with each outcome shown and audited, a resubmitted batch changes nothing; bulk rejection, archive, export and personalized message drafts', async () => {
    const publishJob = async (title, lead = 'morgan@example.test', cookie = manager) => {
      const v = await cmd('vacancy', { title, location: 'Queens, NY', headcount: 2, manager: lead, compensation: RANGE, description: 'Bulk review job.' }, cookie)
      await cmd('rubric', { id: v.id, criteria: RUBRIC }, cookie)
      await cmd('interview-plan', { id: v.id, plan: [{ name: 'Yard talk', stageName: 'Interview', durationMinutes: 30 }] }, cookie)
      await approve((await cmd('request-vacancy-approval', { id: v.id, approver: 'parker@example.test' }, cookie)).id)
      return cmd('publish', { id: v.id }, cookie)
    }
    // Morgan runs the Welder job as its manager and the Rigger job through a recruiter grant (REQ-003).
    const [welder, rigger] = [await publishJob('Bulk Welder'), await publishJob('Bulk Rigger', 'mona@example.test', owner)]
    await cmd('hiring-team', { id: rigger.id, recruiters: ['morgan@example.test'] })
    const add = async (name, job) => (await cmd('candidate', { name, email: name.toLowerCase().replace(' ', '.') + '@bulk.example.test', source: 'Job board', consentBasis: 'application', vacancy: job.id }, manager)).application
    const [w1, r1, w2, r2] = [await add('Ola Fenn', welder), await add('Pim Varga', rigger), await add('Ruth Kemal', welder), await add('Saul Ito', rigger)]
    const bulk = (op, body, cookie = manager) => send('/api/lodge/command/' + op, body, cookie)

    // Preview a move to Screen across both jobs; an application outside the reader's view is refused like an unknown one.
    const moveTo = { kind: 'move', stage: 'Screen', reason: 'Strong portfolios' }
    const preview = (await bulk('bulk-preview', { items: [w1.id, r1.id, 'not-an-application'], action: moveTo })).value
    assert.deepEqual([preview.ready, preview.refused, preview.items.map(i => i.ok), preview.items[2].refusal], [2, 1, [true, true, false], 'Application not found'])
    assert.deepEqual(preview.items.slice(0, 2).map(i => [i.candidateName, i.job]), [['Ola Fenn', 'Bulk Welder'], ['Pim Varga', 'Bulk Rigger']])
    assert.equal((await state(manager)).applications.find(a => a.id === w1.id).stage, w1.stage, 'a preview changes nothing')
    assert.equal((await bulk('bulk-preview', { items: [w1.id], action: moveTo }, ivy)).value.items[0].refusal, 'Application not found', 'an interviewer cannot act on applications they do not run')

    // Before apply, one candidate's record changes: that item is refused with the reason, the other moves, each audited.
    await cmd('correct-candidate', { id: w1.candidate, name: 'Ola Fenn', email: 'ola.fenn@bulk.example.test', phone: '+1 555 0199', reason: 'Phone added' })
    const previewed = Object.fromEntries(preview.items.filter(i => i.ok).map(i => [i.application, i.seen]))
    const batch = 'bulk-move-0001'
    const applied = (await bulk('bulk-apply', { batch, items: [w1.id, r1.id, 'not-an-application'], action: moveTo, previewed })).value
    assert.deepEqual([applied.applied, applied.refused, applied.items.map(i => i.ok)], [1, 2, [false, true, false]], 'partial failure is counted as partial')
    assert.match(applied.items[0].refusal, /changed since the preview/)
    let w = await state(manager)
    const stageOf = app => { const a = w.applications.find(x => x.id === app.id); return w.vacancies.find(v => v.id === a.vacancy).stages.find(st => st.id === a.stage).name }
    assert.deepEqual([stageOf(w1), stageOf(r1)], ['Applied', 'Screen'])
    const audit = (await state()).audit
    assert.ok(audit.some(e => e.action === 'bulk-item-refused' && e.record === 'application:' + w1.id) && audit.some(e => e.action === 'bulk-applied' && e.applied === 1 && e.refused === 2))
    // Resubmitting the same batch returns its outcome and moves nobody again.
    const again = (await bulk('bulk-apply', { batch, items: [w1.id, r1.id], action: moveTo, previewed })).value
    assert.deepEqual([again.replayed, again.applied], [true, 1])
    assert.equal(w.applications.find(a => a.id === r1.id).history.filter(h => h.reason === 'Strong portfolios').length, 1)

    // Bulk tags and reviewers go through the same per-item checks.
    const tagged = (await bulk('bulk-preview', { items: [w2.id, r2.id], action: { kind: 'tag', tag: 'Night shift' } })).value
    const tagSeen = Object.fromEntries(tagged.items.map(i => [i.application, i.seen]))
    assert.equal((await bulk('bulk-apply', { batch: 'bulk-tag-0001', items: [w2.id, r2.id], action: { kind: 'tag', tag: 'Night shift' }, previewed: tagSeen })).value.applied, 2)

    // Bulk rejection: a DISP-001 reason and a two-business-day template; the preview shows each recipient and filled text.
    const template = await cmd('rejection-template', { name: 'Bulk certification', subject: 'Your application for {job_title}', body: 'Dear {candidate_name}, thank you. — {business_name}' })
    const reject = { kind: 'reject', closeReason: 'certification', send: 'delay', businessDays: 2, template: template.id }
    const rp = (await bulk('bulk-preview', { items: [w2.id, r2.id], action: reject })).value
    assert.deepEqual(rp.items.map(i => [i.email.to, i.email.subject, i.email.body]), [
      ['ruth.kemal@bulk.example.test', 'Your application for Bulk Welder', 'Dear Ruth Kemal, thank you. — Example Builders'],
      ['saul.ito@bulk.example.test', 'Your application for Bulk Rigger', 'Dear Saul Ito, thank you. — Example Builders']])
    const rejectSeen = Object.fromEntries(rp.items.map(i => [i.application, i.seen]))
    for (let i = 0; i < 2; i++) await bulk('bulk-apply', { batch: 'bulk-reject-0001', items: [w2.id, r2.id], action: reject, previewed: rejectSeen })
    w = await state(manager)
    for (const app of [w2, r2]) {
      assert.deepEqual([w.applications.find(a => a.id === app.id).status, w.rejectionEmails.filter(m => m.application === app.id).map(m => [m.businessDays, m.state])], ['rejected', [[2, 'scheduled']]], 'one scheduled DISP-001 email each, even after resubmission')
      assert.equal(w.applications.find(a => a.id === app.id).history.at(-1).reason, 'Lacks required certification')
    }

    // Archive closes with a listed reason (a "they withdrew" one closes as withdrawn) and never an email.
    const archive = { kind: 'archive', closeReason: 'no-response', note: 'No reply in three weeks' }
    const ap = (await bulk('bulk-preview', { items: [w1.id], action: archive })).value
    await bulk('bulk-apply', { batch: 'bulk-archive-0001', items: [w1.id], action: archive, previewed: { [w1.id]: ap.items[0].seen } })
    w = await state(manager)
    const archived = w.applications.find(a => a.id === w1.id)
    assert.deepEqual([archived.status, archived.history.at(-1).reason, w.rejectionEmails.filter(m => m.application === w1.id).length], ['withdrawn', 'Stopped responding', 0])

    // Export hands back one file of the selected applications as Morgan's workspace shows them, audited with its digest; a replay hands back no second file.
    const ep = (await bulk('bulk-preview', { items: [w1.id, r1.id], action: { kind: 'export' } })).value
    const exportBody = { batch: 'bulk-export-0001', items: [w1.id, r1.id], action: { kind: 'export' }, previewed: Object.fromEntries(ep.items.map(i => [i.application, i.seen])) }
    const exported = (await bulk('bulk-apply', exportBody)).value
    assert.deepEqual([exported.file.format, exported.file.items.map(i => [i.candidate.name, i.vacancy.title, i.application.history.length > 1])], ['lodge-bulk-export-1', [['Ola Fenn', 'Bulk Welder', true], ['Pim Varga', 'Bulk Rigger', true]]])
    assert.ok((await state()).audit.some(e => e.action === 'bulk-exported' && e.digest === exported.digest && e.applied === 2))
    assert.deepEqual([(await bulk('bulk-apply', exportBody)).value.replayed, (await bulk('bulk-apply', exportBody)).value.file], [true, undefined])

    // A personalized message: each preview shows the recipient and filled text; a candidate with no email on record is refused.
    const [w3, r3] = [await add('Tova Lund', welder), await add('Uri Bass', rigger)]
    const w4 = (await cmd('candidate', { name: 'Vic Nolan', source: 'Job board', consentBasis: 'application', vacancy: welder.id }, manager)).application
    const note = { kind: 'message', purpose: 'other', subject: 'Next step for {job_title}', body: 'Hi {candidate_name}, can you talk this week? — {business_name}', approver: 'mona@example.test' }
    assert.equal((await bulk('bulk-preview', { items: [w3.id], action: { ...note, body: 'Hi {first_name}' } })).status, 400, 'an unknown merge field is refused')
    const mp = (await bulk('bulk-preview', { items: [w3.id, r3.id, w4.id], action: note })).value
    assert.deepEqual(mp.items.map(i => i.ok ? [i.email.to, i.email.subject, i.email.body, i.email.sent] : i.refusal), [
      ['tova.lund@bulk.example.test', 'Next step for Bulk Welder', 'Hi Tova Lund, can you talk this week? — Example Builders', false],
      ['uri.bass@bulk.example.test', 'Next step for Bulk Rigger', 'Hi Uri Bass, can you talk this week? — Example Builders', false],
      'This candidate has no email address'])
    // Before apply the owner takes Morgan off the Rigger team: that item is refused, twice alike, and nothing is drafted for it.
    await cmd('hiring-team', { id: rigger.id })
    const messageSeen = Object.fromEntries(mp.items.filter(i => i.ok).map(i => [i.application, i.seen]))
    for (let i = 0; i < 2; i++) {
      const sent = (await bulk('bulk-apply', { batch: 'bulk-message-0001', items: [w3.id, r3.id], action: note, previewed: messageSeen })).value
      assert.deepEqual([sent.applied, sent.refused, sent.items.map(x => x.ok), sent.items[1].refusal], [1, 1, [true, false], 'Application not found'])
    }
    const messages = (await state()).messages
    assert.equal(messages.filter(m => m.application === r3.id).length, 0, 'no unauthorized change')
    assert.deepEqual(messages.filter(m => m.application === w3.id).map(m => [m.to, m.body, m.downloads.length, m.approval.status, m.approval.approver]),
      [['tova.lund@bulk.example.test', 'Hi Tova Lund, can you talk this week? — Example Builders', 0, 'pending', 'mona@example.test']], 'one draft awaiting exact approval, never sent, even after resubmission')
    await checkMessageTemplates()
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

  await t.test('rule previews and the rule-match queue leave out applications the reader cannot see', async () => {
    const library = (await state()).questions, q = text => library.find(x => x.versions[0].text === text).id
    const [authorized, relocate, cdl, story] = [q('Are you legally authorized to work in the US?'), q('Willing to relocate?'), q('Years holding a Class A CDL'), q('Tell us about a job you finished early')]
    const cdlRoute = (await state()).screeningRules.find(r => r.vacancy === carpenter.id && r.name === 'Short CDL')
    const relocation = { name: 'Relocation', question: relocate, when: { equals: ['No'] }, then: { kind: 'propose-reject', reason: 'Must relocate', closeReason: 'work-authorization' } }
    const rule = await cmd('screening-rule', { vacancy: carpenter.id, ...relocation })
    const { slug: jobSlug } = (await state(manager)).vacancies.find(v => v.id === carpenter.id)
    const f = new FormData()
    for (const [k, v] of Object.entries({ name: 'Ines Vale', email: 'ines.vale@example.test', noticeVersion: (await send('/jobs/' + jobSlug)).text.match(/name="noticeVersion" value="(\d+)"/)[1], consent: 'yes', ['q-' + story]: 'Finished a roof early.', ['q-' + authorized]: 'yes', ['q-' + relocate]: 'No', ['q-' + cdl]: '0' })) f.append(k, v)
    assert.equal((await send('/jobs/' + jobSlug, f)).status, 200)
    const ines = (await state()).applications.find(x => x.candidateName === 'Ines Vale')
    await cmd('candidate-privacy', { id: ines.candidate, private: true })
    const match = (await state()).ruleMatches.find(m => m.application === ines.id && m.rule === rule.id)
    assert.ok(!(await send('/api/lodge/command/preview-rule', { id: cdlRoute.id }, manager)).text.includes(ines.id), 'a preview lists only applications the reader sees')
    assert.equal((await send('/api/lodge/command/decide-rule-matches', { id: match.id, decision: 'confirm' }, manager)).status, 404)
    assert.equal((await send('/api/lodge/command/decide-rule-matches', { vacancy: carpenter.id, all: true, decision: 'confirm' }, manager)).status, 409, 'the whole queue holds nothing the reader sees')
    assert.deepEqual([(await state()).applications.find(x => x.id === ines.id).status, (await state()).ruleMatches.find(m => m.id === match.id).status], ['active', 'queued'])
    assert.ok((await send('/api/lodge/command/preview-rule', { id: cdlRoute.id }, owner)).text.includes(ines.id), 'the owner still sees it')
    await cmd('screening-rule', { id: rule.id, ...relocation, active: false })
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

  await t.test('DATA-002 original resumes, grounded extraction, corrections and confirmed duplicates before individual or bulk commit', async () => {
    await checkResumeIntake(h, { manager, interviewer: ivy })
  })

  await t.test('an event shows each reader only the linked jobs and applications they may see', async () => {
    const shown = await openJob('Rigger', 'Brooklyn, NY'), secret = await openJob('Chief engineer', 'Brooklyn, NY')
    await cmd('vacancy-privacy', { id: secret.id, confidential: true })
    await cmd('hiring-team', { id: shown.id, interviewers: ['ivy@example.test'] })
    const expo = await cmd('event', { name: 'Trades expo', kind: 'career-fair', date: '2026-11-12', location: 'Brooklyn Expo Center', jobs: [shown.id, secret.id] })
    const { candidate } = await cmd('event-capture', { event: expo.id, captureId: 'cap-expo-0001', name: 'Theo Brandt', email: 'theo@example.test', noticeVersion: (await state()).business.notices.at(-1).version, noticeShown: true })
    for (const job of [shown, secret]) await cmd('event-apply', { event: expo.id, vacancy: job.id, candidate })
    for (const events of [(await state(ivy)).events, (await send('/api/lodge/reports/events', undefined, ivy)).value.events]) {
      const seen = JSON.stringify(events.find(e => e.id === expo.id))
      assert.ok(seen.includes(shown.id) && !seen.includes(secret.id) && !seen.includes('Chief engineer'), seen)
    }
    // Whoever edits the event keeps the links they cannot see.
    const admin = await h.member('ada@example.test', ['admin'], 'Ada Stone')
    await cmd('event', { id: expo.id, name: 'Trades expo', kind: 'career-fair', date: '2026-11-13', location: 'Brooklyn Expo Center', jobs: (await state(admin)).events.find(e => e.id === expo.id).jobs }, admin)
    assert.deepEqual((await state()).events.find(e => e.id === expo.id).jobs, [shown.id, secret.id])
  })

  await t.test('the hosted and embedded application forms take at most sixty attempts an hour from one connection', async t => {
    // Keep every attempt in the same hour, even across a real hour boundary.
    const h = await harness({ clock: '2026-10-26T15:30:00.000Z' })
    t.after(() => h.close())
    const { command: cmd, send, state } = h
    await cmd('business', BUSINESS)
    await cmd('job-board', { token: 'synthetic-lodge-rate-limit', allowedOrigins: ['https://careers.example.test'] })
    const draft = await cmd('vacancy', { title: 'Glazier', location: 'Brooklyn, NY', headcount: 1, compensation: RANGE, manager: 'owner@example.test' })
    await cmd('rubric', { id: draft.id, criteria: RUBRIC })
    await cmd('interview-plan', { id: draft.id, plan: [{ name: 'Floor walk', stage: draft.stages[2].id }] })
    const approval = await cmd('request-vacancy-approval', { id: draft.id, approver: 'owner@example.test' })
    await cmd('decide-approval', { id: approval.id, decision: 'approved', reason: 'Within budget', version: approval.version })
    const job = await cmd('publish', { id: draft.id })
    const notice = (await state()).business.notices.at(-1).version
    const post = (path, fields) => { const f = new FormData(); for (const [k, v] of Object.entries({ name: 'Flo Reed', email: 'flo@example.test', noticeVersion: String(notice), ...fields })) f.append(k, v); return send(path, f, '', { 'cf-connecting-ip': '198.51.100.41' }) }
    const refused = []
    for (let i = 0; i < 60; i++) refused.push((await post((i % 2 ? '/embed/jobs/' : '/jobs/') + job.slug, {})).status)
    assert.ok(refused.every(s => s === 400), 'each refused attempt counts')
    const limited = await post('/jobs/' + job.slug, { consent: 'yes' })
    assert.equal(limited.status, 429)
    assert.equal((await state()).candidates.some(c => c.email === 'flo@example.test'), false, 'nothing is kept')
    assert.equal((await send('/jobs/' + job.slug, (() => { const f = new FormData(); for (const [k, v] of Object.entries({ name: 'Flo Reed', email: 'flo@example.test', noticeVersion: String(notice), consent: 'yes' })) f.append(k, v); return f })(), '', { 'cf-connecting-ip': '198.51.100.42' })).status, 200, 'another connection still applies')
  })
})

test('DATA-001 typed hiring fields, scoped discovery, imports and reviewed configuration', async t => {
  const { checkFields } = await import('./fields-driver.mjs')
  await checkFields(t)
})

test('CRM-005 invited agencies own frozen submissions, reviewed credit and coarse progress through live scoped doors', async t => {
  const { checkAgency } = await import('./agency-driver.mjs')
  await checkAgency(t)
})

test('ATTR-007 Spanish posts and applications preserve reviewed source versions', async () => {
  const { checkLanguages } = await import('./languages-driver.mjs')
  await checkLanguages()
})


test('CRM-003 consented employee referrals reconcile identities and expose only shared progress', async t => {
  const { checkReferrals } = await import('./referrals-driver.mjs')
  await checkReferrals(t)
})


test('CRM-010 referral alerts and shared progress by installation email, claimed once and checked live', async () => {
  const { checkReferralEmail } = await import('./referrals-email-flow.mjs')
  await checkReferralEmail()
})

test('ATTR-001 employer careers branding, private receipt recovery and verified custom domains', async () => {
  const { checkCareers } = await import('./careers-driver.mjs')
  const { careersDomainBindings, createCareersDomainEdge, checkCareersDomain, checkCareersDomainUnavailable } = await import('./careers-domain-flow.mjs')
  const ordinary = await harness()
  try { await checkCareers(ordinary); await checkCareersDomainUnavailable(ordinary) } finally { await ordinary.close() }
  const edge = createCareersDomainEdge()
  const configured = await harness({ bindings: careersDomainBindings, outboundService: edge.fetch })
  try { await checkCareersDomain(configured, edge) } finally { await configured.close() }
})

test('CAND-001 native candidate sessions recover only their receipts and submit scoped PRIV-001 requests', async () => {
  const { checkCandidate } = await import('./candidate-driver.mjs')
  await checkCandidate()
})

test('CAND-002 candidate account publishes only explicit updates, verifies email and stops contact on withdrawal', async () => {
  const { checkCandidateAccount } = await import('./candidate-driver.mjs')
  await checkCandidateAccount()
})

test('CAND-003 native candidates book and reschedule only their own panel-approved interview without conflicts', async () => {
  const { checkCandidateBooking } = await import('./candidate-driver.mjs')
  await checkCandidateBooking()
})

// Native capture remains separate from connected mailbox sending.
test('COM-004 private inbound capture preserves bytes and rechecks contact custody', async t => {
  const { checkCapture } = await import('./capture-flow.mjs')
  await checkCapture(t)
})

test('Application acknowledgments keep receipts and suppress submission replay', async t => (await import('./application-email-flow.mjs')).checkApplicationEmailReceipt(t))
test('Application mail requires human review in the recorded language', async t => (await import('./application-email-flow.mjs')).checkApplicationEmailLanguage(t))
test('Approved chosen-stage emails record outcomes without resending failures', async t => (await import('./application-email-flow.mjs')).checkApplicationEmailStages(t))

test('Application sender authentication and current approval fence automatic mail', async t => (await import('./application-email-safety.mjs')).checkApplicationEmailSender(t))
test('Restored application mail remains inert with receipts and duplicate protection retained', async t => (await import('./application-email-safety.mjs')).checkApplicationEmailRestore(t))
test('Per-job application email reviews remain isolated when another job changes', async t => (await import('./application-email-safety.mjs')).checkApplicationEmailIsolation(t))

test('ATTR-004 approved location pay, reviewed rules and salary-history refusals reach public doors', async t => (await import('./pay-transparency-flow.mjs')).checkPayTransparency(t))

test('CAL-002 native interview-day drafts explain constraints and fence human substitute review', async t => (await import('./interview-day-flow.mjs')).checkInterviewDay(t))

test('Native take-home custody, candidate identity, deadlines and independent grading survive replay and erasure', async () => {
  await (await import('./take-home-flow.mjs')).checkTakeHome()
})
