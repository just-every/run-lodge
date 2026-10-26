import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { applicationEmailFixture, form } from './application-email-flow.mjs'

export const clock = '2026-10-26T14:00:00.000Z'
export async function reminderFixture(options = {}) {
 const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
 const h = await applicationEmailFixture({ clock, bindings: { ...options.bindings, APPLICATION_EMAIL_SENDGRID_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') } })
 try {
  const ivy = await h.member('ivy@example.test', ['interviewer'], 'Ivy Chen')
  await h.command('unpublish', { id: h.job.id, reason: 'Set the agreed interview plan' })
  await h.command('interview-plan', { id: h.job.id, plan: [{ name: 'Work review', stageName: 'Interview', durationMinutes: 60 }] })
  const asked = await h.command('request-vacancy-approval', { id: h.job.id, approver: 'owner@example.test' })
  await h.command('decide-approval', { id: asked.id, version: (await h.state()).approvals.find(x => x.id === asked.id).currentVersion, decision: 'approved', reason: 'Reviewed plan' })
  await h.command('publish', { id: h.job.id })
  const job = (await h.state()).vacancies.find(j => j.id === h.job.id)
  const { application } = await h.command('candidate', { name: 'Jordan Rivera', email: 'jordan@example.test', source: 'Referral', consentBasis: 'application', vacancy: job.id })
  const interview = await h.command('interview', { application: application.id, planItem: job.plan[0].id, participants: ['ivy@example.test'], slots: ['2026-10-28T14:00:00.000Z'], timezone: 'America/New_York' })
  const input = { interview: interview.id, kind: 'availability', recipient: 'candidate', owner: 'owner@example.test', escalation: 'owner@example.test', dueAt: clock, cadenceHours: 1, maxAttempts: 2, startHour: 9, endHour: 17, weekdays: [1, 2, 3, 4, 5], language: 'en', subject: 'Please share your availability', body: 'Jordan, please choose your interview availability through your private link.', footer: 'Example Builders, 10 Main Street, New York. Contact recruiting@example.test to opt out.', reviewed: true, enabled: true }
  const reminders = async () => { const response = await h.send('/reminders/settings', undefined, h.owner); assert.equal(response.status, 200); return response }
  const rows = async () => { const response = await h.send('/api/lodge/reminders', undefined, h.owner); assert.equal(response.status, 200); return response.value.reminders }
  const outcomes = async id => (await h.state()).applicationEmails.filter(m => m.reminder === id)
  const tick = async at => { await h.setTime(at); await h.mf.getWorker().then(w => w.scheduled({ scheduledTime: Date.parse(at), cron: '0 * * * *' })) }
  const delivered = async (id, at) => {
   const mails = await outcomes(id), stamp = String(Date.parse(at) / 1000)
   const events = mails.filter(m => m.status === 'handed').map((m, i) => ({ event: 'delivered', sg_event_id: 'synthetic-lodge-' + m.id, sg_message_id: m.providerMessageId, timestamp: Number(stamp) }))
   const headers = { 'x-twilio-email-event-webhook-timestamp': stamp, 'x-twilio-email-event-webhook-signature': sign('sha256', Buffer.from(stamp + JSON.stringify(events)), privateKey).toString('base64') }
   assert.equal((await h.send('/api/lodge/application-emails/events', events, '', headers)).status, 200)
   assert.ok((await outcomes(id)).every(m => m.status === 'delivered'))
  }
  return Object.assign(h, { job, ivy, application, interview, input, reminders, rows, outcomes, tick, delivered })
 } catch (error) { await h.close(); throw error }
}

export async function checkReminderCadence(t) {
 const h = await reminderFixture(); t.after(() => h.close())
 const candidate = await h.command('hiring-reminder', h.input)
 const panel = await h.command('hiring-reminder', { ...h.input, recipient: 'ivy@example.test' })
 assert.equal((await h.send('/api/lodge/command/hiring-reminder', h.input, h.ivy)).status, 403)
 assert.equal((await h.send('/reminders/settings', undefined, h.ivy)).status, 403)
 assert.equal((await h.send('/api/lodge/reminders', undefined, h.ivy)).status, 403)
 assert.equal((await h.send('/api/lodge/reminders')).status, 401)
 await h.command('hiring-reminder', h.input, h.owner, 409)
 assert.equal((await h.outcomes(candidate.id)).length, 0, 'configuration creates no contact')
 await h.tick(clock)
 for (const r of [candidate, panel]) { assert.equal((await h.outcomes(r.id)).length, 1); await h.delivered(r.id, clock) }
 await h.restart(); await h.tick('2026-10-26T14:30:00.000Z')
 assert.equal((await h.outcomes(candidate.id)).length, 1, 'cadence survives restart')
 await h.tick('2026-10-26T15:00:00.000Z')
 for (const r of [candidate, panel]) { assert.equal((await h.outcomes(r.id)).length, 2); await h.delivered(r.id, '2026-10-26T15:00:00.000Z') }
 await h.tick('2026-10-26T16:00:00.000Z')
 for (const r of [candidate, panel]) { const mail = (await h.outcomes(r.id)).at(-1); assert.equal(mail.purpose, 'escalation'); assert.equal(mail.content.to, 'owner@example.test'); await h.delivered(r.id, '2026-10-26T16:00:00.000Z') }
 await h.restart(); await h.tick('2026-10-26T17:00:00.000Z')
 assert.equal((await h.outcomes(candidate.id)).length, 3, 'no duplicate escalation after restart')
 const next = await h.command('interview', { application: h.application.id, planItem: h.job.plan[0].id, participants: ['ivy@example.test'], slots: ['2026-10-26T14:00:00.000Z'] })
 await h.command('schedule', { interview: next.id, slot: 0 })
 const score = await h.command('hiring-reminder', { ...h.input, interview: next.id, kind: 'scorecard', recipient: 'ivy@example.test', dueAt: '2026-10-26T17:00:00.000Z' })
 await h.tick('2026-10-26T17:00:00.000Z'); await h.delivered(score.id, '2026-10-26T17:00:00.000Z')
 await h.restart(); await h.tick('2026-10-26T18:00:00.000Z'); await h.delivered(score.id, '2026-10-26T18:00:00.000Z')
 await h.tick('2026-10-26T19:00:00.000Z'); await h.delivered(score.id, '2026-10-26T19:00:00.000Z')
 await h.command('scorecard', { application: h.application.id, interview: next.id, ratings: {}, evidence: {}, recommendation: 'yes', takeaways: 'Explained the published shift work.', submit: true }, h.ivy)
 await h.command('availability', { interview: h.interview.id, slots: [0] }, h.ivy)
 assert.equal((await h.send('/availability/' + h.interview.candidateToken, form({ slot: '0' }))).status, 200)
 await h.restart(); await h.tick('2026-10-27T14:00:00.000Z')
 assert.equal((await h.outcomes(score.id)).length, 3)
 assert.equal((await h.outcomes(candidate.id)).length, 3)
 assert.ok((await h.rows()).every(r => r.status === 'acknowledged'), 'completion is durable and stops every stale schedule')
 await h.reminders()
 return { h, candidate, panel, score }
}

export async function checkReminderStops(t) {
 const h = await reminderFixture({ bindings: { TEST_MAIL_REJECT_SUBJECT: 'synthetic-lodge-refused', TEST_MAIL_UNCERTAIN_SUBJECT: 'synthetic-lodge-uncertain' } }); t.after(() => h.close())
 const createInterview = async () => h.command('interview', { application: h.application.id, planItem: h.job.plan[0].id, participants: ['ivy@example.test'], slots: ['2026-11-04T15:00:00.000Z'] })
 const setup = async extra => { const iv = await createInterview(); return { iv, r: await h.command('hiring-reminder', { ...h.input, interview: iv.id, ...extra }) } }
 const candidateReply = await setup({})
 await h.send('/availability/' + candidateReply.iv.candidateToken, form({ slot: '0' })).then(r => assert.equal(r.status, 200))
 const panelReply = await setup({ recipient: 'ivy@example.test' })
 await h.command('interview-reply', { interview: panelReply.iv.id, answer: 'cannot-attend', note: 'Please rebook' }, h.ivy)
 const canceled = await setup({})
 await h.command('cancel-interview', { interview: canceled.iv.id, reason: 'Meeting canceled' })
 const explicit = await setup({})
 await h.command('cancel-hiring-reminder', { id: explicit.r.id, reason: 'Owner stopped outreach' })
 const rejected = await setup({ subject: 'synthetic-lodge-refused' })
 const uncertain = await setup({ subject: 'synthetic-lodge-uncertain' })
 const outsideHours = await setup({ dueAt: '2026-10-31T20:00:00.000Z' })
 assert.equal(outsideHours.r.nextDueAt, '2026-11-02T14:00:00.000Z', 'weekend window follows the daylight-saving change')
 await h.tick(clock)
 for (const { r } of [candidateReply, panelReply, canceled, explicit, outsideHours]) assert.equal((await h.outcomes(r.id)).length, 0)
 assert.equal((await h.outcomes(rejected.r.id))[0].status, 'failed')
 assert.equal((await h.outcomes(uncertain.r.id))[0].status, 'uncertain')
 await h.restart(); await h.tick('2026-10-26T15:00:00.000Z')
 assert.equal((await h.outcomes(rejected.r.id)).length, 1); assert.equal((await h.outcomes(uncertain.r.id)).length, 1)
 assert.ok((await h.rows()).filter(r => [rejected.r.id, uncertain.r.id].includes(r.id)).every(r => r.status === 'held'))
 const upcomingIv = await createInterview(); await h.command('schedule', { interview: upcomingIv.id, slot: 0 })
 const upcoming = await h.command('hiring-reminder', { ...h.input, interview: upcomingIv.id, kind: 'upcoming', dueAt: '2026-10-26T15:00:00.000Z', maxAttempts: 1 })
 await h.tick('2026-10-26T15:00:00.000Z'); await h.restart(); await h.tick('2026-10-26T16:00:00.000Z')
 assert.equal((await h.outcomes(upcoming.id)).length, 1)
 const reassigned = await setup({ dueAt: '2026-10-26T17:00:00.000Z' })
 await h.command('hiring-team', { id: h.job.id, coordinators: ['owner@example.test'] })
 await h.tick('2026-10-26T17:00:00.000Z')
 assert.equal((await h.outcomes(reassigned.r.id)).length, 0)
 assert.equal((await h.rows()).find(r => r.id === reassigned.r.id).status, 'canceled')
 const admin = await h.member('reminder-admin@example.test', ['admin'], 'Reminder reviewer')
 const revokedIv = await createInterview()
 const revoked = await h.command('hiring-reminder', { ...h.input, interview: revokedIv.id, dueAt: '2026-10-26T18:00:00.000Z', owner: 'reminder-admin@example.test' }, admin)
 await h.command('member', { email: 'reminder-admin@example.test', name: 'Reminder reviewer', roles: ['admin'], active: false })
 await h.tick('2026-10-26T18:00:00.000Z'); assert.equal((await h.outcomes(revoked.id)).length, 0)
 assert.equal((await h.rows()).find(r => r.id === revoked.id).status, 'canceled')
 const contact = await setup({ dueAt: '2026-10-26T18:00:00.000Z' })
 const person = (await h.state()).candidates.find(c => c.id === h.application.candidate)
 await h.command('correct-candidate', { ...person, email: 'new-jordan@example.test', reason: 'Corrected contact' })
 await h.tick('2026-10-26T18:00:00.000Z'); assert.equal((await h.outcomes(contact.r.id)).length, 0)
 const spanish = await h.submit(h.es, { name: 'Lucía Torres', email: 'lucia-reminders@example.test' })
 const spanishIv = await h.command('interview', { application: spanish.application, planItem: h.job.plan[0].id, participants: ['ivy@example.test'], slots: ['2026-11-04T15:00:00.000Z'] })
 await h.command('hiring-reminder', { ...h.input, interview: spanishIv.id, dueAt: '2026-10-26T18:00:00.000Z' }, h.owner, 409)
 await h.command('hiring-reminder', { ...h.input, interview: spanishIv.id, dueAt: '2026-10-26T18:00:00.000Z', language: 'es', reviewed: false }, h.owner, 400)
 const reviewed = { ...h.input, interview: spanishIv.id, dueAt: '2026-10-26T18:00:00.000Z', language: 'es', subject: 'Elija su horario de entrevista', body: 'Lucía, elija el horario para su entrevista.', footer: 'Example Builders, 10 Main Street, Nueva York. Responda para no recibir más correos.' }
 const competing = await Promise.all([h.send('/api/lodge/command/hiring-reminder', reviewed, h.owner), h.send('/api/lodge/command/hiring-reminder', reviewed, h.owner)])
 assert.deepEqual(competing.map(r => r.status).sort(), [200, 409], 'concurrent configuration cannot create duplicate cadences')
 const esReminder = competing.find(r => r.status === 200).value
 await h.tick('2026-10-26T18:00:00.000Z')
 assert.equal((await h.outcomes(esReminder.id))[0].content.subject, reviewed.subject)
 const invited = await h.send('/auth/invite', { email: 'lucia-reminders@example.test', displayName: 'Lucía Torres', role: 'member', returnTo: '/candidate' }, h.owner)
 assert.equal(invited.status, 202)
 const invitation = (await h.mails()).findLast(m => m.to.includes('lucia-reminders@example.test') && m.text.includes('/auth/confirm?token='))
 const token = new URL(invitation.text.match(/http:\/\/\S+\/auth\/confirm\?token=\S+/)[0]).searchParams.get('token')
 const confirmed = await h.send('/auth/confirm', { token })
 assert.equal(confirmed.status, 303)
 const preference = await h.send('/candidate/receipts/' + spanish.code + '/account/preferences', form({ preference: 'none', talentPool: '' }), confirmed.cookie)
 assert.equal(preference.status, 303)
 await h.tick('2026-10-26T19:00:00.000Z'); assert.equal((await h.outcomes(esReminder.id)).length, 1, 'candidate opt-out prevents the next reminder')
 const withdrawn = await setup({ dueAt: '2026-10-26T19:00:00.000Z' })
 await h.command('move', { application: h.application.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Candidate withdrew' })
 await h.tick('2026-10-26T19:00:00.000Z'); assert.equal((await h.outcomes(withdrawn.r.id)).length, 0)
 const exportResult = await h.send('/api/lodge/download/candidate/' + h.application.candidate, undefined, h.owner)
 assert.equal(exportResult.status, 200); assert.ok(exportResult.value.hiringReminders.length)
 const rows = (await h.db.prepare('SELECT * FROM l_records').all()).results
 const { policy, validateStaged } = await import('../scripts/installer/portability-policy.mjs')
 assert.equal(await validateStaged({ read: async table => table === 'l_records' ? rows : [] }), true)
 const archived = rows.filter(r => r.kind === 'hiring-reminder').map(r => JSON.parse(policy.exportRow('l_records', r).value))
 assert.ok(archived.every(r => r.status === 'withheld'), 'restored schedules require fresh exact review')
 await h.send('/api/lodge/delete-candidate', { candidate: h.application.candidate, confirm: person.name, reason: 'Requested' }, h.owner).then(r => assert.equal(r.status, 200))
 assert.ok((await h.rows()).every(r => r.candidate !== h.application.candidate), 'erasure removes frozen text and pending schedules')
}
