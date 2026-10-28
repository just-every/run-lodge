import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { businessHarness } from './harness.mjs'
import { enterpriseJob } from './enterprise-flow.mjs'

const address = n => ['synthetic-lodge-' + n, 'example.test'].join('@')
const path = '/api/lodge/prospect-capture/'
const snapshot = async h => (await h.db.prepare('SELECT * FROM l_records ORDER BY kind,id').all()).results
export const prospect = (n, vacancy = '') => ({ captureId: randomUUID(), name: 'Synthetic Lodge Prospect ' + n, email: address(n), phone: '', location: 'Denver', headline: 'Public work history', sourceURL: 'https://ordinary.example.test/profile?tracking=discard#discard', vacancy, consentBasis: 'manual', consentNote: 'Employer recorded applicable basis after explicit review', talentPool: !vacancy })

/** One sanity journey through authenticated HTTP and real D1: review, choice, capture and refusal. */
export async function checkProspectCapture(t) {
  const h = await businessHarness(); t.after(() => h.close())
  const adminEmail = address(10), recruiterEmail = address(11), sourcerEmail = address(12)
  const admin = await h.member(adminEmail, ['admin']), recruiter = await h.member(recruiterEmail, ['manager']), sourcer = await h.member(sourcerEmail, ['interviewer'])
  const interviewer = await h.member(address(13), ['interviewer'])
  const agent = await h.member(address(14), [], 'Synthetic agent', { agent: true, actsFor: adminEmail })
  const job = await enterpriseJob(h, 'Synthetic capture target'), previousJob = await enterpriseJob(h, 'Synthetic prior job'), secret = await enterpriseJob(h, 'Synthetic confidential job')
  await h.command('hiring-team', { id: job.id, recruiters: [recruiterEmail], sourcers: [sourcerEmail] })
  await h.command('hiring-team', { id: previousJob.id, recruiters: [recruiterEmail] })
  await h.command('vacancy-privacy', { id: secret.id, confidential: true })
  const existingInput = prospect(20, job.id)
  const known = await h.command('candidate', { ...existingInput, source: 'Earlier source', vacancy: previousJob.id })
  const hidden = await h.command('candidate', { ...existingInput, name: 'Synthetic confidential person', source: 'Confidential source', vacancy: secret.id })
  const preview = async (input, cookie = h.owner) => {
    const r = await h.send(path + 'preview', input, cookie)
    assert.equal(r.status, 200, r.text)
    assert.equal(r.headers.get('cache-control'), 'no-store')
    return r.value
  }
  const confirmation = (p, decisions = []) => ({ ...p.fields, token: p.token, expires: p.expires, decisions, confirmed: true })
  const confirm = (p, decisions = [], cookie = h.owner) => h.send(path + 'confirm', confirmation(p, decisions), cookie)
  const unchanged = async action => { const before = await snapshot(h); const response = await action(); assert.deepEqual(await snapshot(h), before, 'refusal or canceled review writes no hiring record'); return response }

  const offered = await unchanged(() => preview(existingInput, recruiter))
  assert.deepEqual(offered.duplicates.map(d => d.id), [known.candidate.id])
  assert.equal(JSON.stringify(offered).includes(hidden.candidate.id), false)
  assert.equal(JSON.stringify(offered).includes('Synthetic confidential person'), false)
  assert.equal(offered.fields.sourceURL, 'https://ordinary.example.test/profile')
  assert.equal((await unchanged(() => confirm(offered, [], recruiter))).status, 409)
  assert.equal((await unchanged(() => confirm(offered, [{ id: hidden.candidate.id, decision: 'existing' }], recruiter))).status, 409)
  assert.equal((await unchanged(() => h.send(path + 'confirm', { ...confirmation(offered), confirmed: false }, recruiter))).status, 409)
  assert.equal((await unchanged(() => h.send(path + 'confirm', { ...confirmation(offered), name: 'Changed after review' }, recruiter))).status, 409)
  const linked = await confirm(offered, [{ id: known.candidate.id, decision: 'existing' }], recruiter)
  assert.equal(linked.status, 200, linked.text)
  assert.equal(linked.value.candidate, known.candidate.id)
  let w = await h.state()
  const app = w.applications.find(a => a.id === linked.value.application)
  assert.deepEqual([app.source, app.credit.kind, app.credit.who, app.sourceURL], ['Sourced: extension', 'sourcer', recruiterEmail, 'https://ordinary.example.test/profile'])
  assert.equal(app.sourceEntry.type, 'sourced')
  const retained = w.candidates.find(c => c.id === known.candidate.id)
  assert.equal(retained.source, 'Earlier source', 'existing person details are not overwritten')
  assert.equal(retained.prospectCaptures[0].consentNote, existingInput.consentNote)
  assert.equal(retained.prospectCaptures[0].existing, true)
  assert.equal((await unchanged(() => confirm(offered, [{ id: known.candidate.id, decision: 'existing' }], recruiter))).status, 409)

  // The capture's source and sourcer credit reach the existing hire report.
  const opening = (await h.state()).vacancies.find(v => v.id === job.id).openings[0]
  const offer = await h.command('offer', { application: app.id, title: job.title, startDate: '2027-04-01', salary: { currency: 'USD', amount: 9000000, period: 'year' }, opening: opening.id })
  const approval = await h.command('request-offer-approval', { id: offer.id, approver: (await h.state()).actor.email })
  await h.command('decide-approval', { id: approval.id, decision: 'approved', version: approval.version, reason: 'Employer reviewed exact terms' })
  await h.command('offer-outcome', { id: offer.id, outcome: 'accepted', reason: 'Employer recorded acceptance' })
  const report = await h.send('/api/lodge/reports/sources', undefined, recruiter)
  assert.equal(report.status, 200, report.text)
  assert.equal(report.value.bySource.find(row => row.name === 'Sourced: extension').hires, 1)
  assert.deepEqual(report.value.byCredit, [{ kind: 'sourcer', who: recruiterEmail, hires: 1 }])
  assert.deepEqual(report.value.hires.map(hire => [hire.application, hire.name, hire.credit.who]), [[app.id, 'Sourced: extension', recruiterEmail]])

  // Every shown duplicate needs a human choice; a distinct choice creates a separate person.
  const distinct = await preview({ ...existingInput, captureId: randomUUID() }, recruiter)
  const separate = await confirm(distinct, [{ id: known.candidate.id, decision: 'distinct' }], recruiter)
  assert.equal(separate.status, 200, separate.text)
  assert.notEqual(separate.value.candidate, known.candidate.id)
  assert.equal((await h.state()).candidates.find(c => c.id === known.candidate.id).mergedInto, undefined)
  const sourced = await preview(prospect(21, job.id), sourcer)
  const added = await confirm(sourced, [], sourcer)
  assert.equal(added.status, 200, added.text)
  assert.equal((await h.state()).applications.find(a => a.id === added.value.application).credit.who, sourcerEmail)
  for (const cookie of ['', interviewer, agent]) {
    const refused = await unchanged(() => h.send(path + 'preview', prospect(22, job.id), cookie))
    assert.ok([401, 403].includes(refused.status), refused.text)
  }
  assert.equal((await unchanged(() => h.send(path + 'preview', prospect(22, job.id), recruiter, { origin: 'https://ordinary.example.test' }))).status, 403)
  for (const sourceURL of ['https://www.linkedin.com/in/synthetic-lodge-1', 'https://mail.google.com/mail', 'javascript:alert(1)']) assert.equal((await unchanged(() => h.send(path + 'preview', { ...prospect(22, job.id), sourceURL }, recruiter))).status, 400)
  assert.equal((await unchanged(() => h.send(path + 'preview', { ...prospect(22, job.id), consentNote: '' }, recruiter))).status, 400)

  // A changed destination or permission invalidates a prepared review without a partial write.
  const stale = await preview(prospect(23, job.id), recruiter)
  await h.command('hiring-team', { id: job.id, recruiters: [], sourcers: [sourcerEmail] })
  assert.equal((await unchanged(() => confirm(stale, [], recruiter))).status, 403)
  const revokedReport = await h.send('/api/lodge/reports/sources', undefined, recruiter)
  assert.equal(revokedReport.status, 200, revokedReport.text)
  assert.equal(JSON.stringify(revokedReport.value).includes(app.id), false, 'revoked job authority removes the captured hire from reports')
  await h.command('hiring-team', { id: job.id, recruiters: [recruiterEmail], sourcers: [sourcerEmail] })
  const noContact = await h.command('permission-level', { name: 'Synthetic no contact', permissions: ['settings'] })
  const permissionReview = await preview(prospect(24, job.id), recruiter)
  await h.command('job-levels', { id: job.id, members: { [recruiterEmail]: noContact.id }, roles: {} })
  assert.equal((await unchanged(() => confirm(permissionReview, [], recruiter))).status, 403)
  await h.command('job-levels', { id: job.id, members: {}, roles: {} })
  const lateMatchInput = prospect(25, job.id), lateReview = await preview(lateMatchInput, recruiter)
  await h.command('candidate', { ...lateMatchInput, source: 'Native entry', vacancy: job.id })
  assert.equal((await unchanged(() => confirm(lateReview, [], recruiter))).status, 409, 'a newly visible match requires fresh review')

  // Native pool capture has explicit contact consent, current admin authority and inert replay.
  assert.equal((await unchanged(() => h.send(path + 'preview', prospect(26), recruiter))).status, 403)
  assert.equal((await unchanged(() => h.send(path + 'preview', { ...prospect(26), talentPool: false }, admin))).status, 403)
  const pooled = await preview(prospect(26), admin)
  const poolResult = await confirm(pooled, [], admin)
  assert.equal(poolResult.status, 200, poolResult.text)
  assert.equal(poolResult.value.application, null)
  const poolPerson = (await h.state()).candidates.find(c => c.id === poolResult.value.candidate)
  assert.equal(poolPerson.consent.talentPool, true)
  assert.equal(poolPerson.prospectCaptures[0].sourceURL, 'https://ordinary.example.test/profile')
  const exported = await h.send('/api/lodge/download/candidate/' + poolPerson.id, undefined, h.owner)
  assert.equal(exported.status, 200, exported.text)
  assert.ok(exported.text.includes('Employer recorded applicable basis'))
  assert.equal(exported.text.includes(pooled.token), false)
  const hold = await h.command('hold', { candidate: poolPerson.id, reason: 'Synthetic preservation' })
  assert.equal((await h.send('/api/lodge/delete-candidate', { candidate: poolPerson.id, confirm: poolPerson.name, reason: 'Synthetic erasure' }, h.owner)).status, 409)
  await h.command('release-hold', { id: hold.id, reason: 'Synthetic release' })
  assert.equal((await h.send('/api/lodge/delete-candidate', { candidate: poolPerson.id, confirm: poolPerson.name, reason: 'Synthetic erasure' }, h.owner)).status, 200)
  await h.restart()
  assert.equal((await unchanged(() => confirm(pooled, [], admin))).status, 409, 'erasure and restart never revive the same capture')
  const stored = JSON.stringify(await snapshot(h))
  assert.equal(stored.includes(poolPerson.email), false)
  assert.equal(stored.includes(poolPerson.name), false)
  assert.equal(stored.includes(pooled.token), false)
  assert.equal((await unchanged(() => h.send(path + 'preview', { ...pooled.fields, captureId: randomUUID() }, admin))).status, 409, 'a fresh handoff cannot restore the erased canonical address')
  const marker = JSON.parse((await h.db.prepare("SELECT value FROM l_records WHERE kind='prospect-capture-spent' AND id=?").bind(pooled.fields.captureId).first()).value)
  assert.deepEqual(marker, { id: pooled.fields.captureId, spent: true })

  const memberReview = await preview(prospect(27), admin)
  await h.command('member', { email: adminEmail, name: 'Synthetic deprovisioned reviewer', roles: ['admin'], active: false })
  assert.ok([401, 403].includes((await unchanged(() => confirm(memberReview, [], admin))).status))
  assert.ok([401, 403].includes((await unchanged(() => h.send(path + 'preview', prospect(27), admin))).status))
  const sessionReview = await preview(prospect(28, job.id), recruiter)
  await h.send('/auth/signout', {}, recruiter)
  assert.equal((await unchanged(() => confirm(sessionReview, [], recruiter))).status, 401)
  assert.equal((await unchanged(() => h.send(path + 'preview', prospect(28, job.id), recruiter))).status, 401)
  w = await h.state()
  assert.ok(!w.candidates.some(c => ['Synthetic Lodge Prospect 27', 'Synthetic Lodge Prospect 28'].includes(c.name)))
}
