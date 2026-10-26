import assert from 'node:assert/strict'
import { businessHarness } from './harness.mjs'
import { form } from './application-email-flow.mjs'

for (const name of ['MAIL_API_KEY', 'MAIL_FROM', 'TEST_MAIL_TO', 'QA_INBOX_RECEIPT_TOKEN']) assert.ok(process.env[name], name + ' is required')
const start = Date.now(), marker = 'Lodge reminder ' + crypto.randomUUID(), clock = new Date(start).toISOString()
const h = await businessHarness({ clock, liveMail: true, bindings: { OWNER_EMAIL: process.env.TEST_MAIL_TO, MAIL_PROVIDER: 'sendgrid', MAIL_API_KEY: process.env.MAIL_API_KEY, MAIL_FROM: process.env.MAIL_FROM } })
try {
 const owner = (await h.state()).actor.email
 assert.equal(owner, process.env.TEST_MAIL_TO)
 const job = await h.command('vacancy', { title: 'Warehouse Associate', location: 'New York', headcount: 1, manager: owner, description: 'Load goods safely.', compensation: { currency: 'USD', min: 4200000, max: 4800000, period: 'year' } })
 await h.command('rubric', { id: job.id, criteria: [{ name: 'Safe handling', description: 'Describes safe goods handling' }] })
 await h.command('interview-plan', { id: job.id, plan: [{ name: 'Work review', stageName: 'Interview', durationMinutes: 60 }] })
 const asked = await h.command('request-vacancy-approval', { id: job.id, approver: owner })
 await h.command('decide-approval', { id: asked.id, version: (await h.state()).approvals.find(a => a.id === asked.id).currentVersion, decision: 'approved', reason: 'Controlled QA hiring journey' })
 await h.command('publish', { id: job.id })
 const liveJob = (await h.state()).vacancies.find(j => j.id === job.id)
 const { application } = await h.command('candidate', { name: 'QA Reminder Recipient', email: process.env.TEST_MAIL_TO, source: 'Controlled QA', consentBasis: 'application', vacancy: job.id })
 const iv = await h.command('interview', { application: application.id, planItem: liveJob.plan[0].id, participants: [owner], slots: [new Date(start + 7 * 86400000).toISOString()] })
 const footer = 'RunEditRun, controlled QA hiring reminder test. Contact ' + process.env.TEST_MAIL_TO + ' to stop this test.'
 const transport = await h.send('/application-emails/settings', form({ action: 'transport', replyTo: process.env.TEST_MAIL_TO, footer, monitored: 'yes', legalReviewed: 'yes' }), h.owner)
 assert.equal(transport.status, 303, 'Authenticated installation sender must be enabled')
 const r = await h.command('hiring-reminder', { interview: iv.id, kind: 'availability', recipient: 'candidate', owner, escalation: owner, dueAt: clock, cadenceHours: 1, maxAttempts: 2, startHour: 0, endHour: 24, weekdays: [0, 1, 2, 3, 4, 5, 6], language: 'en', subject: marker, body: 'Please choose your controlled test interview availability: ' + h.origin + '/availability/' + iv.candidateToken, footer, enabled: true, reviewed: true })
 const tick = async at => { await h.setTime(new Date(at).toISOString()); await h.mf.getWorker().then(w => w.scheduled({ scheduledTime: at, cron: '0 * * * *' })) }
 await tick(start); await h.restart(); await tick(start + 3600000); await tick(start + 7200000)
 const outcomes = (await h.state()).applicationEmails.filter(m => m.reminder === r.id)
 assert.equal(outcomes.length, 3); assert.ok(outcomes.every(m => m.status === 'handed' && m.providerMessageId))
 await h.restart(); await tick(start + 10800000)
 assert.equal((await h.state()).applicationEmails.filter(m => m.reminder === r.id).length, 3)
 const inbox = async contains => {
  const url = new URL('https://rer-qa-inbox.runeditrun.workers.dev/receipts')
  url.search = new URLSearchParams({ to: process.env.TEST_MAIL_TO, contains, since: String(start), limit: '20' })
  const response = await fetch(url, { headers: { authorization: 'Bearer ' + process.env.QA_INBOX_RECEIPT_TOKEN } })
  assert.equal(response.status, 200, 'QA inbox receipt HTTP status')
  return (await response.json()).receipts
 }
 let reminders = [], escalation = []
 for (let n = 0; n < 18; n++) {
  reminders = await inbox(marker); escalation = await inbox(r.id)
  if (reminders.length === 2 && escalation.length === 1) break
  await new Promise(resolve => setTimeout(resolve, 5000))
 }
 assert.equal(reminders.length, 2); assert.equal(escalation.length, 1)
 assert.ok([...reminders, ...escalation].every(receipt => receipt.auth.dmarc === 'pass'))
 await h.send('/availability/' + iv.candidateToken, form({ slot: '0' })).then(response => assert.equal(response.status, 200))
 await tick(start + 14400000)
 assert.equal((await h.state()).applicationEmails.filter(m => m.reminder === r.id).length, 3)
 console.log(JSON.stringify({ journey: 'AUTO-002 live reminder cadence and escalation', provider: 'sendgrid', reminders: reminders.map(x => ({ id: x.id, receivedAt: x.receivedAt, dmarc: x.auth.dmarc })), escalation: escalation.map(x => ({ id: x.id, receivedAt: x.receivedAt, dmarc: x.auth.dmarc })), attempts: outcomes.map(m => ({ purpose: m.purpose, providerMessageId: m.providerMessageId })), duplicateAttemptsAfterRestart: 0, staleAttemptsAfterResponse: 0 }))
} finally { await h.close() }
