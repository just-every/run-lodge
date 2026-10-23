// Shared HTTP and browser driver; each public-door journey retains its own assertions.
import assert from "node:assert/strict"
import { businessHarness } from "./harness.mjs"
import { browserWidths } from "./browser-widths.mjs"
import { join } from "node:path"
import { readDevKey, signInAs } from "../src/modules/operator-auth/dev/sign-in-as.mjs"
import { current, session } from "./browser-journey.mjs"

// CRM-005: two real invited native members on disjoint requisitions, with
// explicit employer ownership decisions and no canonical access from the portal.


const resume = { name: 'agency-original.txt', mediaType: 'text/plain', base64: Buffer.from('Agency original resume\nWorked on site safety').toString('base64') }
export async function checkAgency(t) {
  const h = await businessHarness(); t.after(() => h.close())
  const { command: cmd, send, state } = h

  async function job(title) {
    const v = await cmd('vacancy', { title, location: 'Brooklyn, NY', headcount: 3, manager: 'owner@example.test', description: 'Run crews on occupied sites.', compensation: { currency: 'USD', min: 8000000, max: 10000000, period: 'year' } })
    await cmd('rubric', { id: v.id, criteria: [{ name: 'Safety', description: 'Evidence of running a safe crew' }] })
    await cmd('interview-plan', { id: v.id, plan: [{ name: 'Site walk', stageName: 'Interview', durationMinutes: 45 }] })
    const req = await cmd('request-vacancy-approval', { id: v.id, approver: 'owner@example.test' })
    const a = (await state()).approvals.find(x => x.id === req.id)
    await cmd('decide-approval', { id: req.id, decision: 'approved', version: a.currentVersion, reason: 'Hiring plan approved' })
    return cmd('publish', { id: v.id })
  }
  const first = await job('North crew supervisor'), second = await job('South crew supervisor')
  const one = await cmd('agency', { email: 'north-agency@example.test', name: 'North Recruiting' })
  const two = await cmd('agency', { email: 'south-agency@example.test', name: 'South Recruiting' })
  async function inviteAgency(agency) {
    assert.equal((await send('/api/lodge/invite', { email: agency.email }, h.owner)).status, 200)
    const rows = await h.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence DESC').all()
    const mail = rows.results.map(r => JSON.parse(r.message)).find(m => m.to.includes(agency.email))
    const token = new URL(mail.text.match(/http:\/\/\S+\/auth\/confirm\?token=\S+/)[0]).searchParams.get('token')
    const confirmed = await send('/auth/confirm', { token })
    assert.equal(confirmed.status, 303)
    return confirmed.cookie
  }
  const cookie1 = await inviteAgency(one), cookie2 = await inviteAgency(two)
  const interviewer = await h.member('agency-panel@example.test', ['interviewer'])
  await cmd('agency-job', { agency: one.id, vacancy: first.id, feeTerms: 'USD 12,000 on start, net 30' })
  await cmd('agency-job', { agency: two.id, vacancy: second.id, feeTerms: 'USD 10,000 on start, net 30' })
  const input = { name: 'Adrian Crews', email: 'adrian-crews@example.test', phone: '+1 555 0137', summary: 'Runs safety on occupied sites', consentNote: 'Candidate agreed by phone to this role and resume submission', confirmed: true, resume }
  const rejected = await send('/api/lodge/command/agency-submit', { ...input, vacancy: second.id }, cookie1)
  assert.equal(rejected.status, 404)
  await cmd('agency-submit', { ...input, vacancy: first.id, confirmed: false }, cookie1, 400)
  await cmd('agency-submit', { ...input, vacancy: first.id, resume: { ...resume, base64: Buffer.alloc(1_000_001).toString('base64') } }, cookie1, 413)
  const s1 = await cmd('agency-submit', { ...input, vacancy: first.id }, cookie1)
  const s2 = await cmd('agency-submit', { ...input, vacancy: second.id }, cookie2)
  assert.deepEqual(Object.keys(s1).sort(), ['id', 'outcome', 'progress'])
  let p1 = (await state(cookie1)).agencyPortal
  assert.deepEqual(p1.jobs.map(x => x.id), [first.id])
  assert.equal(p1.submissions.length, 1)
  assert.equal(p1.submissions[0].email, input.email)
  assert.equal(JSON.stringify(p1).includes('South Recruiting'), false)
  assert.equal((await state()).candidates.some(c => c.email === input.email), false, 'submissions wait for a person; no automatic application or database-match receipt')
  // A known employer record and a nonexistent id have identical refusal bodies and no writes.
  const privatePerson = await cmd('candidate', { name: 'Employer private person', email: 'private-agency-test@example.test', source: 'Employer', consentBasis: 'manual' })
  await cmd('candidate-privacy', { id: privatePerson.candidate.id, private: true })
  await cmd('document', { candidate: privatePerson.candidate.id, name: 'restricted.txt', kind: 'right-to-work', base64: Buffer.from('Employer restricted bytes').toString('base64') })
  const before = (await h.db.prepare('SELECT COUNT(*) AS n FROM l_records').first()).n
  const refusals = [
    ['/api/lodge/search?q=Adrian', undefined], ['/api/lodge/talent?q=Adrian', undefined],
    ['/api/lodge/download/candidate/' + privatePerson.candidate.id, undefined], ['/api/lodge/download/candidate/unknown-id', undefined],
    ['/api/lodge/download/vacancy/' + first.id, undefined], ['/api/lodge/reports/sources', undefined], ['/api/lodge/audit', undefined],
    ['/api/lodge/command/agency-review', { id: s1.id, outcome: 'Accepted-credited', reason: 'self approval' }],
    ['/api/lodge/command/apply', { candidate: privatePerson.candidate.id, vacancy: first.id }],
    ['/api/lodge/command/member', { email: one.email, roles: ['admin'] }],
  ]
  for (const [path, body] of refusals) {
    const r = await send(path, body, cookie1)
    assert.equal(r.status, 404, path)
    assert.deepEqual(r.value, rejected.value, path)
  }
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM l_records').first()).n, before)
  const accepted = await cmd('agency-review', { id: s1.id, outcome: 'Accepted-credited', reason: 'Reviewed consent and original; credited this submission' })
  const samePerson = await cmd('agency-review', { id: s2.id, outcome: 'Accepted-credited', candidate: accepted.candidate, reason: 'Same consented person, distinct job; credit this agency on this job' })
  assert.equal(samePerson.candidate, accepted.candidate)
  assert.notEqual(samePerson.application, accepted.application)
  await cmd('agency-review', { id: s1.id, outcome: 'Not accepted', reason: 'cannot replace reviewed ownership' }, h.owner, 409)
  const third = await cmd('agency-submit', { ...input, vacancy: first.id }, cookie1)
  await cmd('agency-review', { id: third.id, outcome: 'Not accepted: duplicate', reason: 'Existing application already credited' })
  assert.equal((await state(cookie1)).agencyPortal.submissions.find(s => s.id === third.id).outcome, 'Not accepted: duplicate')
  await cmd('agency-progress', { id: s1.id, progress: 'Interviewing', feedback: 'Please confirm arrival at reception.', interviews: [{ start: '2026-11-02T15:00:00Z', end: '2026-11-02T15:45:00Z', format: 'in-person', privateNotes: 'never retain this' }] })
  await cmd('correct-candidate', { id: accepted.candidate, name: 'Adrian Employer Correction', email: 'updated-adrian@example.test', reason: 'Candidate corrected employer contact record' })
  const portal1 = (await state(cookie1)).agencyPortal
  const own = portal1.submissions.find(s => s.id === s1.id), file = own.files[0]
  assert.equal(own.name, input.name, 'agency sees only its own frozen submission after employer corrections')
  assert.equal(own.email, input.email)
  assert.equal(own.progress, 'Interviewing')
  assert.equal(own.feedback, 'Please confirm arrival at reception.')
  assert.deepEqual(Object.keys(own.interviews[0]).sort(), ['end', 'format', 'start'])
  assert.equal(own.candidate, undefined); assert.equal(own.application, undefined)
  assert.equal((await send('/api/lodge/agency/file/' + file.id, undefined, cookie1)).text, Buffer.from(resume.base64, 'base64').toString())
  assert.equal((await send('/api/lodge/agency/file/' + file.id, undefined, cookie2)).status, 404)
  assert.equal((await send('/api/lodge/agency/file/' + file.id, undefined, interviewer)).status, 404)
  await cmd('document', { application: accepted.application, kind: 'right-to-work', name: 'identity.txt', base64: Buffer.from('Restricted identity proof').toString('base64') })
  await cmd('team-note', { candidate: accepted.candidate, text: 'Employer deliberation must not be agency feedback' })
  const accessExport = await send('/api/lodge/download/candidate/' + accepted.candidate, undefined, h.owner)
  assert.equal(accessExport.status, 200)
  assert.deepEqual(new Set(accessExport.value.agencySubmissions.map(x => x.id)), new Set([s1.id, s2.id, third.id]))
  assert.equal(accessExport.value.agencySubmissions[0].files[0].base64, resume.base64)
  const exported = await send('/api/lodge/agency/export', undefined, cookie1)
  assert.equal(exported.status, 200)
  assert.equal(exported.text.includes('Restricted identity proof'), false)
  assert.equal(exported.text.includes('Employer deliberation'), false)
  assert.equal(exported.text.includes(accepted.application), false)
  // The new employer review door inherits OPS-005, including canonical privacy changes after intake.
  const admin = await h.member('agency-admin@example.test', ['admin'])
  await cmd('candidate-privacy', { id: accepted.candidate, private: true })
  assert.equal((await state(admin)).agencies.flatMap(a => a.submissions).some(s => s.id === s1.id), false)
  const hiddenFile = await send('/api/lodge/agency/file/' + file.id, undefined, admin)
  const unknownFile = await send('/api/lodge/agency/file/unknown-id', undefined, admin)
  assert.deepEqual([hiddenFile.status, hiddenFile.value], [unknownFile.status, unknownFile.value])
  assert.equal(hiddenFile.status, 404)
  assert.equal((await state(cookie1)).agencyPortal.submissions.find(s => s.id === s1.id).name, input.name, 'canonical privacy changes never expand or replace the agency snapshot')
  await cmd('candidate-privacy', { id: accepted.candidate, private: false })
  // Credit stays on the real application, including the existing source-of-hire report.
  await cmd('agency-fee', { id: s1.id, label: 'Placement', amountCents: 1200000, status: 'due' }, h.owner, 409)
  const offer = await cmd('offer', { application: accepted.application, title: first.title, salary: { currency: 'USD', amount: 9000000, period: 'year' }, startDate: '2026-11-16', opening: first.openings[0].id })
  const request = await cmd('request-offer-approval', { id: offer.id, approver: 'owner@example.test' })
  const approval = (await state()).approvals.find(x => x.id === request.id)
  await cmd('decide-approval', { id: request.id, decision: 'approved', version: approval.currentVersion, reason: 'Approved terms' })
  await cmd('offer-outcome', { id: offer.id, outcome: 'accepted', reason: 'Accepted outside Lodge' })
  await cmd('agency-fee', { id: s1.id, label: 'Placement on start', amountCents: 1200000, status: 'due' })
  const report = await send('/api/lodge/reports/sources', undefined, h.owner)
  assert.ok(report.value.byCredit.some(x => x.kind === 'agency' && x.who === one.name && x.hires === 1))
  const fees = (await state(cookie1)).agencyPortal.submissions.find(s => s.id === s1.id).fees
  await cmd('agency-fee', { id: s1.id, fee: fees[0].id, label: 'Placement on start', amountCents: 1200000, status: 'paid' })
  assert.equal((await state(cookie1)).agencyPortal.submissions.find(s => s.id === s1.id).fees[0].status, 'paid')
  await cmd('agency-job', { agency: one.id, vacancy: first.id, active: false })
  p1 = (await state(cookie1)).agencyPortal
  assert.deepEqual(p1.jobs, [])
  assert.equal(p1.submissions.length, 1)
  assert.equal(p1.submissions[0].name, undefined)
  assert.equal(p1.submissions[0].fees[0].amountCents, 1200000)
  assert.equal((await send('/api/lodge/agency/file/' + file.id, undefined, cookie1)).status, 404)
  await cmd('agency', { ...one, active: false })
  for (const path of ['/api/lodge/state', '/api/lodge/agency/export', '/api/lodge/agency/file/' + file.id, '/api/lodge/search?q=Adrian']) assert.equal((await send(path, undefined, cookie1)).status, 403, path)
  assert.equal((await state(cookie2)).agencyPortal.submissions[0].email, input.email, 'other invited agency retains its own snapshot, never canonical history')
  assert.equal((await state()).applications.find(a => a.id === accepted.application).credit.who, one.name)
  // Erasure follows duplicate frozen copies and their original bytes in one transaction.
  const reasons = (await state()).rejectionReasons
  const withdrawal = reasons.find(r => r.group === 'withdrew')
  await cmd('move', { application: samePerson.application, to: 'withdrawn', closeReason: withdrawal.id, note: 'Candidate withdrew from second role' })
  const pendingJob = await job('Pending-only agency role')
  await cmd('agency-job', { agency: two.id, vacancy: pendingJob.id, feeTerms: 'USD 9,000 on start' })
  const pendingOnly = await cmd('agency-submit', { ...input, vacancy: pendingJob.id }, cookie2)
  await cmd('vacancy-privacy', { id: pendingJob.id, confidential: true, namedPeople: [] })
  const scopedExport = await send('/api/lodge/download/candidate/' + accepted.candidate, undefined, admin)
  assert.equal(scopedExport.status, 200)
  assert.equal(scopedExport.value.agencySubmissions.some(s => s.id === pendingOnly.id), false, 'candidate access exports keep confidential agency jobs out of an uncleared admin’s view')
  const hold = await cmd('hold', { vacancy: pendingJob.id, reason: 'Preserve the pending agency submission' })
  const held = await send('/api/lodge/delete-candidate', { candidate: accepted.candidate, confirm: 'Adrian Employer Correction', reason: 'Candidate requested erasure' }, h.owner)
  assert.equal(held.status, 409, 'a hold on a pending-only agency job protects its frozen copy too')
  await cmd('release-hold', { id: hold.id, reason: 'Preservation released' })
  const erased = await send('/api/lodge/delete-candidate', { candidate: accepted.candidate, confirm: 'Adrian Employer Correction', reason: 'Candidate requested erasure' }, h.owner)
  assert.equal(erased.status, 200, erased.text)
  assert.deepEqual((await state(cookie2)).agencyPortal.submissions, [])
}

