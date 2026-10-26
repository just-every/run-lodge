import assert from 'node:assert/strict'
import { applicationEmailFixture } from './application-email-flow.mjs'

export const scheduleClock = '2026-10-26T14:00:00.000Z'
export const scheduleApi = '/api/lodge/analysis/schedules'
export async function scheduleFixture(options = {}) {
  const h = await applicationEmailFixture({ clock: scheduleClock, ...options })
  try {
    const { application } = await h.command('candidate', { name: 'Synthetic scheduled chart person', email: 'synthetic.schedule.person@example.test', source: 'Referral', consentBasis: 'application', vacancy: h.job.id })
    const query = { metric: 'source_conversion', from: '2026-10-01', to: '2026-10-31', jobs: [h.job.id], sources: [], groupBy: 'source', chart: 'bar' }
    const saved = await h.send('/api/lodge/analysis/save', { title: 'Reviewed source conversion', query }, h.owner)
    assert.equal(saved.status, 201, saved.text)
    const chart = saved.value.chart
    const prepare = async (dueAt, cookie = h.owner, chartId = chart.id) => {
      const response = await h.send(scheduleApi + '/preview', { chart: chartId, dueAt }, cookie)
      assert.equal(response.status, 200, response.text)
      return response.value
    }
    const enable = async (dueAt, cookie = h.owner, chartId = chart.id) => {
      const draft = await prepare(dueAt, cookie, chartId)
      const response = await h.send(scheduleApi, { chart: chartId, dueAt, reviewKey: draft.reviewKey, reviewed: true, enabled: true }, cookie)
      assert.equal(response.status, 201, response.text)
      return response.value.schedule
    }
    const rows = async (cookie = h.owner) => {
      const response = await h.send(scheduleApi, undefined, cookie)
      assert.equal(response.status, 200, response.text)
      return response.value.schedules
    }
    const scheduleMails = async () => (await h.mails()).filter(m => m.subject === 'Lodge: scheduled recruiting analysis')
    const tick = async at => { await h.setTime(at); await h.mf.getWorker().then(w => w.scheduled({ scheduledTime: Date.parse(at), cron: '0 * * * *' })) }
    return Object.assign(h, { application, query, chart, prepare, enable, rows, scheduleMails, tick })
  } catch (error) { await h.close(); throw error }
}

