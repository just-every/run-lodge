import assert from 'node:assert/strict'
import { applicationEmailFixture, form } from './application-email-flow.mjs'

export const crmClock = '2026-10-26T14:00:00.000Z'
export async function crmFixture() {
 const address = 'nurture@capture.example.test'
 const h = await applicationEmailFixture({ clock: crmClock, inbound: true, sender: { replyTo: address } })
 try {
  const target = await h.command('clone-vacancy', { id: h.job.id, title: 'Future warehouse lead', headcount: 1 })
  const asked = await h.command('request-vacancy-approval', { id: target.id, approver: 'owner@example.test' })
  await h.command('decide-approval', { id: asked.id, version: (await h.state()).approvals.find(a => a.id === asked.id).currentVersion, decision: 'approved', reason: 'Approved future opening' })
  await h.command('publish', { id: target.id })
  const add = async (name, email, talentPool = true) => {
   const added = await h.command('candidate', { name, email, skills: 'Bluebeam and safe warehouse operations', source: 'Past applicant', consentBasis: 'application', talentPool, vacancy: h.job.id })
   await h.command('move', { application: added.application.id, to: 'rejected', closeReason: 'skills', reason: 'Previous role closed' })
   return added
  }
  const riley = await add('Riley Park', 'riley@example.test'), quiet = await add('Jo Quiet', 'quiet@example.test', false)
  const pool = await h.command('crm-pool', { name: 'Warehouse alumni', query: 'Bluebeam', candidates: [riley.candidate.id], reason: 'Recorded Bluebeam experience' })
  const input = { pool: pool.id, candidate: riley.candidate.id, sourceApplication: riley.application.id, vacancy: target.id, owner: 'owner@example.test', language: 'en', dueAt: '2026-10-26T14:01:00.000Z', cadenceHours: 1, steps: [{ subject: 'Riley, a future warehouse opening', body: 'Your recorded Bluebeam experience matches the published warehouse work. Would you like to discuss this opening?', footer: 'Example Builders, 10 Main Street, New York. Contact recruiting@example.test to stop outreach.' }, { subject: 'Riley, following up on the warehouse opening', body: 'Would you like to discuss this future opening?', footer: 'Example Builders, 10 Main Street, New York. Stop outreach with the link below.' }] }
  const nativeEmail = async (from, body, extra = {}) => {
   const raw = 'From: ' + from + '\r\nTo: ' + address + '\r\nSubject: Candidate reply\r\nMessage-ID: <' + (extra.id ?? 'synthetic-lodge-reply') + '@example.test>\r\nIn-Reply-To: <synthetic-lodge-sent@example.test>\r\nReferences: <synthetic-lodge-sent@example.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n' + body
   const response = await h.mf.dispatchFetch(h.origin + '/cdn-cgi/local/email?' + new URLSearchParams({ from, to: address, format: 'json' }), { method: 'POST', body: raw })
   const result = await response.json()
   assert.deepEqual(result.forwards, []); assert.deepEqual(result.replies, [])
   return { status: result.rejectReason ? 400 : response.status, result }
  }
  const verifyRoute = async () => {
   assert.equal((await h.send('/crm/reply-route/check', form({}), h.owner)).status, 303)
   const check = (await h.mails()).findLast(m => m.subject === 'Lodge CRM reply route verification')
   assert.equal((await nativeEmail('installation-sender@example.test', check.text)).status, 200)
  }
  const view = async cookie => { const response = await h.send('/api/lodge/crm?q=Bluebeam', undefined, cookie ?? h.owner); assert.equal(response.status, 200); return response.value }
  const tick = async at => { await h.setTime(at); await h.mf.getWorker().then(w => w.scheduled({ scheduledTime: Date.parse(at), cron: '0 * * * *' })) }
  const nativeCandidate = async email => {
   assert.equal((await h.send('/auth/invite', { email, displayName: 'Candidate', role: 'member', returnTo: '/candidate' }, h.owner)).status, 202)
   const mail = (await h.mails()).findLast(m => m.to.includes(email) && m.text.includes('/auth/confirm?token='))
   const token = new URL(mail.text.match(/http:\/\/\S+\/auth\/confirm\?token=\S+/)[0]).searchParams.get('token')
   const confirmed = await h.send('/auth/confirm', { token }); assert.equal(confirmed.status, 303); return confirmed.cookie
  }
  return Object.assign(h, { address, target, riley, quiet, pool, input, add, nativeEmail, verifyRoute, view, tick, nativeCandidate })
 } catch (error) { await h.close(); throw error }
}

