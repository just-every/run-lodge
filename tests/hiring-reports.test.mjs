import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { BUSINESS, harness } from './harness.mjs'
import { RANGE, RUBRIC, hiringScenario } from './hiring-fixture.mjs'
const b64 = text => Buffer.from(text).toString('base64')

test('Lodge reports through native sessions and real D1', async t => {
  const { h, cmd, send, state, owner, manager, approver, ivy, ian, approve, openJob } = await hiringScenario(t)
  const vacancy = await openJob('Site supervisor', 'Brooklyn, NY'), slug = vacancy.slug
  // Create the automatic intake source through its real public door.
  const application = new FormData()
  for (const [key, value] of Object.entries({ name: 'Synthetic source applicant', email: 'synthetic-lodge-1@example.test', noticeVersion: '1', consent: 'yes' })) application.set(key, value)
  assert.equal((await send('/jobs/' + slug, application)).status, 200)

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
    const auditCount = (await h.db.prepare("SELECT COUNT(*) AS n FROM l_records WHERE kind='audit'").first()).n
    for (let i = auditCount; i <= 300; i++) await cmd('correct-candidate', { id: candidate.id, name: 'Zed Quill', email: 'zed.quill@example.test', reason: 'Populate complete audit history ' + i })
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
})

test('TEAM-002 @mentions raise access-checked notifications and never widen access', async () => {
  const { checkMentions } = await import('./notify-flow.mjs')
  await checkMentions()
})

test('TEAM-003 personal notification subscriptions, role defaults, the daily digest and live access at send time', async () => {
  const { checkNotifications } = await import('./notify-flow.mjs')
  await checkNotifications()
})

