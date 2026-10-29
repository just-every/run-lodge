import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { businessHarness } from './harness.mjs'

export const handoffAddress = n => ['synthetic-lodge-handoff-' + n, 'example.test'].join('@')
export async function handoffJob(run, ownerEmail, manager = ownerEmail, suffix = '', offerApprover = ownerEmail, approve = run) {
  let job = await run('vacancy', { title: 'Synthetic Lodge handoff' + suffix, location: 'Denver, CO', manager, headcount: 3, compensation: { currency: 'USD', min: 6000000, max: 8000000, period: 'year' } })
  await run('rubric', { id: job.id, criteria: [{ name: 'Planning', description: 'Describes a safe work plan' }] })
  await run('interview-plan', { id: job.id, plan: [{ name: 'Work review', stageName: 'Interview' }] })
  const approval = await run('request-vacancy-approval', { id: job.id, approver: ownerEmail })
  await run('decide-approval', { id: approval.id, version: approval.version, decision: 'approved', reason: 'Headcount reviewed' })
  job = await run('publish', { id: job.id })
  const template = await run('offer-template', { name: 'Synthetic Lodge handoff terms' + suffix, reviewed: true, native: true, body: 'Dear {{candidateName}}, {{title}}. {{pay}}. {{startDate}}. {{terms}}', normalApprover: offerApprover, exceptionApprover: offerApprover })
  const offers = [], people = []
  for (let index = 0; index < 3; index++) {
    const person = await run('candidate', { name: 'Synthetic Lodge hire ' + index + suffix, email: handoffAddress(index + suffix), source: 'Direct', consentBasis: 'manual', vacancy: job.id })
    const offer = await run('offer', { application: person.application.id, salary: { currency: 'USD', amount: 7000000, period: 'year' }, startDate: '2037-12-07', terms: 'Forty hours each week.', opening: job.openings[index].id, offerTemplate: { id: template.id, version: 1 } })
    const asked = await run('request-offer-approval', { id: offer.id })
    await approve('decide-approval', { id: asked.id, version: asked.version, decision: 'approved', reason: 'Exact document and terms reviewed' })
    people.push(person); offers.push(offer)
  }
  const original = Buffer.from('Synthetic Lodge signed paper original' + suffix)
  await run('offer-signed-outside', { id: offers[0].id, attest: true, method: 'paper', differences: 'No differences attested', name: 'signed-original.txt', mediaType: 'text/plain', base64: original.toString('base64') })
  await run('offer-outcome', { id: offers[1].id, outcome: 'accepted', reason: 'Acceptance recorded without a signed document' })
  return { job, offers, people, original }
}
export const handoffProposal = (row, approver, owner = approver) => ({ workflow: 'handoff-exception', offer: row.offer, sources: row.sources,
  comparison: { termsVersion: row.termsVersion, signature: row.signature, issues: row.issues }, approver, owner, deadline: '2037-01-10T17:00:00.000Z', nextAction: 'Collect the missing administrative field using the existing candidate controls; inspect destination separately.' })
const form = fields => { const f = new FormData(); for (const [key, value] of Object.entries(fields)) f.set(key, value); return f }

