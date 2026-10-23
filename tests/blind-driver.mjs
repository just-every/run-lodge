// Shared HTTP and browser driver; each public-door journey retains its own assertions.
import assert from "node:assert/strict"
import { businessHarness } from "./harness.mjs"
import { blindRules } from "./blind-rules.mjs"
import { transactions } from "./record-transactions.mjs"
import { browserWidths } from "./browser-widths.mjs"
import { join } from "node:path"
import { current, session } from "./browser-journey.mjs"

/** REVIEW-002: every existing public read door and every application exit path. */
export async function checkBlindReview(t) {
 const h = await businessHarness(); t.after(() => h.close())
 const { command: cmd, state, send } = h

 const manager = await h.member('blind.manager@example.test', ['manager'])
 const reviewer = await h.member('blind.reviewer@example.test', ['interviewer'])
 const admin = await h.member('blind.admin@example.test', ['admin'])
 const recruiter = await h.member('blind.recruiter@example.test', ['manager'])
 const agent = await h.member('blind.agent@example.test', ['manager'], 'Review agent', { agent: true, actsFor: 'blind.manager@example.test' })
 const job = async (title, question) => {
  const v = await cmd('vacancy', { title, headcount: 1, location: 'New York, NY', manager: 'blind.manager@example.test', compensation: { currency: 'USD', min: 5000000, max: 7000000, period: 'year' } })
  await cmd('rubric', { id: v.id, criteria: [{ name: 'Inventory', description: 'Inventory evidence' }] })
  await cmd('interview-plan', { id: v.id, plan: [{ name: 'Interview', stageName: 'Interview' }] })
  if (question) await cmd('job-questions', { id: v.id, questions: [{ question: question.id, required: false }] })
  const asked = await cmd('request-vacancy-approval', { id: v.id, approver: 'owner@example.test' })
  await cmd('decide-approval', { id: asked.id, version: asked.version, decision: 'approved', reason: 'Budgeted' })
  return cmd('publish', { id: v.id })
 }
 const v = await job('Blind warehouse lead'), other = await job('Other warehouse lead')
 await cmd('hiring-team', { id: v.id, recruiters: ['blind.recruiter@example.test'] })
 const school = 'North College', year = '2020', name = 'Jules Carter', email = 'jules.blind@example.test', phone = '+1 (212) 555-0147', address = '55 Pine Street'
 const sourceText = `${name}\n${email}\n${phone}\n${address}\n${school}, ${year}\nInventory planning and forklift inspections`
 const first = await cmd('candidate', { name, email, phone, location: address, vacancy: v.id, source: 'Careers', consentBasis: 'application', resume: { name: 'Jules Carter.txt', mediaType: 'text/plain', base64: Buffer.from(sourceText).toString('base64') } })
 const intake = await cmd('resume-upload', { vacancy: v.id, file: { name: 'parsed.txt', mediaType: 'text/plain', base64: Buffer.from(sourceText.replace(name, 'Julian Carter').replace(email, 'julian.old@example.test')).toString('base64') } })
 const corrected = await cmd('resume-preview', { id: intake.id, name, email, phone, location: address, source: 'Reviewed resume', consentBasis: 'application', education: school + ' ' + year })
 await cmd('resume-commit', { id: intake.id, token: corrected.token, confirmed: true, duplicates: corrected.duplicates.map(d => ({ candidate: d.candidate, decision: 'existing', reason: 'Confirmed same person' })) })
 const image = await cmd('document', { application: first.application.id, name: 'candidate-photo.png', kind: 'portfolio', mediaType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' })
 const second = await cmd('candidate', { name: 'Taylor Rowan', email: 'taylor.blind@example.test', vacancy: v.id, source: 'Careers', consentBasis: 'application' })
 await cmd('apply', { candidate: first.candidate.id, vacancy: other.id, source: 'Other job' })
 for (const app of [first.application, second.application]) await cmd('assign-reviewers', { application: app.id, reviewers: ['blind.reviewer@example.test'] })
 await cmd('blind-identity', { application: first.application.id, schools: [school], years: [year] }, manager)
 const event = await cmd('event', { name: 'Blind review hiring fair', kind: 'career-fair', date: '2026-11-01', location: 'New York, NY', owner: 'blind.manager@example.test', jobs: [v.id] })
 const capture = await cmd('event-capture', { event: event.id, captureId: crypto.randomUUID(), name: 'Event Candidate', email: 'event.blind@example.test', noticeVersion: 1, noticeShown: true, consentToContact: true })
 const eventApp = await cmd('event-apply', { event: event.id, candidate: capture.candidate, vacancy: v.id })
 const oldPacket = await cmd('propose', { workflow: 'coordination', summary: name, approver: 'blind.manager@example.test', sources: [{ kind: 'application', id: first.application.id }], changes: [{ op: 'message', input: { application: first.application.id, purpose: 'other', subject: 'Interview', body: name } }] })
 await cmd('blind-review', { id: v.id, enabled: true, stages: [v.stages[0].id], revealStage: v.stages[2].id }, manager)
 assert.ok(!(await state(manager)).events.find(e => e.id === event.id).pool.some(c => c.applications.some(a => a.id === eventApp.id)), 'event pools cannot join blind applications to full people')
 assert.ok(!(await state(manager)).proposals.some(p => p.id === oldPacket.id), 'old full-record packet hides on blinding')
 const packet = await cmd('propose', { workflow: 'coordination', summary: 'Schedule a discussion', approver: 'blind.manager@example.test', sources: [{ kind: 'application', id: first.application.id }, { kind: 'candidate', id: 'blind:' + first.application.id }], changes: [{ op: 'interview', input: { application: first.application.id, planItem: v.plan[0].id, participants: ['blind.reviewer@example.test'], slots: ['2026-12-03T15:00:00Z'] } }] }, agent)
 assert.ok((await state(manager)).proposals.some(p => p.id === packet.id), 'new blind proposal remains usable')
 assert.ok(!JSON.stringify(packet).includes(first.candidate.id), 'blind proposal sources cannot join the shared candidate')
 const pendingOwn = await cmd('resume-upload', { vacancy: v.id, file: { name: 'new-intake.txt', mediaType: 'text/plain', base64: Buffer.from('New Prospect\nprospect@example.test').toString('base64') } }, manager)
 assert.ok((await state(manager)).resumeIntakes.some(r => r.id === pendingOwn.id), 'unlinked intake retains uploader rights')
 const addedBlind = await cmd('candidate', { name: 'New Blind Person', email: 'new.blind@example.test', vacancy: v.id, source: 'Careers', consentBasis: 'application' }, manager)
 assert.equal(addedBlind.candidate.id, addedBlind.application.candidate)
 assert.ok(addedBlind.candidate.id.startsWith('blind:'), 'command responses also use application aliases')
 const shared = await cmd('document', { candidate: first.candidate.id, kind: 'resume', name: 'shared-original.txt', mediaType: 'text/plain', base64: Buffer.from(sourceText).toString('base64') })
 assert.equal((await send('/api/lodge/download/document/' + shared.id, undefined, manager)).status, 200, 'a separate full job retains its candidate-level original')
 assert.equal((await send('/api/lodge/download/document/' + shared.id, undefined, reviewer)).status, 404, 'blind-only review cannot read the shared original')
 const doc = (await state()).documents.find(d => d.application === first.application.id)
 const hidden = [name, email, phone, address, school, year, 'Julian Carter', 'julian.old@example.test']
 for (const cookie of [manager, reviewer, agent]) {
  const w = await state(cookie), app = w.applications.find(a => a.id === first.application.id), c = w.candidates.find(c => c.id === app.candidate)
  assert.equal(app.blind, true); assert.equal(c.name, app.candidateName); assert.notEqual(app.candidate, first.candidate.id)
  assert.notEqual(w.applications.find(a => a.id === second.application.id).candidateName, app.candidateName)
  assert.ok(app.resumeText.includes('Inventory planning'))
  for (const value of hidden) assert.deepEqual(identityHits({ app, c }, value), [], `profile hides ${value}`)
  assert.equal(app.earlier.length, 0)
  for (const path of ['download/document/', 'view/document/']) assert.equal((await send('/api/lodge/' + path + doc.id, undefined, cookie)).status, 404)
  assert.ok(!w.documents.some(d => d.id === image.id), 'photos are absent from blind context')
  assert.equal((await send('/api/lodge/download/document/' + image.id, undefined, cookie)).status, 404)
  assert.equal((await send('/api/lodge/download/resume-intake/' + intake.id, undefined, cookie)).status, 404)
  const queue = w.reviewQueues.find(q => q.vacancy === v.id)
  assert.ok(queue.queue.includes(app.id))
  const visible = await send('/api/lodge/search?q=Inventory', undefined, cookie)
  assert.ok(visible.value.results.some(r => r.id === c.id))
  if (cookie !== reviewer) {
   const exported = await send('/api/lodge/download/vacancy/' + v.id, undefined, cookie)
   assert.equal(exported.status, 200)
   for (const value of hidden) assert.deepEqual(identityHits(exported.value, value), [], `export hides ${value}`)
   assert.ok(!exported.text.includes(first.candidate.id), 'no shared-person join in blind export')
  }
 }
 for (const cookie of [h.owner, admin, recruiter]) {
  const w = await state(cookie), app = w.applications.find(a => a.id === first.application.id)
  assert.equal(app.blind, false); assert.equal(app.candidateName, name)
  assert.equal((await send('/api/lodge/download/document/' + doc.id, undefined, cookie)).status, 200)
 }
 // Read a blind-only reviewer search: no hidden identity can be discovered by querying it.
 for (const q of [name, email, school, year]) assert.equal((await send('/api/lodge/search?q=' + encodeURIComponent(q), undefined, reviewer)).value.results.length, 0)
 // A concurrent new blind application must invalidate a settings reveal prepared without it.
 const tx = await transactions(h)
 try {
  const pending = await tx.prepare('blind-review', { id: v.id, enabled: false }, 'blind.manager@example.test')
  await cmd('candidate', { name: 'Concurrent Candidate', vacancy: v.id, source: 'Careers', consentBasis: 'application' })
  await tx.refuse(pending)
 } finally { await tx.close() }
 const code = (await state(manager)).applications.find(a => a.id === first.application.id).candidateName
 const logs = async id => (await state()).audit.filter(e => e.action === 'blind-review-revealed' && e.record === 'application:' + id)
 const checkExit = async (op, body) => {
  const before = (await logs(first.application.id)).length
  await cmd(op, { application: first.application.id, reason: 'Reviewed evidence', ...body }, manager)
  assert.equal((await logs(first.application.id)).length, before + 1, op + ' logs reveal')
 }
 await checkExit('review-decision', { decision: 'advance' })
 await cmd('move', { application: first.application.id, to: v.stages[0].id, reason: 'Second blind pass' }, manager)
 let app = (await state(manager)).applications.find(a => a.id === first.application.id)
 assert.equal(app.blind, true); assert.equal(app.candidateName, code); assert.equal(app.reveals.length, 1)
 await checkExit('move', { to: v.stages[2].id })
 await cmd('move', { application: first.application.id, to: v.stages[0].id, reason: 'Return' }, manager)
 await checkExit('mark-spam', {})
 await cmd('unmark-spam', { application: first.application.id, reason: 'Human application' }, manager)
 assert.equal((await state(manager)).applications.find(a => a.id === first.application.id).blind, true)
 await checkExit('move', { to: 'withdrawn', closeReason: 'other-offer' })
 await cmd('reopen', { application: first.application.id, to: v.stages[0].id, reason: 'Candidate returned' }, manager)
 await checkExit('move', { to: 'rejected', closeReason: 'skills', send: 'none' })
 await cmd('reopen', { application: first.application.id, to: v.stages[0].id, reason: 'Reconsidered' }, manager)
 // Settings leaving blind scope are also recorded, not a silent identity reveal.
 let before = (await logs(first.application.id)).length
 await cmd('blind-review', { id: v.id, enabled: false }, manager)
 assert.equal((await logs(first.application.id)).length, before + 1)
 await cmd('blind-review', { id: v.id, enabled: true, stages: [v.stages[0].id], revealStage: v.stages[2].id }, manager)
 assert.equal((await state(manager)).applications.find(a => a.id === first.application.id).candidateName, code)
 // Bulk preview is a public read too, and its apply exits through the same fenced save.
 const preview = await cmd('bulk-preview', { items: [first.application.id], action: { kind: 'move', stage: v.stages[2].name, reason: 'Interview evidence' } }, manager)
 assert.equal(preview.items[0].candidateName, code)
 before = (await logs(first.application.id)).length
 await cmd('bulk-apply', { batch: crypto.randomUUID(), items: [first.application.id], action: preview.action, previewed: { [first.application.id]: preview.items[0].seen } }, manager)
 assert.equal((await logs(first.application.id)).length, before + 1)
 await cmd('move', { application: first.application.id, to: v.stages[0].id, reason: 'Return for hire test' }, manager)
 const offer = await cmd('offer', { application: first.application.id, title: 'Warehouse lead', opening: (await state()).vacancies.find(x => x.id === v.id).openings[0].id, salary: { currency: 'USD', amount: 6000000, period: 'year' }, startDate: '2026-12-01' }, manager)
 const approval = await cmd('request-offer-approval', { id: offer.id, approver: 'owner@example.test' }, manager)
 await cmd('decide-approval', { id: approval.id, version: approval.version, decision: 'approved', reason: 'Approved terms' })
 before = (await logs(first.application.id)).length
 await cmd('offer-outcome', { id: offer.id, outcome: 'accepted', reason: 'Candidate accepted' }, manager)
 assert.equal((await logs(first.application.id)).length, before + 1, 'hire logs reveal')
 // Another candidate transfers out: its stable code cannot join the target's full profile.
 before = (await logs(second.application.id)).length
 await cmd('transfer', { application: second.application.id, vacancy: other.id, reason: 'Different opening' }, manager)
 assert.equal((await logs(second.application.id)).length, before + 1, 'transfer logs reveal')
 // Identity configuration follows the candidate export and erasure lifecycle.
 const exported = await send('/api/lodge/download/candidate/' + first.candidate.id, undefined, h.owner)
 assert.equal(exported.status, 200)
 assert.ok(exported.value['blind-identity'].some(r => r.schools.includes(school)))
 await blindRules(h, job)
}


// A graduation year must disappear from identity facts and passages. A coincidental
// substring of an opaque UUID or SHA-256 is not a year; join IDs are checked separately.
function identityHits(value, needle, path = '') {
 if (typeof value === 'number') return String(value) === needle ? [path] : []
 if (typeof value === 'string') {
  const opaque = /^(?:(?:[a-z-]+:|Application )?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{64})$/i.test(value)
  return value.includes(needle) && !( /^\d{4}$/.test(needle) && opaque ) ? [path] : []
 }
 if (!value || typeof value !== 'object') return []
 return Object.entries(value).flatMap(([key, item]) => identityHits(item, needle, path + '/' + key))
}

/** REVIEW-002: manager configures, reviews, reveals, then returns to blind at both widths. */
export async function blindPage(browser, { root, origin, run, evidence, ownerEmail }) {
 for (const width of browserWidths) {
  const v = await run('vacancy', { title: 'Blind inventory lead ' + width, headcount: 2, location: 'Brooklyn, NY', manager: 'manager@dev.localhost', compensation: { currency: 'USD', min: 5000000, max: 7000000, period: 'year' } })
  await run('rubric', { id: v.id, criteria: [{ name: 'Stock control', description: 'A stock control example' }] })
  await run('interview-plan', { id: v.id, plan: [{ name: 'Inventory discussion', stageName: 'Interview' }] })
  const request = await run('request-vacancy-approval', { id: v.id, approver: ownerEmail })
  await run('decide-approval', { id: request.id, version: request.version, decision: 'approved', reason: 'Budgeted opening' })
  await run('publish', { id: v.id })
  const name = 'Robin Carter ' + width, school = 'North College', year = '2020'
  const source = `${name}\nrobin${width}@example.test\n+1 (212) 555-0147\n55 Pine Street\nNorth College, 2020\nInventory planning and forklift inspections`
  const added = await run('candidate', { name, email: `robin${width}@example.test`, phone: '+1 (212) 555-0147', location: '55 Pine Street', source: 'Careers', consentBasis: 'application', vacancy: v.id, resume: { name: 'Robin Carter resume.txt', mediaType: 'text/plain', base64: Buffer.from(source).toString('base64') } })
  await run('candidate', { name: 'Taylor Rowan ' + width, email: `taylor${width}@example.test`, source: 'Careers', consentBasis: 'application', vacancy: v.id })
  const s = await session(browser, root, origin, 'manager', width)
  try {
   const { page, context } = s, errors = []
   page.on('pageerror', e => errors.push(e.message))
   await page.goto(origin + '/app?application=' + added.application.id)
   const values = page.getByRole('region', { name: 'Blind identity values', exact: true })
   await values.locator('summary').click()
   await values.getByLabel('Schools to redact (one per line)').fill(school)
   await values.getByLabel('Graduation years to redact (one per line)').fill(year)
   await values.getByRole('button', { name: 'Save identity redactions', exact: true }).click()
   await page.getByText('Saved.', { exact: true }).waitFor()
   const settings = page.getByRole('region', { name: 'Blind review settings', exact: true })
   await settings.locator('summary').click()
   await settings.getByLabel('Enable blind review', { exact: true }).check()
   await settings.getByRole('group', { name: 'Blind stages' }).getByLabel(v.stages[0].name, { exact: true }).check()
   await settings.getByRole('combobox', { name: /^Reveal stage/ }).selectOption(v.stages[2].id)
   await settings.getByRole('button', { name: 'Save blind review', exact: true }).click()
   await page.getByRole('heading', { name: 'Redacted resume', exact: true }).first().waitFor()
   const w = await current(context, origin), app = w.applications.find(a => a.id === added.application.id), code = app.candidateName
   assert.equal(app.blind, true)
   const queue = page.getByRole('region', { name: 'Review queue', exact: true })
   const panel = page.getByRole('region', { name: 'Application of ' + code, exact: true })
   for (const surface of [queue, panel]) {
    const contents = await surface.innerText()
    for (const hidden of [name, `robin${width}@example.test`, '555-0147', '55 Pine Street', school, year]) assert.ok(!contents.includes(hidden), 'blind text excludes ' + hidden)
    assert.ok(contents.includes('Inventory planning'))
   }
   const fits = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'REVIEW-002 fits viewport')
   await fits(); await page.screenshot({ path: join(evidence, `REVIEW-002-profile-${width}.png`), fullPage: true })
   await panel.getByRole('tab', { name: 'Documents', exact: true }).click()
   await panel.getByRole('region', { name: 'Blind review resume' }).waitFor()
   assert.equal(await panel.getByRole('link', { name: /Download/ }).count(), 0)
   await fits(); await page.screenshot({ path: join(evidence, `REVIEW-002-documents-${width}.png`), fullPage: true })
   await panel.getByRole('tab', { name: 'Overview', exact: true }).click()
   await queue.getByLabel('Why they move on (optional)').fill('Inventory experience merits a discussion')
   await queue.getByRole('button', { name: 'Advance to ' + v.stages[2].name, exact: true }).click()
   await page.getByRole('region', { name: 'Application of ' + name, exact: true }).waitFor()
   await page.getByRole('region', { name: 'Identity reveal history' }).waitFor()
   await fits(); await page.screenshot({ path: join(evidence, `REVIEW-002-revealed-${width}.png`), fullPage: true })
   const revealed = page.getByRole('region', { name: 'Application of ' + name, exact: true })
   await revealed.getByText('Other moves', { exact: true }).click()
   const move = revealed.locator('form').filter({ has: page.getByRole('button', { name: 'Move', exact: true }) })
   await move.getByRole('combobox', { name: /^Move to/ }).selectOption(v.stages[0].id)
   await move.getByLabel('Reason (kept in the history)', { exact: true }).fill('Fresh blind review')
   await move.getByRole('button', { name: 'Move', exact: true }).click()
   await page.getByRole('region', { name: 'Application of ' + code, exact: true }).waitFor()
   await page.getByRole('region', { name: 'Identity reveal history' }).waitFor()
   assert.equal((await current(context, origin)).applications.find(a => a.id === added.application.id).reveals.length, 1)
   await fits(); await page.screenshot({ path: join(evidence, `REVIEW-002-reblinded-${width}.png`), fullPage: true })
   assert.deepEqual(errors, [])
  } catch (error) {
   await s.page.screenshot({ path: join(evidence, `REVIEW-002-failure-${width}.png`), fullPage: true })
   throw error
  } finally { await s.context.close() }
 }
}
