// Shared HTTP and browser driver; each public-door journey retains its own assertions.
import assert from "node:assert/strict"
import { BUSINESS, harness } from "./harness.mjs"
import { join } from "node:path"
import { api, current, session } from "./browser-journey.mjs"

/** Lifecycle checks remain in DATA-002's existing public HTTP/cron journey. D1 only ages the clock fixture. */
export async function checkResumeLifecycle() {
 const h = await harness()
 try {
  await h.command('business', BUSINESS)
  await exerciseResumeLifecycle(h)
 } finally { await h.close() }
}

async function exerciseResumeLifecycle(h) {
 const cmd = h.command, send = h.send
 const recruiter = await h.member('resume-recruiter@example.test', ['manager'], 'Resume Recruiter')
 const admin = await h.member('resume-admin@example.test', ['admin'], 'Resume Admin')
 const job = await cmd('vacancy', { title: 'Resume lifecycle role', location: 'New York', headcount: 1, manager: 'resume-recruiter@example.test' })
 const file = { name: 'private-pending.txt', mediaType: 'text/plain', base64: Buffer.from('Private Pending\nprivate.pending@example.test\nSkills\nLogistics').toString('base64') }
 const fields = { name: 'Private Pending', email: 'private.pending@example.test', source: 'Submitted resume', consentBasis: 'application' }
 const original = 'Committed Lifecycle Person\ncommitted.lifecycle@example.test\nSkills\nStock control'
 const saved = await cmd('resume-upload', { file: { name: 'committed-lifecycle.txt', mediaType: 'text/plain', base64: Buffer.from(original).toString('base64') } })
 const reviewed = await cmd('resume-preview', { id: saved.id, name: 'Committed Lifecycle Person', email: 'committed.lifecycle@example.test', source: 'Submitted resume', consentBasis: 'application' })
 await cmd('resume-commit', { id: saved.id, token: reviewed.token, confirmed: true, duplicates: [] })
 const initial = await h.state(), baseCount = initial.orphanedResumeIntakeCount
 const defaultRetentionDays = initial.resumeIntakePolicy.retentionDays
 await cmd('hiring-team', { id: job.id, recruiters: ['resume-recruiter@example.test'], coordinators: [], hiringManagers: [], sourcers: [], interviewers: [] })
 const row = await cmd('resume-upload', { file, vacancy: job.id }, recruiter)
 assert.equal(Date.parse(row.expiresAt) - Date.parse(row.uploadedAt), defaultRetentionDays * 86400000)
 assert.ok(Date.parse(row.expiresAt) > Date.now(), 'a new pending original has a valid future deadline')
 assert.equal((await h.state(recruiter)).resumeIntakes.find(r => r.id === row.id).expiresAt, row.expiresAt)
 assert.equal((await h.state(recruiter)).orphanedResumeIntakeCount, undefined, 'only admins receive the orphan count')
 const preview = await cmd('resume-preview', { id: row.id, ...fields }, recruiter)
 assert.equal((await h.state(admin)).orphanedResumeIntakeCount, baseCount)
 const noContact = await cmd('permission-level', { name: 'Resume intake without contact', permissions: ['settings'] })
 await cmd('job-levels', { id: job.id, members: { 'resume-recruiter@example.test': noContact.id }, roles: {} })
 for (const who of [h.owner, admin, recruiter]) {
  assert.ok(!(await h.state(who)).resumeIntakes.some(r => r.id === row.id))
  assert.equal((await send('/api/lodge/download/resume-intake/' + row.id, undefined, who)).status, 404)
  for (const [op, body] of [['resume-preview', fields], ['resume-commit', { token: preview.token, confirmed: true, duplicates: [] }]])
   assert.equal((await send('/api/lodge/command/' + op, { id: row.id, ...body }, who)).status, 404)
 }
 assert.equal((await h.state(admin)).orphanedResumeIntakeCount, baseCount + 1)
 assert.equal((await send('/api/lodge/command/resume-discard-orphaned', {}, recruiter)).status, 403)
 // An admin's old count grants no authority over a now-authorized uploader's original.
 await cmd('job-levels', { id: job.id, members: {}, roles: {} })
 assert.deepEqual(await cmd('resume-discard-orphaned', {}, admin), { discarded: baseCount })
 assert.equal((await send('/api/lodge/download/resume-intake/' + row.id, undefined, recruiter)).status, 200)
 await cmd('member', { email: 'resume-recruiter@example.test', name: 'Resume Recruiter', roles: ['manager'], active: false })
 assert.equal((await h.state(admin)).orphanedResumeIntakeCount, 1, 'a departed member leaves only a count')
 const before = (await h.state()).candidates.length
 assert.deepEqual(await cmd('resume-discard-orphaned', {}, admin), { discarded: 1 })
 assert.equal((await h.state()).candidates.length, before, 'discard never creates or commits a person')
 assert.equal(await h.db.prepare("SELECT id FROM l_records WHERE kind='blob' AND id=?").bind(row.id).first(), null)
 assert.equal((await h.state()).orphanedResumeIntakeCount, 0)

 // Configure through the same command the existing intake panel uses. Saved deadlines are immutable.
 assert.equal((await send('/api/lodge/command/resume-intake-settings', { retentionDays: 4 }, recruiter)).status, 403)
 await cmd('resume-intake-settings', { retentionDays: 7 }, admin)
 const active = await cmd('resume-upload', { file })
 assert.equal(Date.parse(active.expiresAt) - Date.parse(active.uploadedAt), 7 * 86400000)
 await cmd('resume-intake-settings', { retentionDays: 2 })
 assert.equal((await h.state()).resumeIntakes.find(r => r.id === active.id).expiresAt, active.expiresAt)
 const due = await cmd('resume-upload', { file: { ...file, name: 'expired-pending.txt' } })
 assert.equal(Date.parse(due.expiresAt) - Date.parse(due.uploadedAt), 2 * 86400000)
 const duePreview = await cmd('resume-preview', { id: due.id, ...fields })
 const past = new Date(Date.now() - 1000).toISOString()
 const legacy = await cmd('resume-upload', { file: { ...file, name: 'legacy-pending.txt' } })
 await h.db.prepare("UPDATE l_records SET revision=?,value=json_remove(json_set(value,'$.uploadedAt',?),'$.expiresAt') WHERE kind='resume-intake' AND id=?").bind(crypto.randomUUID(), new Date(Date.now() - 31 * 86400000).toISOString(), legacy.id).run()
 await h.db.prepare("UPDATE l_records SET revision=?,value=json_set(value,'$.expiresAt',?) WHERE kind='resume-intake' AND id=?").bind(crypto.randomUUID(), past, due.id).run()
 assert.ok(!(await h.state()).resumeIntakes.some(r => r.id === due.id), 'expired source text and previews disappear before cron')
 assert.equal((await send('/api/lodge/download/resume-intake/' + due.id, undefined, h.owner)).status, 404)
 assert.equal((await send('/api/lodge/download/resume-intake/' + legacy.id, undefined, h.owner)).status, 404, 'legacy uploads retain the thirty-day deadline')
 for (const op of ['resume-parsed', 'resume-preview', 'resume-commit'])
  assert.equal((await send('/api/lodge/command/' + op, { id: due.id, ...fields, text: 'Expired', token: duePreview.token, confirmed: true, duplicates: [] }, h.owner)).status, 404)
 assert.ok(await h.db.prepare("SELECT id FROM l_records WHERE kind='blob' AND id=?").bind(due.id).first(), 'expiry blocks reads before physical maintenance')
 const worker = await h.mf.getWorker()
 assert.equal((await worker.scheduled({ scheduledTime: new Date(), cron: '0 * * * *' })).outcome, 'ok')
 for (const id of [due.id, legacy.id]) for (const kind of ['resume-intake', 'blob']) assert.equal(await h.db.prepare('SELECT id FROM l_records WHERE kind=? AND id=?').bind(kind, id).first(), null)
 assert.equal((await send('/api/lodge/download/resume-intake/' + active.id, undefined, h.owner)).status, 200, 'cron preserves unexpired uploads')
 assert.equal((await worker.scheduled({ scheduledTime: new Date(Date.parse(active.expiresAt) + 1), cron: '0 * * * *' })).outcome, 'ok')
 assert.equal(await h.db.prepare("SELECT id FROM l_records WHERE kind='blob' AND id=?").bind(active.id).first(), null)
 const kept = await send('/api/lodge/download/resume-intake/' + saved.id, undefined, h.owner)
 assert.equal(kept.status, 200, 'cron never expires committed originals')
 assert.equal(kept.text, original, 'cron preserves the committed original bytes')
 const events = (await h.state()).audit.filter(e => ['resume-intakes-discarded', 'resume-intakes-expired', 'resume-intake-retention-set'].includes(e.action))
 assert.ok(events.some(e => e.action === 'resume-intakes-expired' && e.count === 1))
 assert.ok(events.some(e => e.action === 'resume-intakes-discarded' && e.count === 1))
 assert.ok(!JSON.stringify(events).includes(file.name) && !JSON.stringify(events).includes(fields.email) && !JSON.stringify(events).includes('Private Pending'), 'cleanup audits contain counts, never resume evidence')
 await cmd('resume-intake-settings', { retentionDays: defaultRetentionDays })
}

