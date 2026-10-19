import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { BUSINESS, harness } from './harness.mjs'

export async function checkOfferDocuments() {
 const h = await harness()
 try {
  await h.command('business', BUSINESS)
  const manager = await h.member('preparer@example.test', ['manager'], 'Morgan Preparer')
  const normal = await h.member('normal@example.test', ['approver'], 'Parker Normal')
  const exception = await h.member('exception@example.test', ['approver'], 'Rowan Compensation')
  const cmd = h.command
  const templateBody = 'Dear {{candidateName}},\n{{title}} in {{location}}, {{employmentType}}.\nPay {{pay}}, starting {{startDate}}.\nBonus {{bonus}}; equity {{equity}}.\n{{contingencies}}\n{{terms}}'
  const templateInput = { name: 'US salaried offer', body: templateBody, normalApprover: 'normal@example.test', exceptionApprover: 'exception@example.test', contingencies: 'Subject to employer-reviewed work authorization requirements.', reviewed: true }
  await cmd('offer-template', templateInput, manager, 403)
  await cmd('offer-template', { ...templateInput, reviewed: false }, h.owner, 400)
  await cmd('offer-template', { ...templateInput, body: 'Hello {{unknown}}' }, h.owner, 400)
  const salaried = await cmd('offer-template', templateInput)
  const hourly = await cmd('offer-template', { ...templateInput, name: 'US hourly offer' })
  async function open(title, period, min, max) {
   const job = await cmd('vacancy', { title, location: 'Brooklyn, NY', headcount: 2, manager: 'preparer@example.test', compensation: { currency: 'USD', min, max, period } }, manager)
   await cmd('rubric', { id: job.id, criteria: [{ name: 'Safety', description: 'Explains safe site operations' }] }, manager)
   await cmd('interview-plan', { id: job.id, plan: [{ name: 'Work review', stageName: 'Interview' }] }, manager)
   await publish(job)
   return (await h.state(manager)).vacancies.find(v => v.id === job.id)
  }
  async function publish(job) {
   const approval = await cmd('request-vacancy-approval', { id: job.id, approver: 'normal@example.test' }, manager)
   await cmd('decide-approval', { id: approval.id, decision: 'approved', reason: 'Budget reviewed', version: approval.version }, normal)
   await cmd('publish', { id: job.id }, manager)
  }
  async function applicant(job, name) {
   return (await cmd('candidate', { name, email: name.toLowerCase().replaceAll(' ', '.') + '@example.test', source: 'Referral', consentBasis: 'referral', consentNote: 'Agreed to this application', vacancy: job.id }, manager)).application
  }
  const job = await open('Site superintendent', 'year', 9000000, 11000000)
  const application = await applicant(job, 'Taylor Rivers')
  const input = { application: application.id, title: job.title, salary: { currency: 'USD', amount: 10000000, period: 'year' }, startDate: '2026-12-07', terms: 'Forty hours each week.', opening: job.openings[0].id, offerTemplate: { id: salaried.id, version: 1 }, location: job.location, employmentType: 'full-time', bonus: 250000, equity: 'No equity granted' }
  await cmd('offer', { ...input, equity: '' }, manager, 400)
  assert.equal((await h.state(manager)).offers.length, 0, 'missing merge fields create no draft')
  let offer = await cmd('offer', input, manager)
  assert.ok(offer.document.text.includes('Taylor Rivers') && offer.document.text.includes('USD 100000.00 per year') && offer.document.text.includes('USD 2500.00'))
  assert.ok(offer.document.text.includes('Brooklyn, NY') && offer.document.text.includes('full-time') && offer.document.text.includes('2026-12-07') && offer.document.text.includes(input.equity) && offer.document.text.includes(templateInput.contingencies) && offer.document.text.includes(input.terms), 'every compensation/document term merges')
  const firstDocument = structuredClone(offer.document)
  const release = () => h.send('/api/lodge/download/prepared-offer/' + offer.id, undefined, manager)
  assert.equal((await release()).status, 409, 'unapproved release refused')
  await cmd('request-offer-approval', { id: offer.id, approver: 'exception@example.test' }, manager, 409)
  async function approveOffer(cookie) {
   const asked = await cmd('request-offer-approval', { id: offer.id }, manager)
   await cmd('decide-approval', { id: asked.id, version: asked.version, decision: 'approved', reason: 'Exact document and compensation reviewed' }, cookie)
   return asked
  }
  const firstApproval = await approveOffer(normal)
  const file = await release()
  assert.equal(file.status, 200); assert.match(file.text, /PREPARED, UNSENT/)
  assert.equal(createHash('sha256').update(file.text).digest('hex'), offer.document.sha256, 'released bytes are exactly the approved document')
  const packet = await h.send('/api/lodge/download/packet/' + offer.id, undefined, normal)
  assert.equal(packet.status, 200)
  assert.equal(packet.value.offer.document.sha256, firstDocument.sha256)
  assert.equal(packet.value.approval.version, firstApproval.version)
  await cmd('offer-template', { id: salaried.id, name: salaried.name, body: templateBody + '\nNew employer-reviewed wording.', reviewed: true })
  assert.deepEqual((await h.state(manager)).offers.find(o => o.id === offer.id).document, firstDocument, 'template edits leave existing document unchanged')
  offer = await cmd('offer', { ...input, id: offer.id, salary: { ...input.salary, amount: 12000000 }, bonus: 300000 }, manager)
  assert.notEqual(offer.document.sha256, firstDocument.sha256)
  assert.ok(offer.document.text.includes('USD 120000.00 per year') && offer.document.text.includes('USD 3000.00'))
  assert.equal((await release()).status, 409, 'material compensation changes refuse stale release')
  await cmd('offer-signed-outside', { id: offer.id, attest: true, method: 'paper', name: 'signed.txt', mediaType: 'text/plain', base64: Buffer.from(firstDocument.text).toString('base64') }, manager, 409)
  await cmd('request-offer-approval', { id: offer.id, approver: 'normal@example.test' }, manager, 409)
  const exceptionApproval = await approveOffer(exception)
  assert.equal(exceptionApproval.approver, 'exception@example.test')
  const updatedPacket = await h.send('/api/lodge/download/packet/' + offer.id, undefined, exception)
  assert.equal(updatedPacket.value.offer.document.sha256, offer.document.sha256)
  assert.ok(updatedPacket.value.rangeWarning)
  assert.equal((await release()).status, 200)
  await cmd('offer-signed-outside', { id: offer.id, attest: true, method: 'paper', name: 'signed-offer.txt', mediaType: 'text/plain', base64: Buffer.from('Employer-attested signed copy of revised terms').toString('base64') }, manager)
  const signed = (await h.state(manager)).offers.find(o => o.id === offer.id)
  assert.equal(signed.signature.termsVersion, exceptionApproval.version)
  await cmd('offer', { ...input, id: offer.id }, manager, 409, 'accepted signed offer cannot be edited')
  const wageJob = await open('Warehouse lead', 'hour', 2200, 3000)
  await cmd('job-offer-template', { id: wageJob.id, offerTemplate: { id: hourly.id, version: 1 } }, manager)
  const setup = await cmd('job-template', { name: 'Warehouse setup with hourly offer', fromVacancy: wageJob.id })
  const fromTemplate = await cmd('vacancy-from-template', { template: setup.id, title: 'Warehouse lead — Queens', location: 'Queens, NY', headcount: 1, manager: 'preparer@example.test', compensation: wageJob.compensation }, manager)
  const cloned = await cmd('clone-vacancy', { id: wageJob.id, title: 'Warehouse lead — Bronx' }, manager)
  for (const [i, next] of [fromTemplate, cloned].entries()) {
   assert.deepEqual(next.offerTemplate, { id: hourly.id, version: 1 })
   await publish(next)
   const live = (await h.state(manager)).vacancies.find(v => v.id === next.id)
   const app = await applicant(live, ['Alex Monroe', 'Casey Vale'][i])
   const hourlyOffer = await cmd('offer', { application: app.id, title: live.title, startDate: '2026-12-07', terms: 'Forty scheduled hours.', salary: { currency: 'USD', amount: 2500, period: 'hour' }, opening: live.openings[0].id, equity: 'No equity granted' }, manager)
   assert.equal(hourlyOffer.document.template.id, hourly.id)
   assert.ok(hourlyOffer.document.text.includes('USD 25.00 per hour') && hourlyOffer.document.text.includes('USD 0.00'))
  }
  assert.equal((await h.send('/api/lodge/download/prepared-offer/' + offer.id)).status, 401)
  assert.equal((await h.send('/api/lodge/download/prepared-offer/' + offer.id, undefined, normal)).status, 404, 'an approver can read the packet but cannot release as a hiring manager')
  const reviewer = await h.member('reviewer@example.test', ['interviewer'], 'Independent reviewer')
  await cmd('assign-reviewers', { application: application.id, reviewers: ['reviewer@example.test'] }, manager)
  assert.equal((await h.send('/api/lodge/download/prepared-offer/' + offer.id, undefined, reviewer)).status, 404)
  assert.ok(!JSON.stringify(await h.state(reviewer)).includes('PREPARED, UNSENT'), 'reviewer scope does not expose offer documents')
  const ownerApp = await applicant(job, 'Jamie Crane')
  const ownerDraft = await cmd('offer', { ...input, application: ownerApp.id, opening: job.openings[1].id }, h.owner)
  const independentRequest = await cmd('request-offer-approval', { id: ownerDraft.id }, h.owner)
  await cmd('decide-approval', { id: independentRequest.id, decision: 'approved', version: independentRequest.version, reason: 'Attempted self-approval' }, h.owner, 403)
  const events = await h.send('/api/lodge/audit', undefined, h.owner)
  assert.equal(events.status, 200)
  assert.ok(JSON.stringify(events.value).includes('unsent-offer-document-downloaded'))
  assert.equal((await h.state(manager)).offers.filter(o => o.document).length, 4)
 } finally { await h.close() }
}
