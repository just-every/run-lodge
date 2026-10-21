// CRM-005: two real invited native members on disjoint requisitions, with
// explicit employer ownership decisions and no canonical access from the portal.
import assert from 'node:assert/strict'
import { BUSINESS, harness } from './harness.mjs'
const resume = { name: 'agency-original.txt', mediaType: 'text/plain', base64: Buffer.from('Agency original resume\nWorked on site safety').toString('base64') }
export async function checkAgency(t) {
  const h = await harness(); t.after(() => h.close())
  const { command: cmd, send, state } = h
  await cmd('business', BUSINESS)
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
  const erased = await send('/api/lodge/delete-candidate', { candidate: accepted.candidate, confirm: 'Adrian Employer Correction', reason: 'Candidate requested erasure' }, h.owner)
  assert.equal(erased.status, 200, erased.text)
  assert.deepEqual((await state(cookie2)).agencyPortal.submissions, [])
}
