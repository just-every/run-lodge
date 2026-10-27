import assert from 'node:assert/strict'
import { businessHarness } from './harness.mjs'
import { RANGE, RUBRIC } from './hiring-fixture.mjs'
import { zip } from './zip.mjs'

export const cohortApi = '/api/lodge/reports/cohort'
export async function cohortFixture() {
  // Native session expiry is fenced by D1's real clock; only recruiting events use the fixed fixture dates below.
  const h = await businessHarness({ clock: new Date().toISOString() })
  try {
    const managerEmail = 'synthetic-lodge-manager@example.test'
    const manager = await h.member(managerEmail, ['manager'])
    const interviewer = await h.member('synthetic-lodge-panel@example.test', ['interviewer'])
    const admin = await h.member('synthetic-lodge-admin@example.test', ['admin'])
    const approve = async request => h.command('decide-approval', { id: request.id, version: (await h.state()).approvals.find(a => a.id === request.id).currentVersion, decision: 'approved', reason: 'Reviewed exact terms' })
    const openJob = async (title, email = managerEmail) => {
      const job = await h.command('vacancy', { title, location: 'New York, NY', headcount: 1, compensation: RANGE, manager: 'owner@example.test' })
      await h.command('rubric', { id: job.id, criteria: RUBRIC })
      await h.command('interview-plan', { id: job.id, plan: [{ name: 'Work review', stageName: 'Interview' }] })
      await approve(await h.command('request-vacancy-approval', { id: job.id, approver: 'owner@example.test' }))
      if (email === managerEmail) await h.command('hiring-team', { id: job.id, hiringManagers: [managerEmail] })
      return h.command('publish', { id: job.id })
    }
    const jobA = await openJob('Synthetic cohort north'), jobB = await openJob('Synthetic cohort south')
    const hiddenJob = await openJob('Synthetic restricted cohort', 'owner@example.test')
    let number = 0
    const add = async (name, vacancy = jobA.id) => (await h.command('candidate', { name, email: 'synthetic-lodge-' + ++number + '@example.test', source: 'Careers page', consentBasis: 'application', vacancy })).application
    await h.setTime('2026-10-02T03:30:00.000Z')
    const hireA = await add('Synthetic first hire'), hidden = await add('Synthetic hidden person', hiddenJob.id)
    const privateApp = await add('Synthetic private person')
    await h.command('candidate-privacy', { id: privateApp.candidate, private: true })
    await h.setTime('2026-10-03T14:00:00.000Z')
    const hireB = await add('Synthetic second hire', jobB.id)
    const rejected = await add('Synthetic rejected'), withdrawn = await add('Synthetic withdrawn', jobB.id)
    const reopened = await add('Synthetic reopened'), spam = await add('Synthetic spam')
    const close = (app, to, closeReason) => h.command('move', { application: app.id, to, closeReason, reason: 'Recorded close' })
    const reopen = app => h.command('reopen', { application: app.id, to: jobA.stages[0].id, reason: 'Human reopened application' })
    await close(hireA, 'rejected', 'skills'); await close(rejected, 'rejected', 'skills'); await close(reopened, 'withdrawn', 'other-offer')
    await h.setTime('2026-10-04T14:00:00.000Z')
    await reopen(hireA); await reopen(rejected); await reopen(reopened)
    await close(rejected, 'rejected', 'certification'); await close(withdrawn, 'withdrawn', 'pay')
    await h.command('mark-spam', { application: spam.id, reason: 'Bot submission' })
    const hire = async (app, job, at) => {
      const opening = (await h.state()).vacancies.find(v => v.id === job.id).openings[0]
      const offer = await h.command('offer', { application: app.id, opening: opening.id, title: job.title, startDate: '2026-11-01', salary: { currency: 'USD', amount: 9500000, period: 'year' } })
      await approve(await h.command('request-offer-approval', { id: offer.id, approver: 'owner@example.test' }))
      await h.setTime(at)
      await h.command('offer-outcome', { id: offer.id, outcome: 'accepted', reason: 'Recorded acceptance' })
    }
    await hire(hireB, jobB, '2026-10-07T14:00:00.000Z')
    await hire(hireA, jobA, '2026-10-11T04:30:00.000Z')
    return Object.assign(h, { manager, managerEmail, interviewer, admin, jobA, jobB, hiddenJob, hireA, hireB, rejected, withdrawn, reopened, hidden, privateApp, spam })
  } catch (error) { await h.close(); throw error }
}