export async function checkAnalysisSchedules(t) {
  const h = await scheduleFixture(); t.after(() => h.close())
  const manager = await h.member('schedule-manager@example.test', ['manager'], 'Schedule manager')
  assert.equal((await h.send(scheduleApi)).status, 401)
  assert.equal((await h.send(scheduleApi, undefined, manager)).status, 403)
  const dueAt = '2026-10-26T15:00:00.000Z'
  const draft = await h.prepare(dueAt)
  assert.equal(draft.preview.recipient, 'owner@example.test')
  assert.deepEqual(draft.preview.query, h.query)
  assert.equal((await h.rows()).length, 0, 'preview creates no enabled work')
  assert.equal((await h.scheduleMails()).length, 0)
  assert.equal((await h.send(scheduleApi, { chart: h.chart.id, dueAt, reviewKey: draft.reviewKey, reviewed: true }, h.owner)).status, 400)
  assert.equal((await h.send(scheduleApi, { chart: h.chart.id, dueAt, reviewKey: draft.reviewKey, reviewed: true, enabled: true, recipient: 'other@example.test' }, h.owner)).status, 400)
  assert.equal((await h.send(scheduleApi, { chart: h.chart.id, dueAt: '2026-10-26T16:00:00.000Z', reviewKey: draft.reviewKey, reviewed: true, enabled: true }, h.owner)).status, 409)
  const input = { chart: h.chart.id, dueAt, reviewKey: draft.reviewKey, reviewed: true, enabled: true }
  const enabled = await h.send(scheduleApi, input, h.owner)
  assert.equal(enabled.status, 201, enabled.text)
  const schedule = enabled.value.schedule
  assert.equal((await h.send(scheduleApi, input, h.owner)).value.schedule.id, schedule.id, 'duplicate confirmation is idempotent')
  await h.tick('2026-10-26T14:59:59.000Z')
  assert.equal((await h.scheduleMails()).length, 0, 'early scheduler cannot send')
  const extra = await h.command('candidate', { name: 'Synthetic person added after review', email: 'synthetic.schedule.later@example.test', source: 'Careers page', consentBasis: 'application', vacancy: h.job.id })
  await h.command('move', { application: extra.application.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Requested erasure before due delivery' })
  assert.equal((await h.send('/api/lodge/delete-candidate', { candidate: extra.candidate.id, confirm: extra.candidate.name, reason: 'Requested erasure' }, h.owner)).status, 200)
  const expected = await h.send('/api/lodge/analysis/saved/' + h.chart.id, undefined, h.owner)
  assert.equal(expected.status, 200, expected.text)
  await h.restart(); await h.setTime(dueAt)
  await Promise.all([1, 2].map(() => h.mf.getWorker().then(w => w.scheduled({ scheduledTime: Date.parse(dueAt), cron: '0 * * * *' }))))
  await h.restart(); await h.tick('2026-10-26T15:01:00.000Z')
  const mails = await h.scheduleMails()
  assert.equal(mails.length, 1, 'concurrent and restarted cron sends only once')
  assert.deepEqual(mails[0].to, ['owner@example.test'])
  assert.equal(mails[0].replyTo, 'recruiting@example.test')
  assert.ok(mails[0].text.includes('Denominator: ' + expected.value.result.total.denominator), 'aggregate is recomputed without erased rows')
  for (const secret of [h.application.id, extra.application.id, 'Synthetic scheduled chart person', 'synthetic.schedule.person@example.test', 'Synthetic person added after review']) assert.ok(!mails[0].text.includes(secret), 'email contains no candidate detail or retained evidence snapshot')
  assert.ok(mails[0].text.includes(h.origin + '/analysis/saved/' + h.chart.id))
  assert.equal((await h.rows()).find(r => r.id === schedule.id).status, 'handed')
  const canceled = await h.enable('2026-10-26T16:00:00.000Z')
  assert.equal((await h.send(scheduleApi + '/' + canceled.id + '/cancel', {}, h.owner)).status, 200)
  await h.tick('2026-10-26T16:00:00.000Z')
  assert.equal((await h.scheduleMails()).length, 1)
  assert.equal((await h.rows()).find(r => r.id === canceled.id).status, 'canceled')
  const stale = await h.prepare('2026-10-26T17:00:00.000Z')
  const held = await h.enable('2026-10-26T18:00:00.000Z')
  await h.activate({ replyTo: 'new-recruiting@example.test' })
  assert.equal((await h.send(scheduleApi, { chart: h.chart.id, dueAt: stale.preview.dueAt, reviewKey: stale.reviewKey, reviewed: true, enabled: true }, h.owner)).status, 409)
  await h.tick('2026-10-26T18:00:00.000Z')
  assert.equal((await h.rows()).find(r => r.id === held.id).status, 'withheld')
  assert.equal((await h.scheduleMails()).length, 1)

  const adminEmail = 'schedule-admin@example.test', admin = await h.member(adminEmail, ['admin'], 'Schedule admin')
  const adminChart = await h.send('/api/lodge/analysis/save', { title: 'Admin source conversion', query: h.query }, admin)
  assert.equal(adminChart.status, 201, adminChart.text)
  assert.equal((await h.send(scheduleApi + '/preview', { chart: h.chart.id, dueAt: '2026-10-26T19:00:00.000Z' }, admin)).status, 404)
  const revoked = await h.enable('2026-10-26T19:00:00.000Z', admin, adminChart.value.chart.id)
  assert.ok(!(await h.rows()).some(row => row.id === revoked.id), 'queue is private to its author')
  await h.command('member', { email: adminEmail, name: 'Schedule admin', roles: ['admin'], active: false })
  await h.tick('2026-10-26T19:00:00.000Z')
  const record = await h.db.prepare("SELECT value FROM l_records WHERE kind='analysis-schedule' AND id=?").bind(revoked.id).first()
  assert.equal(JSON.parse(record.value).status, 'withheld')
  assert.equal((await h.scheduleMails()).length, 1)

  const uncertain = await scheduleFixture({ bindings: { TEST_MAIL_UNCERTAIN_SUBJECT: 'Lodge: scheduled recruiting analysis' } }); t.after(() => uncertain.close())
  const ambiguous = await uncertain.enable(dueAt)
  await uncertain.tick(dueAt); await uncertain.restart(); await uncertain.tick('2026-10-26T16:00:00.000Z')
  assert.equal((await uncertain.rows()).find(r => r.id === ambiguous.id).status, 'uncertain')
  assert.equal((await uncertain.scheduleMails()).length, 0, 'ambiguous provider acceptance is held without a blind resend')
}
