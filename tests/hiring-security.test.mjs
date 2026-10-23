import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { BUSINESS, harness } from './harness.mjs'
import { RANGE, RUBRIC, hiringScenario } from './hiring-fixture.mjs'
const b64 = text => Buffer.from(text).toString('base64')

test('Lodge security through native sessions and real D1', async t => {
  const { h, cmd, send, state, owner, manager, approver, ivy, ian, approve, openJob } = await hiringScenario(t)
  const vacancy = await openJob('Site supervisor', 'Brooklyn, NY'), slug = vacancy.slug
  await h.member('una@example.test', ['interviewer'], 'Una Diaz')
  await h.member('ivy-agent@example.test', [], 'Ivy’s coding agent', { agent: true, actsFor: 'ivy@example.test' })

  await t.test('PRIV-001 a California job shows and records the CPRA notice version; applicants verify by receipt and email, see acknowledgement, deadline and extension on their request page; access and correction are fulfilled and a held deletion is refused with its reason', async () => {
    // Lodge drafts the notice from what it collects; a California job publishes only after the owner adopts it, confirming the sale and sharing statement.
    const draft = (await state()).cpraNotice
    assert.deepEqual([draft.draft, draft.categories.map(c => c.category).includes('Sensitive personal information'), draft.saleStatement.startsWith('We do not sell or share')], [true, true, true])
    const v = await cmd('vacancy', { title: 'Coastal Surveyor', location: 'San Diego, CA', headcount: 1, manager: 'morgan@example.test', compensation: RANGE, description: 'Survey the coast.' }, manager)
    await cmd('rubric', { id: v.id, criteria: RUBRIC }, manager)
    await cmd('interview-plan', { id: v.id, plan: [{ name: 'Site talk', stageName: 'Interview', durationMinutes: 30 }] }, manager)
    await approve((await cmd('request-vacancy-approval', { id: v.id, approver: 'parker@example.test' }, manager)).id)
    const early = await send('/api/lodge/command/publish', { id: v.id }, manager)
    assert.deepEqual([early.status, /Adopt your California privacy notice first/.test(early.value.error)], [409, true])
    const categories = [{ category: 'Identifiers', collected: 'Name, email and phone.', purposes: 'Evaluating your application.', retention: 'Kept one year.' }, { category: 'Sensitive personal information', collected: 'Adjustments and the voluntary gender answer.', purposes: 'Adjustments and monitoring only.', retention: 'Kept one year.' }]
    assert.equal((await send('/api/lodge/command/cpra-notice', { categories: draft.categories, confirmStatement: true }, manager)).status, 403, 'only the owner adopts it')
    assert.equal((await send('/api/lodge/command/cpra-notice', { categories: draft.categories }, owner)).status, 400, 'adopting confirms the statement')
    assert.equal((await cmd('cpra-notice', { categories: draft.categories, confirmStatement: true })).version, 1)
    assert.equal((await cmd('cpra-notice', { categories, confirmStatement: true })).version, 2, 'an edit is a new version')
    const ca = await cmd('publish', { id: v.id }, manager)
    const page = (await send('/jobs/' + ca.slug)).text
    assert.match(page, /California applicant privacy notice \(version 2\)/)
    assert.match(page, /We do not sell or share your personal information/)
    assert.match(page, /name="cpraNoticeVersion" value="2"/)
    assert.doesNotMatch((await send('/jobs/' + slug)).text, /California applicant privacy notice/, 'a New York job shows only the general notice')
    const general = page.match(/name="noticeVersion" value="(\d+)"/)[1]
    const form = fields => { const f = new FormData(); for (const [k, x] of Object.entries(fields)) f.append(k, x); return f }
    const applicant = { name: 'Cora Vance', email: 'cora@example.test', phone: '+1 555 0142', noticeVersion: general, consent: 'yes' }
    assert.deepEqual([(await send('/jobs/' + ca.slug, form(applicant))).status, (await send('/jobs/' + ca.slug, form({ ...applicant, cpraNoticeVersion: '1' }))).status], [409, 409], 'the current California notice must have been shown')
    const applied = await send('/jobs/' + ca.slug, form({ ...applicant, cpraNoticeVersion: '2' }))
    assert.match(applied.text, /California privacy notice<\/dt><dd>Version 2/)
    const receipt = applied.text.match(/<dt>Receipt<\/dt><dd>(LDG-[A-Z0-9]+)/)[1]
    let w = await state()
    const cora = w.candidates.find(c => c.email === 'cora@example.test')
    assert.deepEqual([cora.consent.cpraNoticeVersion, w.applications.find(a => a.candidate === cora.id).cpraNoticeVersion], [2, 2])
    // The other intake doors that exist today conform: an internal application and an event capture in California record the version too.
    assert.equal((await state(ivy)).internalBoard.find(j => j.id === ca.id).californiaNotice.version, 2)
    assert.equal((await send('/api/lodge/command/apply-internal', { vacancy: ca.id }, ivy)).status, 409)
    await cmd('apply-internal', { vacancy: ca.id, cpraNoticeVersion: 2 }, ivy)
    const fairCa = await cmd('event', { name: 'San Diego trades fair', kind: 'career-fair', date: '2026-11-20', location: 'San Diego, CA', owner: 'morgan@example.test', jobs: [ca.id], budget: 100000 }, manager)
    const capture = body => send('/api/lodge/command/event-capture', { event: fairCa.id, noticeVersion: general, noticeShown: true, ...body }, manager)
    assert.equal((await capture({ captureId: 'cap-ca-00001', name: 'Rio Banks', email: 'rio@example.test' })).status, 409)
    assert.equal((await capture({ captureId: 'cap-ca-00002', name: 'Rio Banks', email: 'rio@example.test', cpraNoticeVersion: 2 })).status, 200)
    w = await state()
    assert.deepEqual([w.candidates.find(c => c.internal && c.email === 'ivy@example.test'), w.candidates.find(c => c.event === fairCa.id)].map(c => c.consent.cpraNoticeVersion), [2, 2])

    // Requests through /privacy-requests: verified by receipt code + email on record, acknowledged on their own page with the deadline.
    assert.match((await send('/privacy-requests')).text, /<label>Application receipt code/)
    const ask = async fields => { const r = await send('/privacy-requests', form(fields)); return { ...r, token: r.text.match(/\/privacy-requests\/([a-f0-9]{48})/)?.[1] } }
    const access = await ask({ type: 'access', name: 'Cora Vance', email: 'CORA@example.test', receipt })
    assert.equal(access.status, 200)
    for (const text of [/Verified by receipt code and email on record/, /<dt>Acknowledged<\/dt>/, /How it will be processed/, /Being processed/]) assert.match(access.text, text)
    const unverified = await ask({ type: 'access', name: 'Cora Vance', email: 'someone@example.test', receipt })
    assert.match(unverified.text, /Not verified/)
    assert.equal((await send('/privacy-requests', form({ type: 'access', name: 'Bot', email: 'bot@example.test', website: 'x' }))).status, 400, 'the honeypot refuses')
    w = await state()
    const requests = w.dataRequests.filter(r => r.californiaRequest)
    const accessRequest = requests.find(r => r.status === 'open' && r.type === 'access')
    const due = new Date(Date.parse(accessRequest.receivedAt + 'T00:00:00Z') + 45 * 86400000).toISOString().slice(0, 10)
    assert.deepEqual([accessRequest.candidate, accessRequest.dueOn, requests.find(r => r.status === 'unverified').candidate], [cora.id, due, null], 'an unverified request releases nothing and links to no one')
    assert.match((await send('/privacy-requests/' + access.token)).text, new RegExp('Answer due by</dt><dd>' + due))
    // An extension, once, with the reason the requester sees.
    await cmd('extend-data-request', { id: accessRequest.id, days: 45, reason: 'Records are held in two systems' })
    assert.equal((await send('/api/lodge/command/extend-data-request', { id: accessRequest.id, days: 10, reason: 'again' }, owner)).status, 409)
    const extended = (await send('/privacy-requests/' + access.token)).text
    assert.match(extended, /Extended by 45 days<\/dt><dd>Records are held in two systems/)
    assert.match(extended, new RegExp('Answer due by</dt><dd>' + new Date(Date.parse(due + 'T00:00:00Z') + 45 * 86400000).toISOString().slice(0, 10)))
    // Fulfilled through the LDG-012 export.
    assert.equal((await send(`/api/lodge/download/candidate/${cora.id}?request=${accessRequest.id}`, undefined, owner)).status, 200)
    assert.match((await send('/privacy-requests/' + access.token)).text, /Completed[\s\S]*Export provided \(sha256 [0-9a-f]{64}\)/)

    // Correction: verified, corrected, completed with what changed.
    const correction = await ask({ type: 'correction', name: 'Cora Vance', email: 'cora@example.test', receipt, details: 'My phone is +1 555 0199' })
    const correctionRequest = (await state()).dataRequests.find(r => r.type === 'correction' && r.californiaRequest)
    assert.match(correction.text, new RegExp('Verified by receipt code and email on record[\\s\\S]*Answer due by</dt><dd>' + correctionRequest.dueOn))
    await cmd('correct-candidate', { id: cora.id, name: 'Cora Vance', email: 'cora@example.test', phone: '+1 555 0199', reason: 'Privacy request ' + correctionRequest.code })
    await cmd('complete-data-request', { id: correctionRequest.id, outcome: 'Phone corrected to +1 555 0199' })
    assert.match((await send('/privacy-requests/' + correction.token)).text, /Completed[\s\S]*Phone corrected/)

    // Deletion of a held record: erasure is refused, and so is the request, with the documented reason.
    const deletion = await ask({ type: 'deletion', name: 'Cora Vance', email: 'cora@example.test', receipt })
    const deletionRequest = (await state()).dataRequests.find(r => r.type === 'deletion' && r.californiaRequest)
    assert.equal((await send('/api/lodge/command/refuse-data-request', { id: deletionRequest.id, basis: 'legal-hold', explanation: 'x' }, owner)).status, 409, 'no hold, no hold refusal')
    await cmd('hold', { candidate: cora.id, reason: 'Pending wage claim' })
    assert.equal((await send('/api/lodge/delete-candidate', { candidate: cora.id, confirm: 'Cora Vance', reason: 'Privacy request' }, owner)).status, 409)
    await cmd('refuse-data-request', { id: deletionRequest.id, basis: 'legal-hold', explanation: 'A wage claim is pending; we keep your application until it is resolved.' })
    const refusedPage = (await send('/privacy-requests/' + deletion.token)).text
    assert.match(refusedPage, /Refused[\s\S]*A legal hold requires us to keep these records \(LDG-012\)\. A wage claim is pending/)
    let limited = 0
    for (let i = 0; i < 12 && !limited; i++) if ((await send('/privacy-requests', form({ type: 'access', name: 'Bot', email: 'bot@example.test', website: 'x' }))).status === 429) limited = i
    assert.ok(limited > 0, 'at most 10 attempts per connection per hour')
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

  await t.test('panel answers on an interview never carry the candidate’s private availability link', async () => {
    const job = await openJob('Crane operator', 'Queens, NY')
    const { application: app } = await cmd('candidate', { name: 'Lena Ortiz', email: 'lena@example.test', source: 'Referral', consentBasis: 'referral', vacancy: job.id }, manager)
    const iv = await cmd('interview', { application: app.id, planItem: job.plan[0].id, participants: ['ivy@example.test'], slots: ['2026-12-02T15:00:00.000Z', '2026-12-03T15:00:00.000Z'] }, manager)
    assert.match(iv.candidateToken, /^[a-f0-9]{48}$/, 'the people who run the job hold the link')
    const answers = [await send('/api/lodge/command/availability', { interview: iv.id, slots: [0] }, ivy), await send('/api/lodge/command/interview-reply', { interview: iv.id, answer: 'cannot-attend', note: 'On leave' }, ivy)]
    assert.deepEqual(answers.map(r => [r.status, r.text.includes(iv.candidateToken)]), [[200, false], [200, false]])
    // A panellist who no longer sees the application changes nothing on its interview.
    await cmd('candidate-privacy', { id: app.candidate, private: true })
    const unchanged = await h.db.prepare("SELECT revision FROM l_records WHERE kind='interview' AND id=?").bind(iv.id).first()
    assert.equal((await send('/api/lodge/command/availability', { interview: iv.id, slots: [1] }, ivy)).status, 404)
    assert.deepEqual(await h.db.prepare("SELECT revision FROM l_records WHERE kind='interview' AND id=?").bind(iv.id).first(), unchanged)
  })

})

test('REVIEW-002 name-blind review across reads, reveals and return', async t => {
  const { checkBlindReview } = await import('./blind-driver.mjs')
  await checkBlindReview(t)
})

// Typed hiring records are exercised through the real HTTP and hosted intake doors.
