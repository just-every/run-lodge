import assert from 'node:assert/strict'
import { businessHarness } from './harness.mjs'
import { careersJob } from './careers-driver.mjs'
import { candidateSession, address, form } from './take-home-flow.mjs'

export const authorizationReview = app => ({ application: app.id, version: 0, disclosure: 'Synthetic local disclosure for a potential background check.', authorization: 'Synthetic authorization wording. Local evidence only.', purpose: 'Review job-related background after the employer process.', checkScope: 'Synthetic employer-selected employment verification.', language: app.language ?? 'en', legalReview: 'Synthetic employer counsel reviewed this exact wording.', retentionReview: 'Synthetic review: retain with this application, subject to holds and erasure.', reviewed: true })
export const authorizationPath = receipt => '/candidate/receipts/' + receipt.id + '/background-authorization'

export async function seedBackgroundAuthorization(h) {
  const job = await careersJob(h.command, 'Synthetic background authorization role')
  const email = address(320), otherEmail = address(321)
  for (const [name, applicantEmail] of [['Synthetic authorization applicant', email], ['Synthetic other applicant', otherEmail]]) {
    assert.equal((await h.send('/jobs/' + job.slug, form({ name, email: applicantEmail, noticeVersion: '1', consent: 'yes' }))).status, 200)
  }
  const w = await h.state(), person = w.candidates.find(c => c.email === email), app = w.applications.find(a => a.candidate === person.id)
  const receipt = w.receipts.find(r => r.application === app.id)
  const cookie = await candidateSession(h, email), otherCookie = await candidateSession(h, otherEmail)
  return { job, app, person, receipt, cookie, otherCookie, path: authorizationPath(receipt) }
}

