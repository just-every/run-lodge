// Shared HTTP and browser driver; each public-door journey retains its own assertions.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { BUSINESS, harness } from "./harness.mjs"
import { browserWidths } from "./browser-widths.mjs"
import { join } from "node:path"
import { api, current, session } from "./browser-journey.mjs"

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

// OFFER-001 through the employer template, job setup, draft, approval and release doors.




export async function offersPage(browser, { root, origin, run, evidence, ownerEmail }) {
 await run('member', { email: 'approver@dev.localhost', name: 'Parker Approver', roles: ['approver'] })
 const round = crypto.randomUUID().slice(0, 4).toUpperCase()
 for (const width of browserWidths) {
  const place = width === 1440 ? 'Brooklyn' : 'Queens', personName = width === 1440 ? 'Jordan Ellery' : 'Samira Cole'
  const templateName = `US salaried offer — ${place} ${round}`
  const owner = await session(browser, root, origin, 'owner', width)
  let manager, approver
  try {
   const page = owner.page, errors = []; page.on('pageerror', e => errors.push(e.message))
   await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Vacancies', exact: true }).click()
   const library = page.getByRole('region', { name: 'Offer templates', exact: true })
   await library.getByText('New offer template', { exact: true }).click()
   const create = library.locator('details').filter({ has: page.getByText('New offer template', { exact: true }) })
   await create.getByLabel('Offer template name').fill(templateName)
   await create.getByLabel('Document template').fill('Dear {{candidateName}},\nWe offer {{title}} at {{location}}, {{employmentType}}, from {{startDate}}.\nPay {{pay}}. Bonus {{bonus}}. Equity {{equity}}.\n{{contingencies}}\n{{terms}}')
   await create.getByLabel('Employer-reviewed contingencies').fill('Subject to the employer-reviewed work authorization requirements.')
   await create.getByLabel('Normal offer approver').selectOption('approver@dev.localhost')
   await create.getByLabel('Compensation exception approver').selectOption(ownerEmail)
   await create.getByLabel('I confirm the employer has reviewed').check()
   await create.getByRole('button', { name: 'Create reviewed offer template' }).click()
   await library.getByText(`${templateName} · version 1`, { exact: true }).waitFor()
   await library.getByText(`${templateName} · version 1`, { exact: true }).click()
   await page.screenshot({ path: join(evidence, `OFFER-001-templates-${width}.png`), fullPage: true })
   assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
   const w = await current(owner.context, origin), template = w.offerTemplates.find(t => t.name === templateName)
   const job = await run('vacancy', { title: `Facilities supervisor — ${place} (${round})`, location: 'Brooklyn, NY', manager: 'manager@dev.localhost', headcount: 1, compensation: { currency: 'USD', min: 6500000, max: 8500000, period: 'year' } })
   await run('rubric', { id: job.id, criteria: [{ name: 'Safety', description: 'Explains safe site operations' }] })
   await run('interview-plan', { id: job.id, plan: [{ name: 'Work review', stageName: 'Interview' }] })
   const asked = await run('request-vacancy-approval', { id: job.id, approver: ownerEmail })
   await run('decide-approval', { id: asked.id, decision: 'approved', version: asked.version, reason: 'Budget approved' })
   await run('publish', { id: job.id })
   const added = await run('candidate', { name: personName, email: `jordan.ellery.${width}@example.test`, source: 'Referral', consentBasis: 'referral', consentNote: 'Agreed to apply', vacancy: job.id })
   await page.reload()
   await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Vacancies', exact: true }).click()
   await page.getByRole('button', { name: 'Open ' + job.title, exact: true }).click()
   await page.getByText('Offer document default', { exact: true }).click()
   await page.getByLabel('Reviewed offer template for this job').selectOption(`${template.id}@1`)
   await page.getByRole('button', { name: 'Save offer document default' }).click()
   await page.getByText('Saved.', { exact: true }).waitFor()
   await page.screenshot({ path: join(evidence, `OFFER-001-job-default-${width}.png`), fullPage: true })
   const setup = await run('job-template', { name: `Facilities setup — ${place} ${round}`, fromVacancy: job.id })
   await page.reload()
   await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Vacancies', exact: true }).click()
   await page.getByText('Edit ' + setup.name, { exact: true }).click()
   const setupForm = page.getByRole('region', { name: 'Job templates', exact: true }).locator('details').filter({ has: page.getByText('Edit ' + setup.name, { exact: true }) })
   assert.equal(await setupForm.getByLabel('Reviewed offer template in this setup').inputValue(), `${template.id}@1`)
   await page.screenshot({ path: join(evidence, `OFFER-001-job-template-${width}.png`), fullPage: true })
   manager = await session(browser, root, origin, 'manager', width)
   const appPage = manager.page
   await appPage.goto(origin + '/app?application=' + added.application.id)
   await appPage.getByRole('tab', { name: 'Decisions', exact: true }).click()
   await appPage.getByText('Prepare an offer', { exact: true }).click()
   const panel = appPage.getByRole('region', { name: 'Application of ' + personName })
   await panel.getByLabel('Start date', { exact: true }).fill('2026-12-07')
   await panel.getByLabel('Pay', { exact: true }).fill('75000')
   await panel.getByLabel('Other terms', { exact: true }).fill('Forty hours a week.')
   await panel.getByLabel('Bonus (USD)').fill('2000')
   await panel.getByLabel('Equity terms').fill('No equity granted')
   await panel.getByRole('button', { name: 'Save offer', exact: true }).click()
   const document = panel.getByRole('region', { name: 'Prepared offer document' })
   await document.getByRole('heading', { name: templateName + ' · version 1', exact: true }).waitFor()
   assert.ok((await document.locator('pre').textContent()).includes('USD 75000.00 per year'))
   await panel.getByRole('button', { name: 'Request document approval' }).click()
   approver = await session(browser, root, origin, 'approver', width)
   let offer = (await current(manager.context, origin)).offers.find(o => o.application === added.application.id)
   await api(approver.context, origin, 'decide-approval', { id: offer.approval.id, decision: 'approved', version: offer.approval.version, reason: 'Reviewed exact document' })
   await appPage.goto(origin + '/app?application=' + added.application.id)
   await appPage.getByRole('tab', { name: 'Decisions', exact: true }).click()
   const prepared = appPage.getByRole('region', { name: 'Prepared offer document' })
   await prepared.getByRole('link', { name: 'Download approved document (unsent)' }).waitFor()
   await appPage.screenshot({ path: join(evidence, `OFFER-001-approved-${width}.png`), fullPage: true })
   assert.ok(await appPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
   await prepared.getByText('Revise prepared offer (needs approval again)', { exact: true }).click()
   await prepared.getByLabel('Pay', { exact: true }).fill('95000')
   await prepared.getByRole('button', { name: 'Regenerate offer document' }).click()
   await prepared.locator('pre').filter({ hasText: 'USD 95000.00 per year' }).waitFor()
   assert.equal(await prepared.getByRole('link', { name: 'Download approved document (unsent)' }).count(), 0)
   assert.equal((await manager.context.request.get(origin + '/api/lodge/download/prepared-offer/' + offer.id)).status(), 409)
   await appPage.screenshot({ path: join(evidence, `OFFER-001-reapproval-${width}.png`), fullPage: true })
   assert.deepEqual(errors, [])
  } finally { await approver?.context.close(); await manager?.context.close(); await owner.context.close() }
 }
}
