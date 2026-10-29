import assert from 'node:assert/strict'
import { businessHarness } from './harness.mjs'
import { careersJob } from './careers-driver.mjs'

export const address = n => ['synthetic-lodge-' + n, 'example.test'].join('@')
export const original = 'Synthetic Lodge original\u0000file\nline two\r\n'
export const file = { name: 'synthetic-lodge-1.txt', mediaType: 'text/plain', base64: Buffer.from(original).toString('base64') }
export const form = fields => { const body = new FormData(); for (const [key, value] of Object.entries(fields)) body.set(key, value); return body }

/** Native account sign-in through the actual invitation mail edge; no Lodge membership is created. */
export async function candidateSession(h, email) {
  assert.equal((await h.send('/auth/invite', { email, displayName: 'Synthetic Lodge candidate', role: 'member', returnTo: '/candidate' }, h.owner)).status, 202)
  const outbox = await h.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence DESC').all()
  const mail = outbox.results.map(r => JSON.parse(r.message)).find(m => m.to.includes(email))
  const token = new URL(mail.text.match(/http:\/\/\S+\/auth\/confirm\?token=\S+/)[0]).searchParams.get('token')
  const confirmed = await h.send('/auth/confirm', { token })
  assert.equal(confirmed.status, 303)
  return confirmed.cookie
}

export async function seedTakeHome(h, suffix = 1) {
  const job = await careersJob(h.command, 'Synthetic take-home role ' + suffix)
  const a = address(suffix * 10), b = address(suffix * 10 + 1)
  const ivy = await h.member(address(suffix * 10 + 2), ['interviewer'], 'Synthetic first grader')
  const ian = await h.member(address(suffix * 10 + 3), ['manager', 'interviewer'], 'Synthetic second grader')
  const reviewer = await h.member(address(suffix * 10 + 4), ['interviewer'], 'Synthetic other reviewer')
  for (const [name, email] of [['Synthetic applicant', a], ['Synthetic second applicant', b]]) assert.equal((await h.send('/jobs/' + job.slug, form({ name, email, noticeVersion: '1', consent: 'yes' }))).status, 200)
  const w = await h.state(), person = w.candidates.find(c => c.email === a), app = w.applications.find(r => r.candidate === person.id), other = w.applications.find(r => r.candidate === w.candidates.find(c => c.email === b).id)
  const receipt = w.receipts.find(r => r.application === app.id), otherReceipt = w.receipts.find(r => r.application === other.id)
  const graders = [address(suffix * 10 + 2), address(suffix * 10 + 3)]
  await h.command('assign-reviewers', { application: app.id, reviewers: [...graders, address(suffix * 10 + 4)] })
  const cookie = await candidateSession(h, a), otherCookie = await candidateSession(h, b)
  const base = '/candidate/receipts/' + receipt.id + '/take-home/' + app.id
  return { job, app, person, receipt, otherReceipt, graders, ivy, ian, reviewer, cookie, otherCookie, base }
}

