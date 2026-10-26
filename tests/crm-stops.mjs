import assert from 'node:assert/strict'
import { crmFixture, crmClock } from './crm-flow.mjs'
import { folderEntries, zip } from './zip.mjs'

export async function checkNurtureStops(t) {
 const h = await crmFixture(); t.after(() => h.close())
 await h.verifyRoute()
 const scenario = async label => {
  await h.setTime(crmClock)
  const person = await h.add(label, label.toLowerCase().replaceAll(' ', '-') + '@example.test')
  const pool = await h.command('crm-pool', { name: label, query: 'Bluebeam', candidates: [person.candidate.id], reason: 'Recorded Bluebeam experience and current consent' })
  const draft = await h.command('crm-enroll', { ...h.input, pool: pool.id, candidate: person.candidate.id, sourceApplication: person.application.id })
  return { person, pool, draft }
 }
 const outcomes = async draft => (await h.view()).enrollments.find(e => e.id === draft.id).outcomes
 const expired = await scenario('Expired Consent')
 await h.command('extend-retention', { candidate: expired.person.candidate.id, until: '2026-10-25', reason: 'The recorded permission expired' })
 await h.command('crm-enable', { id: expired.draft.id, reviewed: true, enabled: true }, h.owner, 409)
 const withdrawn = await scenario('Withdrawn Candidate')
 const otherApp = await h.command('apply', { candidate: withdrawn.person.candidate.id, vacancy: h.job.id, source: 'Human selected another application' })
 await h.command('crm-enable', { id: withdrawn.draft.id, reviewed: true, enabled: true })
 await h.command('move', { application: otherApp.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Candidate withdrew' })
 await h.tick('2026-10-26T14:01:00.000Z'); assert.equal((await outcomes(withdrawn.draft)).length, 0)
 const hired = await scenario('Accepted Offer')
 const active = await h.command('apply', { candidate: hired.person.candidate.id, vacancy: h.job.id, source: 'Human selected another application' })
 await h.command('crm-enable', { id: hired.draft.id, reviewed: true, enabled: true })
 const opening = (await h.state()).vacancies.find(v => v.id === h.job.id).openings[0].id
 const offer = await h.command('offer', { application: active.id, opening, salary: { currency: 'USD', amount: 4500000, period: 'year' }, startDate: '2026-11-16', terms: 'Reviewed employment terms' })
 const approval = await h.command('request-offer-approval', { id: offer.id, approver: 'owner@example.test' })
 await h.command('decide-approval', { id: approval.id, version: (await h.state()).approvals.find(a => a.id === approval.id).currentVersion, decision: 'approved', reason: 'Exact terms reviewed' })
 await h.command('offer-outcome', { id: offer.id, outcome: 'accepted', reason: 'Accepted by the candidate' })
 await h.tick('2026-10-26T14:01:00.000Z'); assert.equal((await outcomes(hired.draft)).length, 0)
 const revoked = await scenario('Revoked Reviewer')
 const admin = await h.member('nurture-reviewer@example.test', ['admin'])
 await h.command('crm-enable', { id: revoked.draft.id, reviewed: true, enabled: true }, admin)
 await h.command('member', { email: 'nurture-reviewer@example.test', name: 'Nurture reviewer', roles: ['admin'], active: false })
 await h.tick('2026-10-26T14:01:00.000Z'); assert.equal((await outcomes(revoked.draft)).length, 0)
 const failed = await scenario('Uncertain Delivery')
 await h.command('crm-enable', { id: failed.draft.id, reviewed: true, enabled: true })
 await h.db.exec("CREATE TRIGGER fail_nurture_mail BEFORE INSERT ON rer_mail_development_outbox BEGIN SELECT RAISE(ABORT, 'synthetic-lodge-transport-loss'); END;")
 await h.tick('2026-10-26T14:01:00.000Z')
 await h.db.exec('DROP TRIGGER fail_nurture_mail')
 assert.equal((await outcomes(failed.draft))[0].status, 'uncertain')
 await h.restart(); await h.tick('2026-10-26T16:00:00.000Z'); assert.equal((await outcomes(failed.draft)).length, 1)
 const pkg = { filename: 'workable-export.zip', base64: zip(await folderEntries('fixtures/workable-full-export')).toString('base64') }
 const preview = await h.send('/api/lodge/import/preview', pkg, h.owner); assert.equal(preview.status, 200)
 assert.equal((await h.send('/api/lodge/import/commit', { ...pkg, fingerprint: preview.value.plan.fingerprint }, h.owner)).status, 200)
 const imported = (await h.state()).candidates.find(c => c.name === 'Dana Whitfield')
 assert.equal(imported.consent.talentPool, false); assert.equal(imported.consent.sourceTalentPool, true)
 await h.command('crm-pool', { name: 'Source pool alone', query: 'Dana', candidates: [imported.id], reason: 'Source membership is not consent' }, h.owner, 409)
 await h.command('correct-candidate', { ...imported, skills: 'Bluebeam', talentPool: true, reason: 'Candidate explicitly consented to future-opening outreach with the current retention deadline' })
 const pool = await h.command('crm-pool', { name: 'Explicitly consented imported history', query: 'Bluebeam', candidates: [imported.id], reason: 'Current native consent was recorded' })
 const source = (await h.state()).applications.find(a => a.candidate === imported.id)
 const draft = await h.command('crm-enroll', { ...h.input, pool: pool.id, candidate: imported.id, sourceApplication: source.id, dueAt: '2026-10-26T17:00:00.000Z' })
 assert.equal(draft.status, 'draft'); assert.equal((await outcomes(draft)).length, 0)
}