// CRM-005: real employer invitations, agency submissions and ownership review
// in the installed app. Every state is exercised at desktop and phone widths.





async function fits(page, evidence, name, width) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth }))
  assert.ok(scroll <= inner + 1, `CRM-005 ${name} fits ${width} (${scroll}>${inner})`)
  await page.screenshot({ path: join(evidence, `agency-${name}-${width}.png`), fullPage: true })
}
export async function agencyPage(browser, { root, origin, run, evidence, ownerEmail }) {
  const job = await run('vacancy', { title: 'Agency site superintendent', location: 'Brooklyn, NY', manager: ownerEmail, headcount: 3, description: 'Coordinate occupied residential work, subcontractors and safe access for residents.', compensation: { currency: 'USD', min: 9000000, max: 11500000, period: 'year' } })
  await run('rubric', { id: job.id, criteria: [{ name: 'Occupied site safety', description: 'Explains safe access with a practical site example' }] })
  await run('interview-plan', { id: job.id, plan: [{ name: 'Site walk', stageName: 'Interview', durationMinutes: 45 }] })
  const request = await run('request-vacancy-approval', { id: job.id, approver: ownerEmail })
  await run('decide-approval', { id: request.id, decision: 'approved', version: request.version, reason: 'Budget and interview plan reviewed' })
  await run('publish', { id: job.id })
  for (const width of browserWidths) {
    const employer = await session(browser, root, origin, 'owner', width)
    let agencyContext
    try {
      const page = employer.page
      const openJob = async () => {
        await page.goto(origin + '/app')
        await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Vacancies', exact: true }).click()
        await page.getByRole('button', { name: 'Open ' + job.title, exact: true }).click()
      }
      await openJob()
      const section = page.getByRole('region', { name: 'Agency collaboration', exact: true })
      await section.getByText('Add an agency', { exact: true }).click()
      const add = section.locator('details').filter({ has: page.getByText('Add an agency', { exact: true }) })
      const name = 'Hudson Search ' + width, email = 'hudson-' + width + '@example.test'
      await add.getByLabel('Agency name', { exact: true }).fill(name)
      await add.getByLabel('Agency email', { exact: true }).fill(email)
      await add.getByRole('button', { name: 'Create agency membership', exact: true }).click()
      const agency = section.getByRole('region', { name, exact: true })
      await agency.getByLabel('Agency invited to ' + job.title).check()
      await agency.getByLabel('Agreed fee terms for this job').fill('USD 15,000 on the candidate’s first day; net 30 days.')
      await agency.getByRole('button', { name: 'Save job invitation and fee terms', exact: true }).click()
      const [invited] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/lodge/invite') && r.request().method() === 'POST'), agency.getByRole('button', { name: 'Invite agency to sign in', exact: true }).click()])
      assert.equal(invited.status(), 200)
      await fits(page, evidence, 'employer-invitation', width)
      const login = await signInAs({ origin, key: await readDevKey(root), as: email, returnTo: '/app' })
      agencyContext = await browser.newContext({ viewport: { width, height: 1000 } })
      await agencyContext.addCookies(login.cookies.map(c => ({ ...c, url: origin })))
      const portal = await agencyContext.newPage()
      await portal.goto(origin + '/app')
      await portal.getByRole('heading', { name: 'Agency portal', exact: true }).waitFor()
      assert.equal(await portal.getByRole('searchbox').count(), 0)
      await portal.getByText('Submit a candidate for ' + job.title, { exact: true }).click()
      const form = portal.locator('details').filter({ has: portal.getByText('Submit a candidate for ' + job.title, { exact: true }) })
      await form.getByLabel('Candidate name', { exact: true }).fill('Robin Wallace ' + width)
      await form.getByLabel('Candidate email', { exact: true }).fill('robin-' + width + '@example.test')
      await form.getByLabel('Candidate phone').fill('+1 212 555 0178')
      await form.getByLabel('Candidate summary').fill('Supervised three occupied residential renovations with zero lost-time incidents. Available after two weeks’ notice.')
      await form.getByLabel('Consent note').fill('Robin agreed to this named role and resume sharing during our call this morning.')
      await form.getByLabel('Resume', { exact: true }).setInputFiles({ name: 'robin-resume.txt', mimeType: 'text/plain', buffer: Buffer.from('Robin Wallace\nResidential superintendent, Hudson Construction, 2019–2026.') })
      await form.getByRole('checkbox').check()
      await fits(portal, evidence, 'submission-form', width)
      await form.getByRole('button', { name: 'Submit candidate', exact: true }).click()
      await portal.getByRole('region', { name: 'Submission: Robin Wallace ' + width, exact: true }).waitFor()
      await fits(portal, evidence, 'submitted', width)
      await openJob()
      const review = section.getByRole('article', { name: 'Agency submission: Robin Wallace ' + width, exact: true })
      await review.getByText('Review ownership and submission', { exact: true }).click()
      await review.getByLabel('Submission outcome').selectOption('Accepted-credited')
      await review.getByLabel('Reason for review decision').fill('Verified consent, source ownership and original resume; accepted for this job.')
      await fits(page, evidence, 'ownership-review', width)
      await review.getByRole('button', { name: 'Record agency review', exact: true }).click()
      await review.getByText('Accepted-credited', { exact: true }).waitFor()
      await review.getByText('Share progress and agency feedback', { exact: true }).click()
      await review.getByLabel('Progress visible to agency').selectOption('Interviewing')
      await review.getByLabel('Feedback addressed to agency').fill('Please confirm Robin can attend our site walk next week.')
      await review.getByRole('button', { name: 'Save agency progress', exact: true }).click()
      await review.locator('p').filter({ hasText: 'Feedback to agency:' }).waitFor()
      await portal.getByRole('button', { name: 'Refresh', exact: true }).click()
      await portal.getByText('Please confirm Robin can attend our site walk next week.', { exact: false }).waitFor()
      await fits(portal, evidence, 'progress', width)
      await fits(page, evidence, 'employer-progress', width)
      const w = await current(employer.context, origin), saved = w.agencies.find(x => x.email === email)
      const sub = saved.submissions.find(x => x.name === 'Robin Wallace ' + width)
      assert.equal(w.applications.find(x => x.id === sub.application).credit.who, name)
      // Staff explicitly record an accepted offer, then reconcile the credited hire's fee in the UI.
      const offer = await run('offer', { application: sub.application, salary: { currency: 'USD', amount: 10000000, period: 'year' }, startDate: '2026-11-16', opening: (await current(employer.context, origin)).vacancies.find(v => v.id === job.id).openings.find(o => o.status === 'open').id })
      const asked = await run('request-offer-approval', { id: offer.id, approver: ownerEmail })
      await run('decide-approval', { id: asked.id, decision: 'approved', version: asked.version, reason: 'Exact offer terms approved' })
      await run('offer-outcome', { id: offer.id, outcome: 'accepted', reason: 'Candidate accepted outside Lodge; no signature claimed' })
      await openJob()
      await review.getByText('Record a fee milestone', { exact: true }).click()
      await review.getByLabel('Fee milestone', { exact: true }).fill('Placement on start')
      await review.getByLabel('Amount (USD cents)', { exact: false }).fill('1500000')
      await review.getByLabel('Fee status', { exact: false }).selectOption('due')
      await review.getByRole('button', { name: 'Record fee milestone', exact: true }).click()
      await review.locator('table').getByText('Placement on start', { exact: true }).waitFor()
      await fits(page, evidence, 'employer-fee', width)
      await portal.getByRole('button', { name: 'Refresh', exact: true }).click()
      await portal.getByText('Placement on start', { exact: true }).waitFor()
      await fits(portal, evidence, 'fee', width)
      await run('agency-job', { agency: saved.id, vacancy: job.id, active: false })
      await portal.getByRole('button', { name: 'Refresh', exact: true }).click()
      await portal.getByRole('heading', { name: 'Placement fee milestones', exact: true }).waitFor()
      assert.equal(await portal.getByRole('heading', { name: 'Robin Wallace ' + width, exact: true }).count(), 0)
      await fits(portal, evidence, 'removed-job', width)
      await run('agency', { id: saved.id, email, name, active: false })
      await portal.getByRole('button', { name: 'Refresh', exact: true }).click()
      await portal.getByRole('alert').waitFor()
      assert.equal(await portal.getByRole('heading', { name: 'Agency portal', exact: true }).count(), 0, 'revocation clears the old portal')
      await fits(portal, evidence, 'revoked', width)
    } finally { await agencyContext?.close(); await employer.context.close() }
  }
}