export async function checkCohortReport(t) {
  const h = await cohortFixture(); t.after(() => h.close())
  const read = async (query = '', who = h.manager, path = cohortApi) => {
    const result = await h.send(path + query, undefined, who)
    assert.equal(result.status, 200, result.text)
    return result.value
  }
  const rows = report => report.rows.map(r => r.application).sort()
  const expected = [h.hireA.id, h.hireB.id, h.rejected.id, h.withdrawn.id, h.reopened.id].sort()
  let report = await read()
  assert.deepEqual(rows(report), expected, 'scope before aggregation excludes another job, private candidates and spam')
  assert.deepEqual(report.totals, { applications: 5, statuses: { active: 1, rejected: 1, withdrawn: 1, transferred: 0, hired: 2, imported: 0 }, measuredHires: 2, meanDaysToHire: 7 })
  assert.deepEqual(report.rows.filter(r => r.status === 'hired').map(r => [r.application, r.daysToHire]).sort(), [[h.hireA.id, 10], [h.hireB.id, 4]].sort())
  assert.equal(report.rows.find(r => r.application === h.hireA.id).submittedAt, '2026-10-02T03:30:00.000Z', 'reopening preserves original submission')
  assert.deepEqual(report.reasons.map(r => [r.status, r.reason, r.count]).sort(), [['rejected', 'certification', 1], ['withdrawn', 'pay', 1]])
  assert.deepEqual(report.rows.filter(r => r.status === 'active').map(r => [r.application, r.closeReason]), [[h.reopened.id, null]], 'an earlier close on an active reopened application is not counted')
  assert.deepEqual((await read('?timeZone=UTC')).totals.meanDaysToHire, 6.5, 'calendar days follow the selected business zone, not elapsed 24-hour periods')
  assert.deepEqual(rows(await read('?from=2026-10-01&to=2026-10-01')), [h.hireA.id])
  assert.equal((await read('?from=2026-10-01&to=2026-10-01&timeZone=UTC')).totals.applications, 0)
  assert.deepEqual(rows(await read('?vacancy=' + h.jobB.id)), [h.hireB.id, h.withdrawn.id].sort())
  for (const query of ['?from=2026-02-30', '?from=2026-10-10&to=2026-10-01', '?timeZone=Unknown', '?history=unknown']) assert.equal((await h.send(cohortApi + query, undefined, h.manager)).status, 400)
  assert.equal((await h.send(cohortApi)).status, 401)
  for (const path of [cohortApi, cohortApi + '/' + h.hireA.id, '/api/lodge/download/cohort']) assert.equal((await h.send(path, undefined, h.interviewer)).status, 403)
  assert.equal((await h.send(cohortApi + '?vacancy=' + h.hiddenJob.id, undefined, h.manager)).status, 404)
  assert.equal((await h.send(cohortApi + '/' + h.hidden.id, undefined, h.manager)).status, 404)
  const detail = await read('/' + h.hireA.id)
  assert.deepEqual([detail.daysToHire, detail.submittedAt, detail.acceptedAt], [10, '2026-10-02T03:30:00.000Z', '2026-10-11T04:30:00.000Z'])
  const exported = await read('', h.manager, '/api/lodge/download/cohort')
  assert.deepEqual(exported, report, 'export uses the same authorized cohort, definitions and denominators')
  const audit = await h.send('/api/lodge/audit?action=cohort-report-exported', undefined, h.owner)
  assert.equal(audit.value.events.length, 1)
  // Legacy accepted offers may have incomplete or corrupt timing; never invent a duration.
  const stored = await h.db.prepare("SELECT id,value FROM l_records WHERE kind='offer' AND json_extract(value,'$.application')=?").bind(h.hireB.id).first()
  for (const outcomeAt of [null, '2026-02-30T14:00:00Z', '2026-10-01T14:00:00Z']) {
    await h.db.prepare("UPDATE l_records SET value=? WHERE kind='offer' AND id=?").bind(JSON.stringify({ ...JSON.parse(stored.value), outcomeAt }), stored.id).run()
    const incomplete = await read()
    assert.deepEqual([incomplete.totals.measuredHires, incomplete.totals.meanDaysToHire, incomplete.disclosures.incompleteHireTiming], [1, 10, 1])
    assert.equal(incomplete.rows.find(r => r.application === h.hireB.id).daysToHire, null)
  }
  await h.db.prepare("UPDATE l_records SET value=? WHERE kind='offer' AND id=?").bind(stored.value, stored.id).run()


  // A documented-shape Workable package with one dated and one undated original application.
  const pkg = { filename: 'synthetic-lodge-history.zip', base64: zip([
    { name: 'jobs.csv', bytes: Buffer.from('id,title,state,created_at\n8001,Synthetic imported cohort,archived,2026-09-01T12:00:00Z\n') },
    { name: 'candidates.csv', bytes: Buffer.from('id,name,email,created_at,stage,job,job_id,source\n9001,Synthetic undated,synthetic-lodge-91@example.test,,Applied,Synthetic imported cohort,8001,Careers page\n9002,Synthetic dated,synthetic-lodge-92@example.test,2026-10-03T12:00:00Z,Applied,Synthetic imported cohort,8001,Careers page\n') },
  ]).toString('base64') }
  const preview = await h.send('/api/lodge/import/preview', pkg, h.owner)
  assert.equal(preview.status, 200, preview.text)
  const imported = await h.send('/api/lodge/import/commit', { ...pkg, fingerprint: preview.value.plan.fingerprint }, h.owner)
  assert.equal(imported.status, 200, imported.text)
  report = await read('?history=imported', h.owner)
  assert.deepEqual([report.totals.applications, report.totals.statuses.imported, report.disclosures.missingSubmission], [2, 2, 1])
  assert.deepEqual(report.rows.map(r => [r.candidateName, r.submittedAt, r.daysToHire]).sort(), [['Synthetic dated', '2026-10-03T12:00:00Z', null], ['Synthetic undated', null, null]])
  const dated = await read('?history=imported&from=2026-10-01&to=2026-10-31', h.owner)
  assert.deepEqual([dated.rows.map(r => r.candidateName), dated.disclosures.excludedUndated], [['Synthetic dated'], 1])
  assert.deepEqual(rows(await read('?history=native')), expected)

  const noOffers = await h.command('permission-level', { name: 'Cohort without offers', permissions: ['move', 'export'] })
  await h.command('job-levels', { id: h.jobA.id, members: { [h.managerEmail]: noOffers.id }, roles: {} })
  report = await read('?vacancy=' + h.jobA.id)
  assert.equal(report.totals.measuredHires, 0)
  assert.deepEqual([report.rows.find(r => r.application === h.hireA.id).acceptedAt, report.disclosures.offerAccessUnavailable], [null, 3])
  const noExport = await h.command('permission-level', { name: 'Cohort without export', permissions: ['move', 'offers'] })
  await h.command('job-levels', { id: h.jobA.id, members: { [h.managerEmail]: noExport.id }, roles: {} })
  assert.equal((await h.send('/api/lodge/download/cohort', undefined, h.manager)).status, 403)
  assert.equal((await h.send('/api/lodge/download/cohort?vacancy=' + h.jobB.id, undefined, h.manager)).status, 200)
  await h.command('job-levels', { id: h.jobA.id, members: {}, roles: {} })
  await h.command('blind-review', { id: h.jobA.id, enabled: true, stages: [h.jobA.stages[0].id], revealStage: h.jobA.stages[2].id })
  report = await read('?vacancy=' + h.jobA.id)
  assert.equal(report.rows.find(r => r.application === h.reopened.id).candidateName, 'Application ' + h.reopened.id)
  await h.command('hiring-team', { id: h.jobA.id, hiringManagers: ['owner@example.test'], recruiters: [], coordinators: [] })
  assert.deepEqual(rows(await read()), [h.hireB.id, h.withdrawn.id].sort())
  for (const path of [cohortApi + '/' + h.hireA.id, cohortApi + '?vacancy=' + h.jobA.id, '/api/lodge/download/cohort?vacancy=' + h.jobA.id]) assert.equal((await h.send(path, undefined, h.manager)).status, 404, 'revoked job authority refuses old drill and export links')
  assert.equal((await h.send(cohortApi + '?vacancy=' + h.jobB.id, undefined, h.admin)).status, 200)
  await h.command('vacancy-privacy', { id: h.jobB.id, confidential: true, namedPeople: [], publicTitle: 'Confidential role' })
  assert.equal((await h.send(cohortApi + '?vacancy=' + h.jobB.id, undefined, h.admin)).status, 404, 'confidential job refuses an unnamed admin')
  assert.ok(!rows(await read('', h.admin)).includes(h.hireB.id), 'confidential job is absent before counting')
  await h.command('member', { email: h.managerEmail, name: 'Revoked manager', roles: ['manager'], active: false })
  assert.equal((await h.send(cohortApi, undefined, h.manager)).status, 403)
}