/** The existing DATA-002 journey calls this at each width; all writes use real commands or forms. */
export async function resumeLifecyclePage(browser, { root, origin, owner, intake, open, evidence, width }) {
 const { page, context } = owner, round = crypto.randomUUID().slice(0, 6)
 const manager = await session(browser, root, origin, 'manager', width)
 try {
  const who = (await current(manager.context, origin)).actor.email
  const vacancy = await api(context, origin, 'vacancy', { title: 'Abandoned resume ' + width + ' ' + round, location: 'New York', headcount: 1, manager: who })
  const file = { name: 'abandoned-' + width + '.txt', mediaType: 'text/plain', base64: Buffer.from('Private Resume\nprivate.resume@example.test').toString('base64') }
  const row = await api(manager.context, origin, 'resume-upload', { vacancy: vacancy.id, file })
  const level = await api(context, origin, 'permission-level', { name: 'No resume contact ' + width + ' ' + round, permissions: ['settings'] })
  await api(context, origin, 'job-levels', { id: vacancy.id, members: { [who]: level.id }, roles: {} })
  await page.reload()
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Candidates', exact: true }).click()
  await open()
  const discard = intake.getByRole('button', { name: 'Discard inaccessible pending resumes', exact: true })
  await discard.waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'orphan discard controls fit the viewport before discard')
  assert.ok(!(await intake.innerText()).includes(file.name), 'admin receives a count without the uploader’s filename')
  assert.equal((await context.request.get(origin + '/api/lodge/download/resume-intake/' + row.id)).status(), 404)
  await page.screenshot({ path: join(evidence, `DATA-002-orphan-count-${width}.png`), fullPage: true })
  await discard.click()
  await discard.waitFor({ state: 'detached' })
  assert.equal((await current(context, origin)).orphanedResumeIntakeCount, 0)
  assert.equal((await context.request.get(origin + '/api/lodge/download/resume-intake/' + row.id)).status(), 404)
  const setting = intake.getByLabel('Keep new uncommitted resumes (days)')
  await setting.fill('7')
  await intake.getByRole('button', { name: 'Save pending resume retention', exact: true }).click()
  await page.getByText('New uploads are kept for 7 days.', { exact: false }).waitFor()
  assert.equal((await current(context, origin)).resumeIntakePolicy.retentionDays, 7)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'pending retention and discard fit the viewport')
 } finally { await manager.context.close() }
}
