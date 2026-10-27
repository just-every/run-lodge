import { checkReferences } from './reference-flow.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { BUSINESS, harness } from './harness.mjs'
import { RANGE, RUBRIC, hiringScenario } from './hiring-fixture.mjs'
const b64 = text => Buffer.from(text).toString('base64')

test('Lodge offers through native sessions and real D1', async t => {
  const { h, cmd, send, state, owner, manager, approver, ivy, ian, approve, openJob } = await hiringScenario(t)
  const vacancy = await openJob('Site supervisor', 'Brooklyn, NY'), slug = vacancy.slug
  await h.member('una@example.test', ['interviewer'], 'Una Diaz')
  await h.member('ivy-agent@example.test', [], 'Ivy’s coding agent', { agent: true, actsFor: 'ivy@example.test' })
  await t.test('HIRE-008 native task-linked phone references preserve versions, authority, stage and lifecycle', () => checkReferences({ h, cmd, send, state, owner, manager, ivy, ian, openJob }))
  let declineTemplate
  // Fair-chance journeys need an employer-adopted California notice. PRIV-001
  // independently proves the adoption and stale-version refusals.
  await cmd('cpra-notice', { categories: (await state()).cpraNotice.categories, confirmStatement: true })

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
})

test('OFFER-001 reviewed hourly and annual documents bind compensation routing, release and job setup', async () => {
  const { checkOfferDocuments } = await import('./offer-driver.mjs')
  await checkOfferDocuments()
})

test('OFFER-005 native e-signature: send, verify, consent, sign, countersign, seal, void, erase', async () => {
  const { checkEsign } = await import('./esign-driver.mjs')
  await checkEsign()
})

// Application-specific privacy is an independent public-door journey.
