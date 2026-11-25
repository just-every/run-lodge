// Read budget: a month of a small company's history must not change what the
// hourly cron, the document viewer's 2-second access poll or the public careers
// page cost in D1 rows read. Workers Free allows 5,000,000 rows read a day for the
// whole account. Rows come from D1's own per-statement meta.rows_read.
import assert from 'node:assert/strict'
import { harness, BUSINESS } from './harness.mjs'
import { RANGE, RUBRIC } from './hiring-fixture.mjs'

const MONTH = 30 * 86400000
const ago = (ms, at) => new Date(at - ms).toISOString()

/** Thirty days of ordinary history, written as the records the real flows leave behind. */
async function seedHistory(db, { application, vacancy, candidate, stage }, at) {
  const rows = []
  const add = (kind, id, value) => rows.push(db.prepare('INSERT INTO l_records(kind,id,revision,value) VALUES(?,?,?,?)').bind(kind, id, 'seed', JSON.stringify({ ...value, id })))
  for (let i = 0; i < 600; i++) add('application-email', 'h' + i, { kind: 'status', status: 'handed', application: 'a' + (i % 200), vacancy, candidate: 'c' + (i % 200), at: ago(i * 4000000, at), finishedAt: ago(i * 4000000, at) })
  for (let i = 0; i < 300; i++) add('alert', 'h' + i, { to: 'owner@example.test', event: 'stage', emailState: i % 5 ? 'handed' : 'not-sent', at: ago(i * 8000000, at) })
  for (let i = 0; i < 100; i++) add('referral-email', 'h' + i, { to: 'owner@example.test', kind: 'job', emailState: 'handed', at: ago(i * 20000000, at) })
  for (let i = 0; i < 1500; i++) add('audit', 'h' + i, { at: ago(i * 1700000, at), actor: 'owner', email: 'owner@example.test', action: 'note-added', record: 'application:a' + (i % 200) })
  for (let i = 0; i < 200; i++) add('candidate', 'c' + i, { name: 'Candidate ' + i, email: `c${i}@example.test`, source: 'Careers page' })
  for (let i = 0; i < 200; i++) add('application', 'a' + i, { candidate: 'c' + i, vacancy, stage, status: 'rejected', at: ago(i * 12000000, at) })
  for (let i = 0; i < 400; i++) add('stage-event', 'h' + i, { application: 'a' + (i % 200), at: ago(i * 6000000, at), to: stage })
  // Work that exists but is not yet due: delayed status mail, tomorrow's digest, next week's report.
  for (let i = 0; i < 3; i++) add('application-email', 'p' + i, { kind: 'status', status: 'pending', application: application.id, vacancy, candidate, stage: application.stage, dueAt: new Date(at + 5 * 86400000).toISOString(), at: ago(0, at) })
  for (let i = 0; i < 5; i++) add('alert', 'd' + i, { to: 'owner@example.test', event: 'stage', emailState: 'digest', digestAt: new Date(at + 20 * 3600000).toISOString(), at: ago(0, at) })
  add('weekly-report', 'w1', { enabled: true, status: 'scheduled', author: 'x', recipients: [], nextDate: '2099-01-01', clock: '09:00', zone: 'America/New_York', jobs: [] })
  add('analysis-schedule', 's1', { status: 'pending', enabled: true, dueAt: new Date(at + 3 * 86400000).toISOString() })
  for (let i = 0; i < rows.length; i += 400) await db.batch(rows.slice(i, i + 400))
  return rows.length
}