/** One sanity journey covers native custody, authority, timing, grading and lifecycle through HTTP. */
export async function checkTakeHome() {
  let outbound = 0
  const h = await businessHarness({ clock: '2027-03-14T12:00:00.000Z', outboundService: () => { outbound++; return new Response('Unexpected outbound', { status: 503 }) } })
  try {
    const f = await seedTakeHome(h), { app, person, graders, ivy, ian, reviewer, cookie, otherCookie, base } = f
    const w0 = await h.state(), beforeApp = w0.applications.find(a => a.id === app.id)
    const instructions = { application: app.id, version: 0, instructions: 'Prepare a short safety plan.', graders, timeZone: 'America/New_York', deadline: '2027-03-14T13:00:00.000Z', attachment: file }
    const snapshot = async () => (await h.db.prepare("SELECT kind,id,revision,value FROM l_records ORDER BY kind,id").all()).results
    const noWrite = async (fn, expected) => { const before = await snapshot(); const r = await fn(); assert.equal(r.status, expected, r.text); assert.deepEqual(await snapshot(), before); return r }
    await noWrite(() => h.send('/api/lodge/command/take-home-assign', { ...instructions, graders: [graders[0], address(999)] }, h.owner), 403)
    await noWrite(() => h.send('/api/lodge/command/take-home-assign', instructions, ivy), 403)
    await h.command('take-home-assign', instructions)
    let record = (await h.state()).takeHomes.assignments.find(r => r.id === app.id)
    assert.equal(record.versions[0].delivery, 'not-delivered')
    assert.equal(record.versions[0].rubricVersion, app.rubricVersion)
    assert.match((await h.send(base, undefined, cookie)).text, /9:00 a.m. EDT/)
    assert.equal((await h.send('/api/lodge/state', undefined, cookie)).status, 403, 'candidate identity gains no staff role')
    for (const [p, who, status] of [[base, '', 401], [base, otherCookie, 404], [base.replace(f.receipt.id, f.otherReceipt.id), otherCookie, 404]]) await noWrite(() => h.send(p, undefined, who), status)
    await noWrite(() => h.send(base, { version: 1, submissionId: 'synthetic-lodge-foreign-origin', link: 'https://example.test/synthetic-lodge-1' }, cookie, { origin: 'https://foreign.example.test' }), 403)
    const instructionDoc = record.versions[0].attachment
    assert.equal((await h.send(base + '/files/' + instructionDoc, undefined, cookie)).text, original)
    await noWrite(() => h.send(base + '/files/' + instructionDoc, undefined, otherCookie), 404)
    await noWrite(() => h.send('/api/lodge/download/document/' + instructionDoc, undefined, reviewer), 404)
    const submit = { version: 1, submissionId: 'synthetic-lodge-submission-1', files: [file], link: 'https://example.test/synthetic-lodge-1' }
    await noWrite(() => h.send(base, submit, otherCookie), 404)
    await noWrite(() => h.send(base, { ...submit, link: 'http://example.test/synthetic-lodge-1' }, cookie), 400)
    await h.setTime('2027-03-14T13:00:00.001Z')
    await noWrite(() => h.send(base, submit, cookie), 409)
    await h.command('take-home-extend', { application: app.id, version: 1, previousDeadline: instructions.deadline, deadline: '2027-03-14T14:00:00.000Z', reason: 'Candidate requested another hour' })
    await noWrite(() => h.send('/api/lodge/command/take-home-extend', { application: app.id, version: 1, previousDeadline: instructions.deadline, deadline: '2027-03-14T15:00:00.000Z', reason: 'Stale request' }, h.owner), 409)
    await h.setTime('2027-03-14T14:00:00.000Z')
    const pair = await Promise.all([h.send(base, submit, cookie), h.send(base, submit, cookie)])
    assert.ok(pair.every(r => [303, 409].includes(r.status)), pair.map(r => r.text).join('\n'))
    assert.ok(pair.some(r => r.status === 303))
    await noWrite(() => h.send(base, submit, cookie), 303)
    await h.restart()
    await noWrite(() => h.send(base, submit, cookie), 303)
    await noWrite(() => h.send(base, { ...submit, submissionId: 'synthetic-lodge-submission-2' }, cookie), 409)
    const view = (await h.state()).takeHomes, sub = view.submissions.find(s => s.application === app.id)
    assert.equal(view.submissions.length, 1)
    assert.equal((await h.send(base + '/files/' + sub.files[0], undefined, cookie)).text, original)
    assert.equal((await h.send('/api/lodge/download/document/' + sub.files[0], undefined, ivy)).text, original)
    assert.equal((await h.state(reviewer)).takeHomes.assignments.length, 0, 'mere application access does not designate a grader')
    await noWrite(() => h.send('/api/lodge/download/take-home/' + app.id, undefined, reviewer), 404)
    const rubric = (await h.state()).vacancies.find(j => j.id === app.vacancy).rubrics.find(r => r.version === app.rubricVersion)
    // Name-blind review keeps original filenames, links and bytes out of every staff view.
    await h.command('blind-review', { id: app.vacancy, enabled: true, stages: [beforeApp.stage], revealStage: f.job.stages[1].id })
    const blinded = (await h.state(ivy)).takeHomes.submissions.find(s => s.application === app.id)
    assert.equal(blinded.originalsWithheld, true); assert.deepEqual(blinded.files, []); assert.equal(blinded.link, '')
    await noWrite(() => h.send('/api/lodge/download/document/' + sub.files[0], undefined, ivy), 404)
    assert.equal(JSON.parse((await h.send('/api/lodge/download/take-home/' + app.id, undefined, ivy)).text).submissions[0].link, '')
    await h.command('blind-review', { id: app.vacancy, enabled: false, reason: 'Synthetic reveal review' })
    const grade = { application: app.id, version: 1, rubricVersion: app.rubricVersion, ratings: { [rubric.criteria[0].id]: 3 }, evidence: { [rubric.criteria[0].id]: 'The plan names a safe work sequence.' }, recommendation: 'yes', takeaways: 'Synthetic independent first judgment' }
    await noWrite(() => h.send('/api/lodge/command/take-home-grade', { ...grade, rubricVersion: 99 }, ivy), 409)
    await h.command('take-home-grade', grade, ivy)
    assert.equal((await h.state(ian)).takeHomes.grades.length, 0)
    assert.equal((await h.state()).takeHomes.grades.length, 0, 'manager also cannot read unreleased independent feedback')
    assert.equal((await h.send('/api/lodge/download/take-home/' + app.id, undefined, ian)).text.includes(grade.takeaways), false)
    await noWrite(() => h.send('/api/lodge/command/take-home-release', { application: app.id, version: 1 }, ivy), 403)
    await noWrite(() => h.send('/api/lodge/command/take-home-release', { application: app.id, version: 1 }, h.owner), 400)
    const limited = await h.command('permission-level', { name: 'Synthetic read without feedback', permissions: ['export'] })
    await h.command('job-levels', { id: app.vacancy, members: { [graders[1]]: limited.id } })
    await noWrite(() => h.send('/api/lodge/command/take-home-grade', grade, ian), 403)
    await noWrite(() => h.send('/api/lodge/download/document/' + sub.files[0], undefined, ian), 404)
    await h.command('job-levels', { id: app.vacancy, members: {} })
    await h.command('take-home-grade', { ...grade, takeaways: 'Synthetic independent second judgment' }, ian)
    assert.equal((await h.state(ivy)).takeHomes.grades.length, 1)
    await h.command('take-home-release', { application: app.id, version: 1 })
    assert.equal((await h.state(ivy)).takeHomes.grades.length, 2)
    const exported = await h.send('/api/lodge/download/take-home/' + app.id, undefined, ivy)
    assert.equal(JSON.parse(exported.text).grades.length, 2)
    await h.command('member', { email: graders[1], name: 'Synthetic second grader', roles: ['interviewer'], active: false })
    await noWrite(() => h.send('/api/lodge/download/document/' + sub.files[0], undefined, ian), 403)
    await noWrite(() => h.send('/api/lodge/command/take-home-grade', grade, ian), 403)
    const afterApp = (await h.state()).applications.find(a => a.id === app.id)
    assert.deepEqual([afterApp.stage, afterApp.history], [beforeApp.stage, beforeApp.history], 'assessment actions never change stages')
    // New instructions invalidate old forms and keep the earlier original and feedback.
    await h.command('member', { email: graders[1], name: 'Synthetic second grader', roles: ['interviewer'], active: true })
    await h.command('take-home-assign', { ...instructions, version: 1, deadline: '2027-03-15T13:00:00.000Z', instructions: 'Revised safety instructions' })
    await noWrite(() => h.send(base, submit, cookie), 409)
    record = (await h.state()).takeHomes.assignments[0]
    assert.deepEqual(record.versions.map(v => v.instructions), [instructions.instructions, 'Revised safety instructions'])
    const versionTwo = { version: 2, submissionId: 'synthetic-lodge-submission-3', link: submit.link }
    await h.command('move', { application: app.id, to: f.job.stages[1].id, reason: 'Synthetic stage change' })
    await noWrite(() => h.send(base, versionTwo, cookie), 409)
    await h.command('move', { application: app.id, to: beforeApp.stage, reason: 'Synthetic stage return' })
    await h.setTime('2027-03-15T13:00:00.001Z')
    await noWrite(() => h.send(base, versionTwo, cookie), 409)
    await h.command('take-home-extend', { application: app.id, version: 2, previousDeadline: '2027-03-15T13:00:00.000Z', deadline: '2027-03-15T14:00:00.000Z', reason: 'Recorded extension' })
    await h.setTime('2027-03-15T13:30:00.000Z')
    assert.equal((await h.send(base, versionTwo, cookie)).status, 303, 'link-only submission is supported without fetching')
    // Losing a reviewer assignment removes access even though the take-home still designates them.
    await h.command('assign-reviewers', { application: app.id, reviewers: [graders[1]] })
    await noWrite(() => h.send('/api/lodge/download/document/' + sub.files[0], undefined, ivy), 404)
    assert.equal((await h.state(ivy)).takeHomes.assignments.length, 0)
    await h.command('assign-reviewers', { application: app.id, reviewers: graders })
    const renewedCookie = await h.signIn(person.email)
    const signedOut = await h.send('/candidate/signout', {}, cookie)
    assert.equal(signedOut.status, 303)
    await noWrite(() => h.send(base, versionTwo, cookie), 401)
    assert.equal((await h.send(base, undefined, renewedCookie)).status, 200)
    const report = await h.send('/api/lodge/download/candidate/' + person.id, undefined, h.owner)
    assert.equal(JSON.parse(report.text).document.find(d => d.id === sub.files[0]).base64, file.base64)
    await h.command('move', { application: app.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Synthetic close' })
    const hold = await h.command('hold', { candidate: person.id, reason: 'Synthetic hold' })
    await noWrite(() => h.send('/api/lodge/delete-candidate', { candidate: person.id, confirm: person.name, reason: 'Synthetic erasure' }, h.owner), 409)
    await h.command('release-hold', { id: hold.id, reason: 'Released for synthetic erasure' })
    assert.equal((await h.send('/api/lodge/delete-candidate', { candidate: person.id, confirm: person.name, reason: 'Synthetic erasure' }, h.owner)).status, 200)
    const remaining = await snapshot()
    assert.equal(remaining.filter(r => ['take-home', 'take-home-submission', 'take-home-grade'].includes(r.kind)).length, 0)
    assert.equal(remaining.some(r => r.kind === 'blob' && r.id === sub.files[0]), false)
    await noWrite(() => h.send(base, versionTwo, renewedCookie), 404)
    assert.equal(outbound, 0, 'take-home assignment, links and grading perform zero outbound requests')
  } finally { await h.close() }
}