export async function checkNurture(t) {
 const h = await crmFixture(); t.after(() => h.close())
 const manager = await h.member('crm-manager@example.test', ['manager'])
 const agent = await h.member('crm-agent@example.test', [], 'Coding agent', { agent: true, actsFor: 'owner@example.test' })
 assert.equal((await h.send('/api/lodge/crm', undefined, manager)).status, 200)
 assert.deepEqual((await h.view(manager)).matches, [], 'a recruiter off the source job cannot rediscover its candidates')
 for (const cookie of [agent]) assert.equal((await h.send('/api/lodge/crm', undefined, cookie)).status, 403)
 await h.command('crm-pool', { name: 'Unconsented', query: 'Bluebeam', candidates: [h.quiet.candidate.id], reason: 'No permission' }, h.owner, 409)
 await h.command('hiring-team', { id: h.job.id, recruiters: ['crm-manager@example.test'] })
 await h.command('hiring-team', { id: h.target.id, recruiters: ['crm-manager@example.test'] })
 const recruiterPool = await h.command('crm-pool', { name: 'Recruiter alumni', query: 'Bluebeam', candidates: [h.riley.candidate.id], reason: 'Current job-scoped contact and recorded experience' }, manager)
 const recruiterDraft = await h.command('crm-enroll', { ...h.input, pool: recruiterPool.id, owner: 'crm-manager@example.test' }, manager)
 await h.command('crm-enable', { id: recruiterDraft.id, enabled: true, reviewed: true }, manager, 403)
 await h.command('crm-stop', { id: recruiterDraft.id, reason: 'Prepare the admin-reviewed sequence' }, manager)
 const draft = await h.command('crm-enroll', h.input)
 assert.equal(draft.status, 'draft')
 assert.ok(draft.steps[0].footer.includes(draft.optOutURL)); assert.ok(draft.steps[0].footer.includes(draft.replyURL))
 await h.command('crm-enable', { id: draft.id, enabled: true, reviewed: true }, h.owner, 409)
 await h.verifyRoute()
 let v = await h.view()
 assert.deepEqual(v.matches.map(m => m.candidate), [h.riley.candidate.id])
 assert.ok(v.enrollments.find(e => e.id === draft.id).selection.evidence.skills.includes('Bluebeam')); assert.ok(v.enrollments.find(e => e.id === draft.id).consentExpiry)
 assert.equal((await h.state()).applications.filter(a => a.vacancy === h.target.id).length, 0, 'rediscovery never silently creates an application')
 assert.ok((await h.state()).tasks.some(task => task.id === draft.task && task.owner === 'owner@example.test'))
 await h.command('crm-enable', { id: draft.id, enabled: true, reviewed: false }, h.owner, 400)
 await h.command('crm-enable', { id: draft.id, enabled: true, reviewed: true })
 await h.tick('2026-10-26T14:01:00.000Z')
 v = await h.view(); assert.equal(v.enrollments.find(e => e.id === draft.id).outcomes.length, 1); assert.equal(v.enrollments.find(e => e.id === draft.id).outcomes[0].status, 'handed')
 const cookie = await h.nativeCandidate(h.riley.candidate.email), outsider = await h.nativeCandidate('other-candidate@example.test')
 assert.equal((await h.send('/crm/reply/' + draft.id, undefined, outsider)).status, 404)
 assert.equal((await h.send('/crm/reply/' + draft.id, form({ body: 'A forged reply' }), cookie, { origin: 'https://foreign.example.test' })).status, 403)
 assert.equal((await h.send('/crm/reply/' + draft.id, form({ body: 'Yes, please tell me about the future opening.' }), cookie)).status, 303)
 await h.restart(); await h.tick('2026-10-26T16:01:00.000Z')
 v = await h.view(); assert.equal(v.enrollments.find(e => e.id === draft.id).status, 'stopped'); assert.equal(v.enrollments.find(e => e.id === draft.id).outcomes.length, 1)
 assert.ok(v.enrollments.find(e => e.id === draft.id).priorInteractions.some(r => r.kind === 'crm-reply' && r.body.includes('future opening')))
 await h.command('crm-apply', { pool: h.pool.id, candidate: h.riley.candidate.id, vacancy: h.target.id, reason: 'Riley requested a conversation' }, h.owner, 400)
 const created = await h.command('crm-apply', { pool: h.pool.id, candidate: h.riley.candidate.id, vacancy: h.target.id, reason: 'Riley confirmed interest; human selected the evidenced match', confirmed: true })
 assert.equal(created.vacancy, h.target.id); assert.equal(created.source, 'Talent pool')
 const another = await h.add('Taylor Reed', 'taylor@example.test')
 const pool = await h.command('crm-pool', { name: 'Future alumni', query: 'Bluebeam', candidates: [another.candidate.id], reason: 'Recorded work experience' })
 const opted = await h.command('crm-enroll', { ...h.input, pool: pool.id, candidate: another.candidate.id, sourceApplication: another.application.id, dueAt: '2026-10-26T17:00:00.000Z' })
 await h.command('crm-enable', { id: opted.id, enabled: true, reviewed: true })
 await h.tick('2026-10-26T17:00:00.000Z')
 const route = '/crm/opt-out/' + opted.optOutToken
 assert.equal((await h.send(route)).status, 200)
 assert.equal((await h.send(route, form({ confirm: 'yes' }), '', { origin: 'https://foreign.example.test' })).status, 403, 'foreign pages cannot revoke consent through a forged form')
 assert.equal((await h.send(route, form({ confirm: 'yes' }))).status, 200)
 await h.restart(); await h.tick('2026-10-26T19:00:00.000Z')
 v = await h.view(); assert.equal(v.enrollments.find(e => e.id === opted.id).outcomes.length, 1)
 assert.ok(!v.matches.some(m => m.candidate === another.candidate.id))
 const submitted = await h.submit(h.es, { name: 'Sam Ongoing', email: 'sam@example.test', talentPool: 'yes' })
 const native = (await h.state()).candidates.find(c => c.email === 'sam@example.test')
 const continuing = { candidate: await h.command('correct-candidate', { ...native, skills: 'Bluebeam', reason: 'Candidate supplied the factual skill for future openings' }), application: { id: submitted.application } }
 await h.command('move', { application: submitted.application, to: 'rejected', closeReason: 'skills', reason: 'Past opening closed' })
 const ongoingPool = await h.command('crm-pool', { name: 'Ongoing alumni', query: 'Bluebeam', candidates: [continuing.candidate.id], reason: 'Recorded factual experience' })
 const spanish = { ...h.input, pool: ongoingPool.id, candidate: continuing.candidate.id, sourceApplication: continuing.application.id, dueAt: '2026-10-26T19:01:00.000Z', language: 'es', steps: [{ subject: 'Una futura vacante', body: 'Su experiencia registrada en Bluebeam coincide con esta vacante.', footer: 'Example Builders, 10 Main Street, Nueva York. Puede cancelar los correos con el enlace.' }, { subject: 'Seguimiento de la vacante', body: '¿Le gustaría hablar sobre esta vacante?', footer: 'Example Builders, 10 Main Street, Nueva York. Puede cancelar los correos con el enlace.' }] }
 await h.command('crm-enroll', { ...spanish, language: 'en' }, h.owner, 409)
 const ongoing = await h.command('crm-enroll', spanish)
 await h.command('crm-enable', { id: ongoing.id, enabled: true, reviewed: true })
 const outcomes = async () => (await h.view()).enrollments.find(e => e.id === ongoing.id).outcomes
 await h.tick('2026-10-26T19:01:00.000Z'); assert.equal((await outcomes()).length, 1)
 await h.restart(); await h.tick('2026-10-26T19:30:00.000Z'); assert.equal((await outcomes()).length, 1)
 await h.tick('2026-10-26T20:01:00.000Z'); assert.equal((await outcomes()).length, 2)
 assert.equal((await outcomes())[1].content.subject, spanish.steps[1].subject)
 assert.ok((await outcomes()).every(m => m.language === 'es' && m.content.text.includes('Nueva York')))
 await h.restart(); await h.tick('2026-10-27T14:00:00.000Z'); assert.equal((await outcomes()).length, 2)
 const incoming = await h.nativeEmail(h.riley.candidate.email, 'Please retain this reply in the conversation.', { id: 'synthetic-lodge-native-reply' })
 assert.equal(incoming.status, 200)
 assert.equal((await h.nativeEmail(h.riley.candidate.email, 'Please retain this reply in the conversation.', { id: 'synthetic-lodge-native-reply' })).status, 200)
 const exported = await h.send('/api/lodge/download/candidate/' + h.riley.candidate.id, undefined, h.owner)
 assert.equal(exported.status, 200); assert.equal(exported.value.nurtureReplies.length, 2)
 assert.ok(exported.value.nurtureReplies.some(r => r.inReplyTo === '<synthetic-lodge-sent@example.test>'))
 const rows = (await h.db.prepare('SELECT * FROM l_records').all()).results
 const { policy, validateStaged } = await import('../scripts/installer/portability-policy.mjs')
 assert.equal(await validateStaged({ read: async table => table === 'l_records' ? rows : [] }), true)
 assert.ok(rows.filter(r => r.kind === 'crm-enrollment').every(r => JSON.parse(policy.exportRow('l_records', r).value).status === 'withheld'))
 await h.command('move', { application: created.id, to: 'rejected', closeReason: 'skills', reason: 'Human closed this application' })
 assert.equal((await h.send('/api/lodge/delete-candidate', { candidate: h.riley.candidate.id, confirm: h.riley.candidate.name, reason: 'Requested erasure' }, h.owner)).status, 200)
 const after = await h.view(); assert.ok(!after.enrollments.some(e => e.candidate === h.riley.candidate.id))
 assert.equal((await h.send('/crm/reply/' + draft.id, undefined, cookie)).status, 404)
}
