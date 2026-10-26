import assert from 'node:assert/strict'
import { applicationEmailFixture, form } from './application-email-flow.mjs'
import { harness } from './harness.mjs'
import { createPortability, readArchive } from '@runeditrun/rer/modules/portability'
import { loadPolicy } from '@runeditrun/rer/internal/cli/portability-policy.mjs'

export async function checkApplicationEmailSender(t) {
 const h = await applicationEmailFixture({ activate: false }); t.after(() => h.close())
 await h.command('application-email-policy', { vacancy: h.job.id, acknowledgment: true, stages: [] }, h.owner, 409)
 h.edge.verified = false
 await h.activate({}, h.owner, 409)
 const disabled = await h.submit()
 assert.equal((await h.state()).applicationEmails.length, 0)
 h.edge.verified = true
 const manager = await h.member('sender-manager@example.test', ['manager'])
 await h.activate({}, manager, 403)
 await h.activate()
 await h.command('application-email-template', { vacancy: h.job.id, kind: 'acknowledgment', language: 'en', subject: 'Application', body: '{{receiptCode}} {{privateNotes}}', reviewed: true }, h.owner, 400)
 await h.review(); await h.policy(true)
 const before = (await h.mails()).length
 const prepared = await h.prepareSubmission(h.en, { name: 'Avery Morgan', email: 'avery@example.test' })
 const results = await Promise.all([h.send(prepared.path, form(prepared.values)), h.send(prepared.path, form(prepared.values))])
 assert.ok(results.some(result => result.status === 200))
 assert.ok(results.every(result => [200, 409].includes(result.status)))
 const message = (await h.mails()).at(-1)
 assert.equal((await h.mails()).length, before + 1)
 assert.equal(message.from, 'lodge@example.test'); assert.equal(message.replyTo, 'recruiting@example.test')
 assert.match(message.text, /10 Main Street/)
 const outcomes = (await h.state()).applicationEmails
 assert.equal(outcomes.length, 1); assert.equal(outcomes[0].status, 'handed')
 assert.equal(outcomes[0].content.to, 'avery@example.test')
 assert.ok(!JSON.stringify(outcomes).includes('synthetic-lodge-2'))
 assert.ok(disabled.code)
 // Reapproving installation details invalidates the job's previous authorization.
 await h.activate({ footer: 'Example Builders, 12 Main Street, New York. Reply to recruiting@example.test to opt out.' })
 const stale = await h.submit(h.en, { name: 'Quinn Stone', email: 'quinn@example.test' })
 assert.equal((await h.state()).applicationEmails.find(mail => mail.application === stale.application).status, 'withheld')
 assert.equal((await h.mails()).length, before + 1)
 await h.review(); await h.policy(true)
 h.edge.verified = false
 const unverified = await h.submit(h.en, { name: 'Jamie Bell', email: 'jamie@example.test' })
 assert.equal((await h.state()).applicationEmails.find(mail => mail.application === unverified.application).status, 'withheld')
 assert.equal((await h.mails()).length, before + 1)
}