/** One real Worker and D1 journey exercises consent custody and dangerous refusals. */
export async function checkBackgroundAuthorization() {
  let outbound = 0
  const h = await businessHarness({ clock: '2027-03-14T12:00:00.000Z', outboundService: () => { outbound++; return new Response('Unexpected provider call', { status: 503 }) } })
  try {
    console.log('Background authorization: native setup')
    const f = await seedBackgroundAuthorization(h), { app, person, path, cookie, otherCookie, job } = f
    const snapshot = async () => (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
    const noWrite = async (fn, status) => { const before = await snapshot(), r = await fn(); assert.equal(r.status, status, r.text); assert.deepEqual(await snapshot(), before); return r }
    const row = async () => (await h.state()).backgroundAuthorizations.records.find(r => r.application === app.id)
    const review = authorizationReview(app)
    for (const field of ['legalReview', 'retentionReview', 'purpose', 'checkScope', 'disclosure', 'authorization']) await noWrite(() => h.send('/api/lodge/command/background-authorization-review', { ...review, [field]: '' }, h.owner), 400)
    await noWrite(() => h.send('/api/lodge/command/background-authorization-review', { ...review, reviewed: false }, h.owner), 400)
    await noWrite(() => h.send('/api/lodge/command/background-authorization-review', { ...review, language: 'es' }, h.owner), 409)
    await noWrite(() => h.send(path, undefined, cookie), 404)
    console.log('Background authorization: review validated')
    await h.command('background-authorization-review', review)
    assert.equal((await row()).state, 'unanswered')
    const ready = await h.send(path, undefined, cookie)
    assert.equal(ready.status, 200); assert.match(ready.text, /Not submitted to or approved by Checkr/)
    assert.ok(!/name="agreement"[^>]*checked/.test(ready.text), 'agreement is never preselected')
    const answer = { version: 1, responseId: 'synthetic-lodge-agreement-320', action: 'agreed', agreement: true }
    await noWrite(() => h.send(path, answer, ''), 401)
    await noWrite(() => h.send(path, answer, otherCookie), 404)
    await noWrite(() => h.send(path, answer, cookie, { origin: 'https://example.test' }), 403)
    await noWrite(() => h.send(path, { ...answer, agreement: false }, cookie), 400)
    await noWrite(() => h.send(path, { ...answer, ssn: 'synthetic-lodge-1' }, cookie), 400)
    await noWrite(() => h.send(path, { ...answer, dateOfBirth: 'synthetic-lodge-2' }, cookie), 400)
    console.log('Background authorization: agreement concurrency')
    const pair = await Promise.all([h.send(path, answer, cookie), h.send(path, answer, cookie)])
    assert.ok(pair.some(r => r.status === 303)); assert.ok(pair.every(r => [303, 409].includes(r.status)))
    await noWrite(() => h.send(path, answer, cookie), 303)
    console.log('Background authorization: restart replay')
    await h.restart()
    await noWrite(() => h.send(path, answer, cookie), 303)
    assert.equal((await row()).history.length, 1)
    const identity = (await row()).history[0].identity
    assert.equal(identity.candidate, person.id); assert.equal(identity.email, person.email); assert.ok(identity.operator && identity.session)
    await noWrite(() => h.send(path, { ...answer, action: 'refused' }, cookie), 409)
    const withdrawal = { ...answer, action: 'withdrawn', responseId: 'synthetic-lodge-withdrawal-320' }
    assert.equal((await h.send(path, withdrawal, cookie)).status, 303)
    await noWrite(() => h.send(path, answer, cookie), 303)
    await noWrite(() => h.send(path, withdrawal, cookie), 303)
    assert.equal((await row()).state, 'withdrawn', 'replayed agreement cannot resurrect permission')
    await h.command('background-authorization-review', { ...review, version: 1, disclosure: 'Synthetic revised disclosure' })
    assert.equal((await row()).state, 'unanswered')
    await noWrite(() => h.send(path, { ...answer, responseId: 'synthetic-lodge-stale-320' }, cookie), 409)
    const refusal = { version: 2, action: 'refused', responseId: 'synthetic-lodge-refusal-320' }
    assert.equal((await h.send(path, refusal, cookie)).status, 303)
    assert.equal((await row()).state, 'refused')
    await h.command('background-authorization-review', { ...review, version: 2 })
    const third = { ...answer, version: 3, responseId: 'synthetic-lodge-third-320' }
    await h.db.prepare("UPDATE l_records SET value=json_set(value,'$.language','es') WHERE kind='application' AND id=?").bind(app.id).run()
    await noWrite(() => h.send(path, third, cookie), 409)
    await noWrite(() => h.send(path, undefined, cookie), 409)
    await h.db.prepare("UPDATE l_records SET value=json_set(value,'$.language','en') WHERE kind='application' AND id=?").bind(app.id).run()
    await h.command('correct-candidate', { ...person, id: person.id, name: 'Synthetic corrected identity', reason: 'Synthetic identity correction' })
    await noWrite(() => h.send(path, third, cookie), 409)
    await h.command('background-authorization-review', { ...review, version: 3 })
    assert.equal((await h.send(path, { ...third, version: 4, responseId: 'synthetic-lodge-fourth-320' }, cookie)).status, 303)

    console.log('Background authorization: restricted custody')
    const managerEmail = address(322), adminEmail = address(323)
    const manager = await h.member(managerEmail, ['manager']), admin = await h.member(adminEmail, ['admin'])
    const agent = await h.member(address(324), [], 'Synthetic admin agent', { agent: true, actsFor: adminEmail })
    const interviewer = await h.member(address(325), ['interviewer'])
    const compliance = await h.member(address(326), ['compliance'])
    await h.command('assign-reviewers', { application: app.id, reviewers: [address(325)] })
    await h.command('vacancy-compliance', { id: job.id, people: [address(326)] })
    await h.command('hiring-team', { id: job.id, recruiters: [managerEmail] })
    assert.equal((await h.state(admin)).backgroundAuthorizations.records.length, 1)
    for (const who of [manager, interviewer, compliance, agent]) {
      assert.equal((await h.state(who)).backgroundAuthorizations, null)
      assert.ok(!JSON.stringify(await h.state(who)).includes(review.disclosure))
      await noWrite(() => h.send('/api/lodge/command/background-authorization-review', { ...review, version: 4 }, who), 403)
    }
    await noWrite(() => h.send('/api/lodge/download/candidate/' + person.id, undefined, agent), 404)
    assert.equal((await h.send('/api/lodge/audit', undefined, agent)).value.events.some(e => e.action.startsWith('background-authorization-')), false)
    assert.equal((await h.send('/api/lodge/download/candidate/' + person.id, undefined, manager)).status, 403)
    assert.ok(!(await h.send('/api/lodge/download/vacancy/' + job.id, undefined, manager)).text.includes(review.disclosure))
    assert.deepEqual((await h.send('/api/lodge/search?q=' + encodeURIComponent('Synthetic local disclosure'), undefined, h.owner)).value.results, [])
    await h.command('member', { email: adminEmail, name: 'Synthetic former admin', roles: ['manager'], active: true })
    assert.equal((await h.state(admin)).backgroundAuthorizations, null)
    console.log('Background authorization: candidate access export')
    const exported = await h.send('/api/lodge/download/candidate/' + person.id, undefined, h.owner)
    assert.equal(exported.status, 200)
    const evidence = exported.value['background-authorization'][0]
    assert.equal(evidence.versions.length, 4); assert.equal(evidence.versions[0].disclosure, review.disclosure)
    assert.deepEqual(evidence.history.map(e => e.action), ['agreed', 'withdrawn', 'refused', 'agreed'])
    assert.deepEqual((({ stage, history }) => [stage, history])((await h.state()).applications.find(a => a.id === app.id)), [app.stage, app.history], 'choices never change application stage or its history')
    await h.command('background-authorization-review', { ...review, version: 4 })
    assert.equal((await h.send('/candidate/signout', {}, cookie)).status, 303)
    await noWrite(() => h.send(path, { ...third, version: 5, responseId: 'synthetic-lodge-fifth-320' }, cookie), 401)
    const renewed = await h.signIn(person.email)
    // Fair-chance review requests obey the existing approved conditional-offer boundary.
    console.log('Background authorization: fair-chance sequence')
    await h.command('fair-chance-places', { places: [{ place: 'New York', waitingDays: 5 }] })
    await noWrite(() => h.send('/api/lodge/command/background-authorization-review', { ...review, version: 5 }, h.owner), 409)
    await noWrite(() => h.send(path, { ...third, version: 5, responseId: 'synthetic-lodge-fifth-320' }, renewed), 409)
    const offer = await h.command('offer', { application: app.id, title: job.title, conditional: true, startDate: '2027-05-03', salary: { currency: 'USD', amount: 9000000, period: 'year' } })
    const approval = await h.command('request-offer-approval', { id: offer.id, approver: ['owner', 'example.test'].join('@') })
    await h.command('decide-approval', { id: approval.id, version: approval.version, decision: 'approved', reason: 'Synthetic conditional terms' })
    assert.equal((await h.send(path, { ...third, version: 5, responseId: 'synthetic-lodge-fifth-320' }, renewed)).status, 303)
    assert.equal((await row()).state, 'agreed')
    await h.command('offer-outcome', { id: offer.id, outcome: 'withdrawn', reason: 'Synthetic test complete' })
    const survivor = (await h.command('candidate', { name: 'Synthetic lineage survivor', email: person.email, source: 'Direct', consentBasis: 'manual' })).candidate
    await h.command('review-duplicate', { keep: survivor.id, other: person.id, decision: 'merge', reason: 'Synthetic same person' })
    const mergedExport = await h.send('/api/lodge/download/candidate/' + survivor.id, undefined, h.owner)
    assert.equal(mergedExport.status, 200)
    assert.equal(mergedExport.value['background-authorization'][0].candidate, survivor.id)
    assert.equal(mergedExport.value['background-authorization'][0].history[0].identity.candidate, person.id, 'merge preserves the original signer identity')
    await h.command('move', { application: app.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Synthetic close' })
    console.log('Background authorization: held erasure')
    const hold = await h.command('hold', { candidate: person.id, reason: 'Synthetic legal hold' })
    const erase = () => h.send('/api/lodge/delete-candidate', { candidate: survivor.id, confirm: survivor.name, reason: 'Synthetic erasure' }, h.owner)
    await noWrite(erase, 409)
    assert.equal((await row()).history.length, 5)
    await h.command('release-hold', { id: hold.id, reason: 'Synthetic released hold' })
    assert.equal((await erase()).status, 200)
    assert.equal((await snapshot()).some(r => r.kind === 'background-authorization'), false)
    await noWrite(() => h.send(path, undefined, renewed), 404)
    assert.equal(outbound, 0, 'local authorization performs zero Checkr or other provider calls')
  } finally { await h.close() }
}
