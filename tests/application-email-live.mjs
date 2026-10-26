import assert from 'node:assert/strict'
import { applicationEmailFixture, form } from './application-email-flow.mjs'

for (const name of ['MAIL_API_KEY', 'MAIL_FROM', 'TEST_MAIL_TO', 'QA_INBOX_RECEIPT_TOKEN']) assert.ok(process.env[name], name + ' is required')
const h = await applicationEmailFixture({ bindings: { MAIL_PROVIDER: 'sendgrid', MAIL_API_KEY: process.env.MAIL_API_KEY, MAIL_FROM: process.env.MAIL_FROM }, liveMail: true, sender: { replyTo: process.env.TEST_MAIL_TO, footer: 'Example Builders, 10 Main Street, New York. Controlled QA application test. Reply to ' + process.env.TEST_MAIL_TO + ' to opt out.' } })
try {
 const started = Date.now(), marker = 'Lodge receipt ' + crypto.randomUUID()
 await h.review('en', { subject: marker + ': {{jobTitle}}' }); await h.policy(true)
 const received = await h.submit(h.en, { email: process.env.TEST_MAIL_TO })
 const outcome = (await h.state()).applicationEmails.find(m => m.application === received.application)
 assert.equal(outcome.status, 'handed', 'SendGrid ' + outcome.status + ': ' + (outcome.reason ?? 'no reason'))
 assert.ok(outcome.providerMessageId)
 console.log(JSON.stringify({ applicationAcknowledgmentHandoff: 'accepted', providerMessageId: outcome.providerMessageId, receiptCode: received.code }))
 const replay = await h.send(received.path, form(received.values))
 assert.equal(replay.status, 200); assert.ok(replay.text.includes(received.code))
 const inbox = async contains => {
  const url = new URL('https://rer-qa-inbox.runeditrun.workers.dev/receipts')
  url.search = new URLSearchParams({ to: process.env.TEST_MAIL_TO, contains, since: String(started), limit: '20' })
  const response = await fetch(url, { headers: { authorization: 'Bearer ' + process.env.QA_INBOX_RECEIPT_TOKEN } })
  assert.equal(response.status, 200, 'QA inbox receipt HTTP status')
  return (await response.json()).receipts
 }
 let receipts = []
 for (let attempt = 0; attempt < 18; attempt++) { receipts = await inbox(received.code); if (receipts.length) break; await new Promise(r => setTimeout(r, 5000)) }
 assert.equal(receipts.length, 1); assert.ok(receipts[0].excerpt.includes(received.code)); assert.ok(receipts[0].subject.includes(marker)); assert.equal(receipts[0].auth.dmarc, 'pass')
 await h.policy(false)
 const disabled = await h.submit(h.en, { name: 'Taylor Reed', email: process.env.TEST_MAIL_TO })
 assert.equal((await h.state()).applicationEmails.filter(m => m.application === disabled.application).length, 0)
 await new Promise(r => setTimeout(r, 10000))
 assert.equal((await inbox(received.code)).length, 1, 'replay sends no second email')
 assert.equal((await inbox(disabled.code)).length, 0, 'disabled email leaves only the on-page receipt')
 console.log(JSON.stringify({ liveApplicationAcknowledgment: 'passed', provider: 'sendgrid', providerMessageId: outcome.providerMessageId, receiptCode: received.code, qaReceiptId: receipts[0].id, deliveredAt: receipts[0].receivedAt, dmarc: receipts[0].auth.dmarc, replayEmails: 0, disabledReceipt: disabled.code, disabledEmails: 0 }))
} finally { await h.close() }