export async function checkApplicationEmailRestore(t) {
 const { reminderFixture, clock } = await import('./reminders-flow.mjs')
 const src = await reminderFixture(); t.after(() => src.close())
 const reminder = await src.command('hiring-reminder', { ...src.input, dueAt: '2026-10-26T15:00:00.000Z' })
 await src.review(); await src.policy(true)
 let release, entered
 const paused = new Promise(resolve => { entered = resolve })
 const resume = new Promise(resolve => { release = resolve })
 src.edge.beforeCheck = async request => { if (new URL(request.url).pathname.endsWith('/7')) { entered(); await resume } }
 const submission = src.submit()
 await paused
 const policy = await loadPolicy(process.cwd(), undefined, 'scripts/installer/portability-policy.mjs')
 const service = await createPortability({ db: src.db, policy })
 let records, received
 try {
  const id = await service.exports.create()
  try {
   while ((await service.exports.advance(id, { maxParts: 16 })).phase === 'building') {}
   records = []
   for await (const record of readArchive(await service.exports.download(id))) records.push(record)
  } finally { await service.exports.abort(id) }
 } finally { release(); received = await submission }
 const manifest = records[0], parts = records.filter(record => record.kind === 'part'), closing = records.at(-1)
 assert.ok(!manifest.tables.some(table => table.name === 'l_application_email_activation'))
 const dst = await harness({ clock, claim: false, bindings: { MAIL_PROVIDER: 'sendgrid', MAIL_API_KEY: 'synthetic-lodge-2' } }); t.after(() => dst.close())
 const target = await createPortability({ db: dst.db, policy }), id = await target.imports.create(manifest)
 for (const part of parts) await target.imports.uploadPart(id, part.index, part)
 await target.imports.finalize(id, { contentHash: closing.contentHash, archiveHash: closing.archiveHash })
 assert.equal((await target.imports.status(id)).phase, 'complete')
 const owner = await dst.signIn('owner@example.test')
 const settings = await dst.send('/application-emails/settings?vacancy=' + src.job.id, undefined, owner)
 assert.equal(settings.status, 200); assert.match(settings.text, /Automatic application mail: Off/)
 await dst.command('application-email-policy', { vacancy: src.job.id, acknowledgment: true, stages: [] }, owner, 409)
 assert.equal((await dst.db.prepare('SELECT COUNT(*) AS n FROM l_application_email_activation').first()).n, 0)
 const restoredReminders = await dst.send('/api/lodge/reminders', undefined, owner)
 assert.equal(restoredReminders.status, 200)
 assert.equal(restoredReminders.value.reminders.find(r => r.id === reminder.id).status, 'withheld')
 await dst.setTime('2026-10-26T16:00:00.000Z')
 await dst.mf.getWorker().then(w => w.scheduled({ scheduledTime: Date.parse('2026-10-26T16:00:00.000Z'), cron: '0 * * * *' }))
 assert.equal((await dst.send('/api/lodge/reminders', undefined, owner)).value.reminders.find(r => r.id === reminder.id).outcomes.length, 0)
 const stored = (await dst.state(owner)).applicationEmails.find(mail => mail.application === received.application)
 assert.equal(stored.status, 'withheld')
 assert.equal(stored.id, 'ack:' + received.application)
 const before = (await dst.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first()).n
 const replay = await dst.send(received.path, form(received.values))
 assert.equal(replay.status, 200); assert.ok(replay.text.includes(received.code))
 const shown = await dst.send(received.path), key = /name="submissionKey" value="([^"]+)"/.exec(shown.text)[1]
 const fresh = await dst.send(received.path, form({ ...received.values, submissionKey: key, name: 'New restored applicant', email: 'restored@example.test' }))
 assert.equal(fresh.status, 200); assert.match(fresh.text, /LDG-[0-9A-F]{8}/)
 assert.equal((await dst.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first()).n, before)
}

export async function checkApplicationEmailIsolation(t) {
 const h = await applicationEmailFixture(); t.after(() => h.close())
 const approve = async request => { const version = (await h.state()).approvals.find(item => item.id === request.id).currentVersion; await h.command('decide-approval', { id: request.id, version, decision: 'approved', reason: 'Budgeted' }) }
 const job = await h.command('vacancy', { title: 'Field crew', location: 'New York', headcount: 1, compensation: { currency: 'USD', min: 5000000, max: 6000000, period: 'year' } })
 await h.command('rubric', { id: job.id, criteria: [{ name: 'Experience', description: 'Field work' }] })
 await h.command('interview-plan', { id: job.id, plan: [{ name: 'Review', stageName: 'Interview' }] })
 await approve(await h.command('request-vacancy-approval', { id: job.id, approver: 'owner@example.test' }))
 await h.command('publish', { id: job.id })
 const other = { job: (await h.state()).vacancies.find(item => item.id === job.id) }
 await h.review(); await h.policy(true)
 await h.review('en', { vacancy: other.job.id, subject: 'Field crew receipt', body: 'Field crew application: {{receiptCode}}' })
 await h.command('application-email-policy', { vacancy: other.job.id, acknowledgment: true, stages: [] })
 await h.review('en', { subject: 'Updated original job receipt' }); await h.policy(false)
 const received = await h.submit(other.job, { name: 'Robin Green', email: 'robin@example.test' })
 const message = (await h.mails()).at(-1)
 assert.equal(message.subject, 'Field crew receipt'); assert.ok(message.text.includes(received.code))
 const disabled = await h.submit(h.en, { name: 'Cameron Moore', email: 'cameron@example.test' })
 assert.equal((await h.mails()).length, 1)
 assert.equal((await h.state()).applicationEmails.filter(mail => mail.application === disabled.application).length, 0)
}
