import assert from 'node:assert/strict'
import { applicationEmailFixture } from './application-email-flow.mjs'

export const weeklyApi = '/api/lodge/reports/weekly'
export const weeklySubject = 'Lodge: weekly source and funnel report'
export async function weeklyFixture(options = {}) {
  const h = await applicationEmailFixture({ clock: '2026-10-26T14:00:00.000Z', ...options })
  try {
    const command = h.command, state = h.state
    h.command = (op, body, cookie = h.owner, status = 200) => command(op, body, cookie, status)
    h.state = (cookie = h.owner) => state(cookie)
    const person = await h.command('candidate', { name: 'Synthetic weekly candidate', email: 'synthetic.weekly@example.test', source: 'Referral', consentBasis: 'application', vacancy: h.job.id })
    await h.command('move', { application: person.application.id, to: h.job.stages[1].id, reason: 'Reviewed application' })
    const spec = { jobs: [h.job.id], recipients: ['owner@example.test'], firstDate: '2026-11-02', clock: '09:00' }
    const prepare = async (extra = {}, cookie = h.owner) => {
      const result = await h.send(weeklyApi + '/preview', { ...spec, ...extra }, cookie)
      assert.equal(result.status, 200, result.text)
      return result.value
    }
    const enable = async (extra = {}, cookie = h.owner) => {
      const input = { ...spec, ...extra }, draft = await prepare(extra, cookie)
      const result = await h.send(weeklyApi, { ...input, reviewKey: draft.reviewKey, reviewed: true, enabled: true }, cookie)
      assert.equal(result.status, 201, result.text)
      return result.value.schedule
    }
    const rows = async () => { const result = await h.send(weeklyApi, undefined, h.owner); assert.equal(result.status, 200, result.text); return result.value.schedules }
    const mails = async () => (await h.mails()).filter(m => m.subject === weeklySubject)
    const tick = async at => { await h.setTime(at); await h.mf.getWorker().then(w => w.scheduled({ scheduledTime: Date.parse(at), cron: '0 * * * *' })); h.owner = await h.signIn('owner@example.test') }
    return Object.assign(h, { person, spec, prepare, enable, rows, reportMails: mails, tick })
  } catch (error) { await h.close(); throw error }
}
export async function checkWeeklyReports(t) {
  const h = await weeklyFixture(); t.after(() => h.close())
  const managerEmail = 'weekly-manager@example.test', managerInitial = await h.member(managerEmail, ['manager'])
  let manager = managerInitial
  const revokedEmail = 'weekly-revoked@example.test'; await h.member(revokedEmail, ['manager'])
  const adminEmail = 'weekly-admin@example.test', admin = await h.member(adminEmail, ['admin'])
  await h.command('hiring-team', { id: h.job.id, recruiters: [managerEmail, revokedEmail], coordinators: [], hiringManagers: ['owner@example.test'] })
  assert.equal((await h.send(weeklyApi)).status, 401)
  assert.equal((await h.send(weeklyApi, undefined, manager)).status, 403)
  assert.equal((await h.send(weeklyApi + '/preview', { ...h.spec, channel: 'slack' }, h.owner)).status, 409)
  assert.equal((await h.send(weeklyApi + '/preview', { ...h.spec, recipients: ['outside@example.test'] }, h.owner)).status, 403)
  const recipients = ['owner@example.test', managerEmail, revokedEmail, adminEmail]
  const draft = await h.prepare({ recipients })
  assert.equal(draft.preview.dueAt, '2026-11-02T14:00:00.000Z', 'local nine follows the daylight-saving transition')
  assert.deepEqual(draft.samples[0].report.period, { from: '2026-10-26', to: '2026-11-01' })
  assert.equal(draft.samples[0].report.start, '2026-10-26T04:00:00.000Z')
  assert.equal(draft.samples[0].report.endExclusive, '2026-11-02T05:00:00.000Z', 'seven local days cross the 169-hour week')
  assert.equal((await h.rows()).length, 0)
  assert.equal((await h.reportMails()).length, 0)
  assert.equal((await h.send(weeklyApi, { ...h.spec, recipients, reviewed: true, enabled: true, reviewKey: 'stale' }, h.owner)).status, 409)
  const schedule = await h.enable({ recipients })
  assert.equal((await h.enable({ recipients })).id, schedule.id)
  // Private rows count for the owner but stay out of each less privileged recipient's own projection.
  const privatePerson = await h.command('candidate', { name: 'Synthetic private weekly candidate', email: 'synthetic.private.weekly@example.test', source: 'Referral', consentBasis: 'application', vacancy: h.job.id, private: true })
  await h.command('candidate-privacy', { id: privatePerson.candidate.id, private: true })
  // Repeated stage entry counts once for that stage; an unvisited stage is not inferred.
  await h.command('move', { application: h.person.application.id, to: h.job.stages[2].id, reason: 'Review' })
  await h.command('move', { application: h.person.application.id, to: h.job.stages[1].id, reason: 'Review again' })
  await h.command('member', { email: revokedEmail, name: 'Revoked recipient', roles: ['manager'], active: false })
  await h.tick('2026-11-02T13:59:59.999Z')
  assert.equal((await h.reportMails()).length, 0)
  await h.restart(); await h.setTime('2026-11-02T14:00:00.000Z')
  await Promise.all([1, 2].map(() => h.mf.getWorker().then(w => w.scheduled({ scheduledTime: Date.parse('2026-11-02T14:00:00.000Z'), cron: '0 * * * *' }))))
  await h.restart(); await h.tick('2026-11-02T14:01:00.000Z')
  manager = await h.signIn(managerEmail)
  const mails = await h.reportMails()
  assert.equal(mails.length, 3, 'each eligible native recipient gets one provider request across concurrency and restart')
  assert.ok(!mails.some(m => m.to.includes(revokedEmail)))
  for (const m of mails) for (const hidden of [h.person.candidate.name, privatePerson.candidate.name, h.person.application.id, privatePerson.application.id, 'synthetic.private.weekly@example.test']) assert.ok(!m.text.includes(hidden), 'no candidate evidence is emailed')
  const outcome = (await h.rows()).find(row => row.id === schedule.id)
  assert.equal(outcome.nextDate, '2026-11-09')
  assert.equal(outcome.attempts.find(a => a.recipient === revokedEmail).status, 'withheld')
  const own = outcome.attempts.find(a => a.recipient === 'owner@example.test'), scoped = outcome.attempts.find(a => a.recipient === managerEmail)
  assert.equal(own.status, 'handed')
  const ownReport = await h.send(weeklyApi + '/open/' + own.id, undefined, h.owner)
  const scopedReport = await h.send(weeklyApi + '/open/' + scoped.id, undefined, manager)
  assert.equal(ownReport.status, 200, ownReport.text); assert.equal(scopedReport.status, 200, scopedReport.text)
  assert.equal(ownReport.value.source.total.denominator, 2)
  assert.equal(scopedReport.value.source.total.denominator, 1)
  assert.deepEqual(scopedReport.value.funnel.jobs[0].stages.map(s => s.numerator), [1, 1, 1, ...h.job.stages.slice(3).map(() => 0)])
  assert.equal((await h.send(weeklyApi + '/open/' + own.id, undefined, manager)).status, 404)
  assert.equal((await h.send('/reports/weekly/open/' + own.id + '?download=1')).status, 401)
  // Loss of the job and of custom export permission refuses both opening and future sending.
  const level = await h.command('permission-level', { name: 'Weekly without export', permissions: ['contact', 'move'] })
  await h.command('job-levels', { id: h.job.id, members: { [managerEmail]: level.id }, roles: {} })
  assert.equal((await h.send(weeklyApi + '/open/' + scoped.id, undefined, manager)).status, 403)
  const canceled = await h.enable({ firstDate: '2026-11-03' })
  assert.equal((await h.send(weeklyApi + '/' + canceled.id + '/cancel', {}, h.owner)).status, 200)
  await h.tick('2026-11-03T14:00:00.000Z')
  assert.equal((await h.reportMails()).length, 3)
  await h.tick('2026-11-09T14:00:00.000Z')
  assert.equal((await h.reportMails()).length, 5, 'revoked and custom-level recipients remain withheld; new period sends to eligible people')
  const second = (await h.rows()).find(row => row.id === schedule.id).attempts.find(a => a.date === '2026-11-09' && a.recipient === 'owner@example.test')
  assert.equal((await h.send(weeklyApi + '/open/' + second.id, undefined, h.owner)).value.source.total.denominator, 0, 'period rolls forward instead of replaying the previous cohort')
  const held = await h.enable({ firstDate: '2026-11-10' })
  await h.activate({ replyTo: 'changed@example.test' })
  await h.tick('2026-11-10T14:00:00.000Z')
  assert.equal((await h.rows()).find(r => r.id === held.id).attempts[0].status, 'withheld')

  await h.command('job-levels', { id: h.job.id, members: {}, roles: {} })
  await h.command('hiring-team', { id: h.job.id, hiringManagers: ['owner@example.test'], recruiters: [], coordinators: [] })
  assert.equal((await h.send(weeklyApi + '/open/' + scoped.id, undefined, await h.signIn(managerEmail))).status, 403, 'lost job grant refuses a previously received drill link')
  const confidential = await h.enable({ firstDate: '2026-11-11', recipients: [adminEmail] })
  await h.command('vacancy-privacy', { id: h.job.id, confidential: true, namedPeople: [], publicTitle: 'Confidential vacancy' })
  await h.tick('2026-11-11T14:00:00.000Z')
  assert.equal((await h.rows()).find(r => r.id === confidential.id).attempts[0].status, 'withheld', 'confidential access is rechecked at send')
  await h.command('vacancy-privacy', { id: h.job.id, confidential: false })
  const authorCookie = await h.signIn(adminEmail), authored = await h.enable({ firstDate: '2026-11-12' }, authorCookie)
  const adminAttempt = outcome.attempts.find(a => a.recipient === adminEmail)
  assert.equal((await h.send(weeklyApi + '/open/' + adminAttempt.id, undefined, authorCookie)).status, 200)
  await h.command('member', { email: adminEmail, name: 'Revoked author', roles: ['admin'], active: false })
  assert.equal((await h.send(weeklyApi + '/open/' + adminAttempt.id, undefined, authorCookie)).status, 403, 'a still-valid native session cannot open a report after membership revocation')
  await h.tick('2026-11-12T14:00:00.000Z')
  const authorAttempts = await h.db.prepare("SELECT value FROM l_records WHERE kind='weekly-report-attempt' AND json_extract(value,'$.schedule')=?").bind(authored.id).all()
  assert.equal(JSON.parse(authorAttempts.results[0].value).status, 'withheld')
  await h.command('move', { application: privatePerson.application.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Requested erasure' })
  assert.equal((await h.send('/api/lodge/delete-candidate', { candidate: privatePerson.candidate.id, confirm: privatePerson.candidate.name, reason: 'Requested erasure' }, h.owner)).status, 200)
  assert.equal((await h.send(weeklyApi + '/open/' + own.id, undefined, h.owner)).value.source.total.denominator, 1, 'old links recompute after erasure rather than preserving a snapshot')
  const spring = await h.prepare({ firstDate: '2027-03-14', clock: '02:30' })
  assert.equal(spring.preview.dueAt, '2027-03-14T07:00:00.000Z', 'a missing local time advances to the first valid minute')
  const autumn = await h.prepare({ firstDate: '2027-11-07', clock: '01:30' })
  assert.equal(autumn.preview.dueAt, '2027-11-07T05:30:00.000Z', 'a repeated local time selects its first occurrence')

  const uncertain = await weeklyFixture({ bindings: { TEST_MAIL_UNCERTAIN_SUBJECT: weeklySubject } }); t.after(() => uncertain.close())
  const ambiguous = await uncertain.enable()
  await uncertain.tick('2026-11-02T14:00:00.000Z'); await uncertain.restart(); await uncertain.tick('2026-11-09T14:00:00.000Z')
  const uncertainRows = (await uncertain.rows()).find(r => r.id === ambiguous.id).attempts
  assert.equal(uncertainRows.length, 1); assert.equal(uncertainRows[0].status, 'uncertain')
  assert.equal((await uncertain.reportMails()).length, 0)
  const rejected = await weeklyFixture({ bindings: { TEST_MAIL_REJECT_SUBJECT: weeklySubject } }); t.after(() => rejected.close())
  const refusal = await rejected.enable()
  await rejected.tick('2026-11-02T14:00:00.000Z'); await rejected.restart(); await rejected.tick('2026-11-09T14:00:00.000Z')
  const rejectedRows = (await rejected.rows()).find(r => r.id === refusal.id).attempts
  assert.equal(rejectedRows.length, 1); assert.equal(rejectedRows[0].status, 'failed')
  assert.equal((await rejected.reportMails()).length, 0, 'definite provider refusal is distinct from uncertainty and is not blindly retried')
}
