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
  let manager, approver, ivy, ian, vacancy, publicApp, staffApp, staffCandidate, slug

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
  })

  await t.test('LDG-009 scorecards are independent until the manager releases feedback', async () => {
    const v = (await state(manager)).vacancies.find(x => x.id === vacancy.id), [safety, scheduling] = v.rubrics[0].criteria
    const unsupported = await send('/api/lodge/command/scorecard', { application: publicApp.id, ratings: { [safety.id]: 4 }, evidence: {}, recommendation: 'yes', submit: true }, ivy)
    assert.equal(unsupported.status, 400)
    await cmd('scorecard', { application: publicApp.id, ratings: { [safety.id]: 4, [scheduling.id]: null }, evidence: { [safety.id]: 'Walked through her daily toolbox talks' }, recommendation: 'strong-yes', submit: true, author: 'parker@example.test' }, ivy)
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
    let offer = await cmd('offer', { application: publicApp.id, title: 'Site supervisor', startDate: '2026-12-01', salary: { currency: 'USD', amount: 11500000, period: 'year' }, terms: 'Truck allowance' }, manager)
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
    await cmd('move', { application: closed.id, to: 'rejected', reason: 'Not progressing' }, manager)
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
    for (const app of (await state()).applications.filter(a => a.candidate === staffCandidate.id && a.status === 'active')) await cmd('move', { application: app.id, to: 'withdrawn', reason: 'Asked to withdraw' })
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