export async function checkD1Reads(t) {
  const h = await harness({ inbound: true, bindings: { TEST_D1_METER: '1' } })
  t.after(() => h.close())
  const { command: cmd, send } = h
  await cmd('business', BUSINESS)
  const manager = await h.member('morgan@example.test', ['manager'], 'Morgan Lee')
  const approver = await h.member('parker@example.test', ['approver'], 'Parker Jones')
  const draft = await cmd('vacancy', { title: 'Site supervisor', location: 'Denver, CO', headcount: 1, compensation: RANGE, manager: 'morgan@example.test' }, manager)
  const v = await cmd('rubric', { id: draft.id, criteria: RUBRIC }, manager)
  await cmd('interview-plan', { id: v.id, plan: [{ name: 'Floor walk', stage: v.stages[2].id }] }, manager)
  const approval = await cmd('request-vacancy-approval', { id: v.id, approver: 'parker@example.test' }, manager)
  const version = (await h.state(approver)).approvals.find(x => x.id === approval.id).currentVersion
  await cmd('decide-approval', { id: approval.id, decision: 'approved', reason: 'Within budget', version }, approver)
  const job = await cmd('publish', { id: v.id }, manager)
  const { application } = await cmd('candidate', { name: 'Riley Park', email: 'riley@example.test', source: 'Referral', consentBasis: 'referral', vacancy: job.id }, manager)
  const doc = await cmd('document', { application: application.id, kind: 'resume', name: 'riley.txt', base64: Buffer.from('Riley Park, site supervisor').toString('base64') }, manager)

  const seeded = await seedHistory(h.db, { application, vacancy: job.id, candidate: application.candidate, stage: application.stage }, Date.now())
  const meter = async (reset = true) => (await send('/__test/d1-meter' + (reset ? '?reset=1' : ''))).value
  const cost = async work => { await meter(); await work(); return meter() }
  const worker = await h.mf.getWorker()

  // Any tick of the hourly cron, on a company with thirty days of history and nothing due.
  const cron = await cost(() => worker.scheduled({ scheduledTime: Date.now(), cron: '0 * * * *' }))
  const cronLater = await cost(() => worker.scheduled({ scheduledTime: Date.now() + 3 * 3600000, cron: '0 * * * *' }))

  // The viewer's two-second access poll: proved once, then answered from the write counter.
  const pollUrl = '/api/lodge/view/document/' + doc.id + '?access=1'
  const poll = (token, cookie = manager) => send(pollUrl, undefined, cookie, token ? { 'x-lodge-access': token } : {})
  let first
  const proving = await cost(async () => { first = await poll(); assert.equal(first.status, 204) })
  const token = first.headers.get('x-lodge-access')
  assert.ok(token, 'the first check hands back the token that names it')
  const repeat = await cost(async () => assert.equal((await poll(token)).status, 204))

  // Public careers pages.
  const jobs = await cost(async () => assert.equal((await send('/jobs')).status, 200))
  const posting = await cost(async () => assert.match((await send('/jobs/' + job.slug)).text, /Site supervisor/))

  const reads = { seeded, cron: cron.rows, cronLater: cronLater.rows, proving: proving.rows, repeat: repeat.rows, jobs: jobs.rows, posting: posting.rows }
  console.log(JSON.stringify({ d1ReadBudget: reads }))
  // History here is 3,300 records; the ceilings are far under what a full load of them costs (about 3,300 rows each).
  assert.ok(cron.rows <= 100 && cronLater.rows <= 100, 'a quiet hourly run reads a handful of rows, not the store: ' + JSON.stringify(cron.top))
  assert.ok(repeat.rows <= 30, 'an unchanged viewer poll reads the session and the write counter: ' + repeat.rows)
  assert.ok(jobs.rows <= 300 && posting.rows <= 300, 'careers pages read the roles, not the applicants: ' + jobs.rows + ' ' + posting.rows)

  // The token is no shortcut: it proves nothing for another reader, another document, or after a write.
  const ivy = await h.member('ivy@example.test', ['interviewer'], 'Ivy Chen')
  assert.equal((await poll(token, ivy)).status, 404, 'another reader cannot use a token they were not given')
  assert.equal((await poll('forged-' + token, manager)).status, 204, 'an unknown token falls back to the full check')
  assert.equal((await send('/api/lodge/view/document/other-document?access=1', undefined, manager, { 'x-lodge-access': token })).status, 404, 'a token names one document')
  await cmd('member', { email: 'morgan@example.test', name: 'Morgan Lee', roles: ['manager'], active: false })
  assert.equal((await poll(token)).status, 403, 'any write retires the token: a reader whose access ended is refused on their next poll')
}
