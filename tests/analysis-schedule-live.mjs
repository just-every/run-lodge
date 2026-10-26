import assert from 'node:assert/strict'
import { BUSINESS, harness } from './harness.mjs'
import { form } from './application-email-flow.mjs'

for (const key of ['MAIL_API_KEY', 'MAIL_FROM', 'TEST_MAIL_TO', 'QA_INBOX_RECEIPT_TOKEN']) assert.ok(process.env[key], key + ' required')
const h = await harness({ liveMail: true, bindings: { OWNER_EMAIL: process.env.TEST_MAIL_TO, MAIL_PROVIDER: 'sendgrid', MAIL_API_KEY: process.env.MAIL_API_KEY, MAIL_FROM: process.env.MAIL_FROM } })
try {
 await h.command('business', BUSINESS)
 const transport = await h.send('/application-emails/settings', form({ action: 'transport', replyTo: process.env.TEST_MAIL_TO, footer: 'Example Builders. Controlled QA recruiting chart. Reply to ' + process.env.TEST_MAIL_TO + ' to opt out.', monitored: 'yes', legalReviewed: 'yes' }), h.owner)
 assert.equal(transport.status, 303, transport.text)
 const day = new Date().toISOString().slice(0, 10)
 const query = { metric: 'source_conversion', from: day, to: day, jobs: [], sources: [], groupBy: 'source', chart: 'bar' }
 const saved = await h.send('/api/lodge/analysis/save', { title: 'Controlled QA current source conversion', query }, h.owner)
 assert.equal(saved.status, 201, saved.text)
 const dueAt = new Date(Date.now() + 2000).toISOString(), path = '/api/lodge/analysis/schedules'
 const draft = await h.send(path + '/preview', { chart: saved.value.chart.id, dueAt }, h.owner)
 assert.equal(draft.status, 200, draft.text)
 const enabled = await h.send(path, { chart: saved.value.chart.id, dueAt, reviewKey: draft.value.reviewKey, reviewed: true, enabled: true }, h.owner)
 assert.equal(enabled.status, 201, enabled.text)
 const started = Date.now()
 await new Promise(r => setTimeout(r, 2200))
 const tick = () => h.mf.getWorker().then(w => w.scheduled({ scheduledTime: Date.now(), cron: '0 * * * *' }))
 await tick()
 const rows = (await h.send(path, undefined, h.owner)).value.schedules, outcome = rows.find(r => r.id === enabled.value.schedule.id)
 assert.equal(outcome.status, 'handed', JSON.stringify(outcome))
 await h.restart(); await tick()
 const inbox = async () => {
  const url = new URL('https://rer-qa-inbox.runeditrun.workers.dev/receipts')
  url.search = new URLSearchParams({ to: process.env.TEST_MAIL_TO, contains: saved.value.chart.id, since: String(started), limit: '20' })
  const response = await fetch(url, { headers: { authorization: 'Bearer ' + process.env.QA_INBOX_RECEIPT_TOKEN } })
  assert.equal(response.status, 200); return (await response.json()).receipts
 }
 let receipts = []
 for (let i = 0; i < 18; i++) { receipts = await inbox(); if (receipts.length) break; await new Promise(r => setTimeout(r, 5000)) }
 assert.equal(receipts.length, 1); assert.equal(receipts[0].auth.dmarc, 'pass')
 console.log(JSON.stringify({ journey: 'REPORT-005 reviewed native scheduled chart delivery', schedule: outcome.id, chart: saved.value.chart.id, providerMessageId: outcome.providerMessageId, qaReceiptId: receipts[0].id, deliveredAt: receipts[0].receivedAt, dmarc: receipts[0].auth.dmarc, restartDuplicateEmails: 0 }))
} finally { await h.close() }