export async function checkHandoffExceptions() {
  let outbound = 0
  const h = await businessHarness({ clock: '2037-01-09T12:00:00.000Z', outboundService: () => { outbound++; return new Response('unexpected provider call', { status: 502 }) } })
  try {
    const { command: run, send, state } = h, ownerEmail = (await state()).actor.email
    const principalEmail = handoffAddress('principal'), reviewerEmail = handoffAddress('reviewer'), agentEmail = handoffAddress('agent')
    const principal = await h.member(principalEmail, ['manager'], 'Synthetic Lodge principal')
    const reviewer = await h.member(reviewerEmail, ['manager'], 'Synthetic Lodge reviewer')
    const agent = await h.member(agentEmail, [], 'Synthetic Lodge external agent', { agent: true, actsFor: principalEmail })
    const unrelated = await h.member(handoffAddress('unrelated'), ['interviewer'], 'Synthetic Lodge unrelated')
    const f = await handoffJob(run, ownerEmail, principalEmail)
    await run('hiring-team', { id: f.job.id, recruiters: [reviewerEmail] })
    await run('handoff-policy', { vacancy: f.job.id, fields: ['phone', 'department'] })
    const evidence = async (offer = f.offers[0], cookie = agent) => {
      const response = await send('/api/lodge/handoff-preflight/' + offer.id, undefined, cookie)
      assert.equal(response.status, 200, response.text); return response.value
    }
    let row = await evidence()
    assert.deepEqual(row.terms.salary, { currency: 'USD', amount: 7000000, period: 'year' })
    assert.equal(row.terms.startDate, '2037-12-07')
    assert.equal(row.terms.terms, 'Forty hours each week.')
    assert.equal(row.termsVersion, row.signature.termsVersion)
    assert.deepEqual(row.fields.map(field => [field.key, field.missing]), [['department', true], ['phone', true]])
    assert.equal(row.signature.kind, 'outside'); assert.equal(row.signature.providerVerified, false)
    assert.equal(row.signature.artifacts[0].sha256, createHash('sha256').update(f.original).digest('hex'))
    assert.equal(row.signature.artifacts[0].intact, true)
    const bytes = await send('/api/lodge/download/document/' + row.signature.artifacts[0].document, undefined, principal)
    assert.equal(bytes.status, 200); assert.equal(bytes.text, f.original.toString())
    assert.equal((await evidence(f.offers[1])).signature.kind, 'unsigned')
    assert.ok((await evidence(f.offers[1])).issues.includes('Recorded acceptance is unsigned'))
    // Complete an actual native signature through its candidate HTTP doors, then compare saved bytes.
    await run('esign-disclosure', { reviewed: true })
    assert.equal((await send('/api/lodge/esign/send', { offer: f.offers[2].id }, h.owner)).status, 200)
    const mails = async () => (await h.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence').all()).results.map(r => JSON.parse(r.message)).filter(m => m.to.includes(f.people[2].candidate.email))
    const path = (await mails()).find(m => m.text.includes('/sign/')).text.match(/\/sign\/[0-9a-f]{64}/)[0]
    assert.equal((await send(path + '/code', form({}))).status, 200)
    const code = (await mails()).at(-1).text.match(/code is (\d{6})/)[1]
    const verified = await send(path + '/verify', form({ code })); assert.equal(verified.status, 303)
    assert.equal((await send(path + '/agree', form({ version: '1', box: 'yes' }), verified.cookie)).status, 303)
    assert.equal((await send(path + '/sign', form({ name: f.people[2].candidate.name, hash: f.offers[2].document.sha256 }), verified.cookie)).status, 303)
    const native = await evidence(f.offers[2])
    assert.equal(native.signature.kind, 'native'); assert.equal(native.signature.artifacts.length, 2)
    assert.ok(native.signature.artifacts.every(a => a.intact))
    assert.ok(!native.issues.some(i => /Native signature completion/.test(i)))
    for (const artifact of native.signature.artifacts) {
      const saved = JSON.parse((await h.db.prepare("SELECT value FROM l_records WHERE kind='blob' AND id=?").bind(artifact.document).first()).value)
      assert.equal(artifact.sha256, createHash('sha256').update(Buffer.from(saved.base64, 'base64')).digest('hex'))
      assert.equal((await send('/api/lodge/download/document/' + artifact.document, undefined, agent)).status, 404, 'metadata preflight grants no agent download')
    }
    row = await evidence()
    const baseline = await state(), legalTerms = baseline.offers
    const propose = body => send('/api/lodge/command/propose', body, agent)
    assert.equal((await propose({ ...handoffProposal(row, reviewerEmail), comparison: { ...handoffProposal(row, reviewerEmail).comparison, termsVersion: 'fabricated' } })).status, 409)
    assert.equal((await propose({ ...handoffProposal(row, reviewerEmail), complete: true })).status, 400)
    assert.equal((await send('/api/lodge/command/handoff-progress', { id: row.offer }, agent)).status, 403)
    assert.equal((await send('/api/lodge/handoff-preflight/' + row.offer, undefined, unrelated)).status, 404)
    const attempts = await Promise.all([propose(handoffProposal(row, reviewerEmail)), propose(handoffProposal(row, reviewerEmail))])
    assert.ok(attempts.every(r => [200, 409].includes(r.status)))
    assert.ok(attempts.some(r => r.status === 200), JSON.stringify(attempts.map(r => [r.status, r.value])))
    const packet = attempts.find(r => r.status === 200).value
    assert.equal((await propose(handoffProposal(row, reviewerEmail))).value.id, packet.id)
    await h.restart()
    assert.equal((await propose(handoffProposal(row, reviewerEmail))).value.id, packet.id)
    const decisions = await Promise.all([1, 2].map(() => send('/api/lodge/command/decide-proposal', { id: packet.id, decision: 'accepted', reason: 'Approve this named owner, deadline and next action' }, reviewer)))
    assert.ok(decisions.some(r => r.status === 200) && decisions.every(r => [200, 409].includes(r.status)), JSON.stringify(decisions))
    await run('decide-proposal', { id: packet.id, decision: 'accepted', reason: 'Retry same approval' }, reviewer)
    let owned = (await state(reviewer)).handoffExceptions.cases[0]
    assert.equal(owned.history.length, 1); assert.equal(owned.owner, reviewerEmail)
    assert.deepEqual([owned.complete, owned.employeeCreated, owned.destinationReadback], [false, false, 'unknown'])
    const exported = await send('/api/lodge/download/candidate/' + row.candidate, undefined, h.owner)
    assert.equal(exported.status, 200)
    assert.equal(exported.value['handoff-exception'][0].history[0].proposal, packet.id)
    const download = await send('/api/lodge/download/handoff/' + row.offer, undefined, principal)
    assert.equal(download.status, 200); assert.deepEqual([download.value.complete, download.value.employeeCreated], [false, false])
    assert.equal((await send('/api/lodge/command/handoff-progress', { id: owned.id, revision: owned.revision, sources: row.sources, status: 'completed' }, reviewer)).status, 400)
    await h.setTime('2037-01-11T12:00:00.000Z')
    assert.equal((await state(reviewer)).handoffExceptions.cases[0].overdue, true)
    const progress = { id: owned.id, revision: owned.revision, sources: row.sources, owner: principalEmail, deadline: '2037-01-12T17:00:00Z', nextAction: 'Collect candidate phone through existing controls', status: 'owned', reason: 'Reassign with a new deadline' }
    await run('handoff-progress', progress, reviewer)
    assert.equal((await send('/api/lodge/command/handoff-progress', progress, reviewer)).status, 409)
    await h.restart(); owned = (await state(principal)).handoffExceptions.cases[0]
    assert.equal(owned.owner, principalEmail); assert.equal(owned.history.length, 2)
    const currentPerson = (await state()).candidates.find(c => c.id === f.people[0].candidate.id)
    const pending = await run('propose', handoffProposal(row, reviewerEmail), agent)
    await run('correct-candidate', { ...currentPerson, phone: '555 0100', reason: 'Human supplied administrative contact field' })
    assert.equal((await send('/api/lodge/command/decide-proposal', { id: pending.id, decision: 'accepted', reason: 'Stale sources' }, reviewer)).status, 409)
    assert.equal((await state()).handoffExceptions.cases[0].stale, true)
    row = await evidence(); assert.equal(row.fields.find(f => f.key === 'phone').missing, false)
    assert.deepEqual((await state()).offers, legalTerms, 'administrative correction and case review preserve every legal offer term')
    const restricted = await run('permission-level', { name: 'Synthetic Lodge no offer access', permissions: ['contact'] })
    await run('job-levels', { id: f.job.id, members: { [reviewerEmail]: restricted.id }, roles: {} })
    assert.equal((await state(principal)).handoffExceptions.cases.length, 0, 'reviewer revocation hides retained narrative')
    assert.ok(!(await state()).proposals.some(p => p.id === packet.id))
    assert.equal((await send('/api/lodge/command/decide-proposal', { id: pending.id, decision: 'accepted', reason: 'Revoked review' }, reviewer)).status, 404)
    await run('job-levels', { id: f.job.id, members: { [principalEmail]: restricted.id }, roles: {} })
    assert.equal((await send('/api/lodge/handoff-preflight/' + row.offer, undefined, agent)).status, 404)
    assert.equal((await state(reviewer)).handoffExceptions.cases.length, 0, 'principal revocation hides retained narrative')
    await run('job-levels', { id: f.job.id, members: {}, roles: {} })
    const noContact = await run('permission-level', { name: 'Synthetic Lodge no contact access', permissions: ['offers'] })
    await run('job-levels', { id: f.job.id, members: { [reviewerEmail]: noContact.id }, roles: {} })
    assert.equal((await state(principal)).handoffExceptions.cases.length, 0, 'contact permission is independently required')
    await run('job-levels', { id: f.job.id, members: {}, roles: {} })
    const fresh = await run('propose', handoffProposal(await evidence(), reviewerEmail), agent)
    await run('decide-proposal', { id: fresh.id, decision: 'rejected', reason: 'Do not adopt this plan' }, reviewer)
    assert.equal((await state()).handoffExceptions.cases[0].history.length, 2)
    assert.equal(outbound, 0, 'no HRIS or background-provider calls')
    const erased = await send('/api/lodge/delete-candidate', { candidate: currentPerson.id, confirm: currentPerson.name, reason: 'Erase personal handoff history' }, h.owner)
    assert.equal(erased.status, 200, erased.text)
    assert.equal(erased.value.counts['handoff-exception'], 1)
    assert.equal((await state()).handoffExceptions.cases.length, 0)
    assert.equal((await send('/api/lodge/handoff-preflight/' + row.offer, undefined, agent)).status, 404)
    assert.equal((await propose(handoffProposal(row, reviewerEmail))).status, 404, 'replay cannot resurrect erased evidence')
    assert.equal((await h.db.prepare("SELECT COUNT(*) AS count FROM l_records WHERE kind='proposal' AND instr(value,?)>0").bind(currentPerson.id).first()).count, 0)
  } finally { await h.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await checkHandoffExceptions(); console.log('Native handoff exception sanity journey passed')
}
