import assert from 'node:assert/strict'
import { liveCrmInstallation } from './crm-cloudflare.mjs'
import { BUSINESS } from './harness.mjs'
import { form } from './application-email-flow.mjs'

const h = await liveCrmInstallation(), started = Date.now(), marker = 'Lodge nurture ' + crypto.randomUUID()
const waitUntil = async (read, accept, label, count = 36) => {
 for (let n = 0; n < count; n++) { const value = await read(); if (accept(value)) return value; await new Promise(resolve => setTimeout(resolve, 5000)) }
 throw Error(label + ' did not complete')
}
try {
 const owner = process.env.TEST_MAIL_TO
 await h.command('business', { ...BUSINESS, timeZone: 'Asia/Tokyo' })
 const job = await h.command('vacancy', { title: 'Warehouse Associate', location: 'New York', manager: owner, headcount: 1, description: 'Safe warehouse work.', compensation: { currency: 'USD', min: 4200000, max: 4800000, period: 'year' } })
 await h.command('rubric', { id: job.id, criteria: [{ name: 'Safe handling', description: 'Explains safe warehouse handling' }] })
 await h.command('interview-plan', { id: job.id, plan: [{ name: 'Work review', stageName: 'Interview' }] })
 const approve = async id => { const request = await h.command('request-vacancy-approval', { id, approver: owner }); await h.command('decide-approval', { id: request.id, version: (await h.state()).approvals.find(a => a.id === request.id).currentVersion, decision: 'approved', reason: 'Controlled QA opening reviewed' }); await h.command('publish', { id }) }
 await approve(job.id)
 const target = await h.command('clone-vacancy', { id: job.id, title: 'Future warehouse lead' }); await approve(target.id)
 const { candidate, application } = await h.command('candidate', { name: 'Controlled QA alumni', email: owner, skills: 'Bluebeam', source: 'Controlled QA past applicant', consentBasis: 'application', talentPool: true, vacancy: job.id })
 await h.command('move', { application: application.id, to: 'rejected', closeReason: 'skills', reason: 'Past opening closed' })
 const pool = await h.command('crm-pool', { name: 'Controlled QA alumni', query: 'Bluebeam', candidates: [candidate.id], reason: 'Recorded factual experience' })
 const transport = await h.send('/application-emails/settings', form({ action: 'transport', replyTo: h.replyAddress, footer: 'Example Builders, 10 Main Street, New York. Controlled QA test; use the included opt-out link.', monitored: 'yes', legalReviewed: 'yes' }))
 assert.equal(transport.status, 303)
 assert.equal((await h.send('/crm/reply-route/check', form({}))).status, 303)
 await waitUntil(h.view, v => v.replyRoute?.status === 'verified', 'Native inbound route verification')
 console.log('Real SendGrid verification reached the native Cloudflare email receiver')
 const prepare = async subject => {
  const draft = await h.command('crm-enroll', { pool: pool.id, candidate: candidate.id, sourceApplication: application.id, vacancy: target.id, owner, language: 'en', dueAt: new Date(Date.now() + 65000).toISOString(), cadenceHours: 1, steps: [{ subject, body: 'Your recorded Bluebeam experience matches this controlled future opening.', footer: 'Example Builders, 10 Main Street, New York. Controlled QA nurture; stop with the link below.' }, { subject: subject + ' follow-up', body: 'Following up on this controlled future opening.', footer: 'Example Builders, 10 Main Street, New York. Stop using the link below.' }] })
  await h.command('crm-enable', { id: draft.id, reviewed: true, enabled: true }); return draft
 }
 const inbox = async contains => {
  const url = new URL('https://rer-qa-inbox.runeditrun.workers.dev/receipts')
  url.search = new URLSearchParams({ to: owner, contains, since: String(started), limit: '20' })
  const response = await fetch(url, { headers: { authorization: 'Bearer ' + process.env.QA_INBOX_RECEIPT_TOKEN } }); assert.equal(response.status, 200)
  return (await response.json()).receipts
 }
 const first = await prepare(marker + ' reply'); await h.startSchedule()
 const arrived = await waitUntil(() => inbox(marker + ' reply'), r => r.length === 1, 'Live nurture delivery after schedule propagation', 240)
 assert.equal(arrived[0].auth.dmarc, 'pass')
 assert.equal((await h.send('/crm/reply/' + first.id, form({ body: 'Yes, I would like to discuss this opening. Please stop the automatic follow-up.' }))).status, 303)
 const stopped = (await h.view()).enrollments.find(e => e.id === first.id)
 assert.equal(stopped.status, 'stopped'); assert.equal(stopped.outcomes.length, 1); assert.ok(stopped.priorInteractions.some(r => r.source === 'native-candidate-account'))
 const second = await prepare(marker + ' opt-out')
 const optedMail = await waitUntil(() => inbox(marker + ' opt-out'), r => r.length === 1, 'Live second nurture delivery', 60)
 assert.equal(optedMail[0].auth.dmarc, 'pass')
 assert.equal((await h.send('/crm/opt-out/' + second.optOutToken, form({ confirm: 'yes' }), false)).status, 200)
 const opted = (await h.view()).enrollments.find(e => e.id === second.id)
 assert.equal(opted.status, 'stopped'); assert.equal(opted.outcomes.length, 1)
 const created = await h.command('crm-apply', { pool: pool.id, candidate: candidate.id, vacancy: target.id, reason: 'Human explicitly selected the evidenced candidate', confirmed: true }).catch(error => error)
 assert.ok(created instanceof Error, 'opt-out prevents later application creation through nurture selection')
 const finalReceipts = await inbox(marker)
 assert.equal(finalReceipts.length, 2, 'Reply and opt-out leave exactly the two controlled deliveries')
 const pendingFollowups = (await h.view()).enrollments.flatMap(e => e.outcomes).filter(m => m.status === 'pending').length
 assert.equal(pendingFollowups, 0)
 console.log(JSON.stringify({ journey: 'CRM-004 native installation', inboundRouteVerified: true, deliveries: [arrived[0], optedMail[0]].map(r => ({ id: r.id, receivedAt: r.receivedAt, dmarc: r.auth.dmarc })), nativeCandidateReply: true, replyStopped: stopped.status, optOutStopped: opted.status, pendingFollowups, deliveredMessages: finalReceipts.length }))
} finally { await h.cleanup(); console.log('Temporary native worker, inbound rule and database removed') }
