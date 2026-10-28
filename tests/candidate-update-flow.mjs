import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { businessHarness } from './harness.mjs'

export const updateAddress = n => ['synthetic-lodge-update-' + n, 'example.test'].join('@')
export const updateStatusText = { name: 'Synthetic Lodge status update', language: 'en', purpose: 'other', subject: 'Update on {job_title}', body: 'Hello {candidate_name}, your application is still under review. — {business_name}', reviewed: true }
export const updateRejectionText = { name: 'Synthetic Lodge recorded rejection', language: 'en', purpose: 'rejection', subject: 'Your {job_title} application', body: 'Hello {candidate_name}, we have decided not to progress your application. — {business_name}', reviewed: true }

export async function candidateUpdateJob(run, ownerEmail, manager = ownerEmail, suffix = '') {
  let job = await run('vacancy', { title: 'Synthetic Lodge response windows' + suffix, location: 'Denver, CO', manager, headcount: 3, compensation: { currency: 'USD', min: 6000000, max: 8000000, period: 'year' } })
  await run('rubric', { id: job.id, criteria: [{ name: 'Safety', description: 'Describes safe work' }] })
  await run('interview-plan', { id: job.id, plan: [{ name: 'Work review', stageName: 'Interview', durationMinutes: 60 }] })
  const approval = await run('request-vacancy-approval', { id: job.id, approver: ownerEmail })
  await run('decide-approval', { id: approval.id, version: approval.version, decision: 'approved', reason: 'Reviewed headcount' })
  job = await run('publish', { id: job.id })
  const status = await run('message-template', { ...updateStatusText, vacancy: job.id })
  const rejection = await run('message-template', { ...updateRejectionText, vacancy: job.id })
  const scheduled = await run('rejection-template', updateRejectionText)
  return { job, status, rejection, scheduled }
}
export const updateProposal = (row, approver) => ({ workflow: 'candidate-update', application: row.application, sources: row.sources, subject: row.subject, body: row.body, approver })

/** One native recruiting journey exercises response promises, external proposals and safe human review. */
export async function checkCandidateUpdates() {
  let outbound = 0
  const h = await businessHarness({ clock: '2037-10-30T14:00:00.000Z', outboundService: () => { outbound++; return new Response('unexpected outbound', { status: 502 }) } })
  try {
    const { command: run, send, state } = h
    const ownerEmail = (await state()).actor.email, managerEmail = updateAddress('manager'), reviewerEmail = updateAddress('reviewer'), agentEmail = updateAddress('agent')
    const manager = await h.member(managerEmail, ['manager'], 'Synthetic Lodge principal')
    const reviewer = await h.member(reviewerEmail, ['manager'], 'Synthetic Lodge reviewer')
    const agent = await h.member(agentEmail, [], 'Synthetic Lodge external agent', { agent: true, actsFor: managerEmail })
    await h.setTime('2037-03-06T15:00:00.000Z')
    const { job, status, rejection, scheduled } = await candidateUpdateJob(run, ownerEmail, managerEmail)
    await run('hiring-team', { id: job.id, recruiters: [reviewerEmail] })
    let policy = await run('candidate-update-policy', { vacancy: job.id, businessDays: 1, timeZone: 'America/New_York', statusTemplate: status.id, rejectionTemplate: rejection.id })
    const add = async n => run('candidate', { name: 'Synthetic Lodge update ' + n, email: updateAddress(n), source: 'Direct', consentBasis: 'manual', vacancy: job.id })
    const active = await add(1), rejected = await add(2)
    const debrief = job.stages.find(s => /debrief/i.test(s.name)) ?? job.stages[2]
    await run('move', { application: active.application.id, to: debrief.id, reason: 'Human moved to debrief' })
    await run('move', { application: rejected.application.id, to: 'rejected', closeReason: 'skills', reason: 'Human recorded disposition', send: 'now', template: scheduled.id })
    // Candidate opt-out is recorded through the real native account preferences door.
    const f = new FormData()
    for (const [k, v] of Object.entries({ name: 'Synthetic Lodge opted out', email: updateAddress('opted'), noticeVersion: '1', consent: 'yes' })) f.set(k, v)
    const applied = await send('/jobs/' + job.slug, f)
    assert.equal(applied.status, 200, applied.text)
    const code = applied.text.match(/LDG-[A-F0-9]{8}/)[0]
    const optedAccount = await h.member(updateAddress('opted'), ['interviewer'], 'Synthetic Lodge opted account')
    const pref = new FormData(); pref.set('preference', 'none')
    assert.equal((await send('/candidate/receipts/' + code + '/account/preferences', pref, optedAccount)).status, 303)
    const evidence = async (cookie = agent) => {
      const response = await send('/api/lodge/candidate-updates', undefined, cookie)
      assert.equal(response.status, 200, response.text)
      return response.value
    }
    let rows = (await evidence()).cases
    assert.deepEqual(rows.map(r => [r.application, r.overdue]).sort(), [[active.application.id, false], [rejected.application.id, false]].sort())
    assert.ok(rows.every(r => r.dueAt === '2037-03-09T14:00:00.000Z'), 'Friday 10 a.m. becomes Monday 10 a.m. EDT, across the spring DST change')
    await h.setTime('2037-03-09T13:59:59.999Z')
    assert.ok((await evidence()).cases.every(r => !r.overdue))
    await h.setTime('2037-03-09T14:00:00.000Z')
    rows = (await evidence()).cases
    assert.ok(rows.every(r => r.overdue && r.mailbox === 'unknown' && r.delivery === 'unverified' && r.sent === false && r.complete === false))
    assert.deepEqual(rows.map(r => r.kind).sort(), ['recorded-rejection', 'status-update'])
    const mailBefore = (await h.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first()).n, callsBefore = outbound
    const before = (await state()).applications.map(a => [a.id, a.stage, a.status])
    const row = rows.find(r => r.application === active.application.id), body = updateProposal(row, reviewerEmail)
    assert.equal((await send('/api/lodge/command/propose', { ...body, body: 'A made-up rejection reason' }, agent)).status, 409)
    assert.equal((await send('/api/lodge/command/propose', { ...body, sources: row.sources.slice(1) }, agent)).status, 409)
    assert.equal((await send('/api/lodge/command/propose', body, manager)).status, 403)
    const concurrent = await Promise.all([send('/api/lodge/command/propose', body, agent), send('/api/lodge/command/propose', body, agent)])
    assert.ok(concurrent.some(r => r.status === 200)); assert.ok(concurrent.every(r => [200, 409].includes(r.status)))
    const packet = concurrent.find(r => r.status === 200).value
    assert.equal((await state()).proposals.filter(p => p.workflow === 'candidate-update').length, 1)
    const decision = { id: packet.id, decision: 'accepted', reason: 'Reviewed exact language and current evidence' }
    const decisions = await Promise.all([send('/api/lodge/command/decide-proposal', decision, reviewer), send('/api/lodge/command/decide-proposal', decision, reviewer)])
    assert.ok(decisions.some(r => r.status === 200)); assert.ok(decisions.every(r => [200, 409].includes(r.status)))
    const accepted = decisions.find(r => r.status === 200).value
    await h.restart(); await h.setTime('2037-03-09T14:00:00.000Z')
    assert.equal((await run('propose', body, agent)).id, packet.id)
    assert.deepEqual((await run('decide-proposal', decision, reviewer)).results, accepted.results)
    let draft = (await state(reviewer)).messages.find(m => m.id === accepted.results[0])
    assert.equal((await state()).messages.length, 1)
    assert.equal((await send('/api/lodge/download/message/' + draft.id, undefined, reviewer)).status, 409)
    const approval = await run('request-message-approval', { id: draft.id, approver: ownerEmail }, reviewer)
    await run('decide-approval', { id: approval.id, version: approval.version, decision: 'approved', reason: 'Exact text reviewed' })
    const eml = await send('/api/lodge/download/message/' + draft.id, undefined, reviewer)
    assert.equal(eml.status, 200); assert.match(eml.text, /X-Unsent: 1/)
    draft = (await state()).messages.find(m => m.id === draft.id)
    assert.deepEqual([draft.sent, draft.delivery, draft.complete, draft.downloads.length], [false, 'unverified', false, 1])
    const rejectionRow = rows.find(r => r.application === rejected.application.id)
    const rejectPacket = await run('propose', updateProposal(rejectionRow, reviewerEmail), agent)
    await run('decide-proposal', { id: rejectPacket.id, decision: 'accepted', reason: 'Uses only the recorded human disposition' }, reviewer)
    const rejectedDraft = (await state()).messages.find(m => m.application === rejected.application.id)
    assert.deepEqual([rejectedDraft.subject, rejectedDraft.body], [rejectionRow.subject, rejectionRow.body])
    assert.equal((await state()).rejectionEmails.find(m => m.id === rejectionRow.rejectionEmail).state, 'due-not-sent')
    assert.deepEqual((await state()).applications.map(a => [a.id, a.stage, a.status]), before, 'proposal, approval and EML never change stages or dispositions')
    // Changed template language review invalidates a packet and any retained update draft.
    const fresh = await add(4)
    await h.setTime('2037-03-10T14:00:00.000Z')
    let freshRow = (await evidence()).cases.find(r => r.application === fresh.application.id)
    const stalePacket = await run('propose', updateProposal(freshRow, reviewerEmail), agent)
    await run('message-template', { ...updateStatusText, id: status.id, vacancy: job.id, version: 1, body: 'A newly reviewed update for {candidate_name}' })
    assert.equal((await send('/api/lodge/command/decide-proposal', { id: stalePacket.id, decision: 'accepted', reason: 'Stale' }, reviewer)).status, 409)
    assert.equal((await send('/api/lodge/download/message/' + draft.id, undefined, reviewer)).status, 409)
    freshRow = (await evidence()).cases.find(r => r.application === fresh.application.id)
    const revokedPacket = await run('propose', updateProposal(freshRow, reviewerEmail), agent)
    const limited = await run('permission-level', { name: 'Synthetic Lodge no contact', permissions: ['settings'] })
    await run('job-levels', { id: job.id, members: { [managerEmail]: limited.id } })
    assert.equal((await state()).proposals.some(p => p.id === revokedPacket.id), false, 'lost principal access hides the whole packet even from the owner')
    assert.equal((await send('/api/lodge/command/decide-proposal', { id: revokedPacket.id, decision: 'accepted', reason: 'Revoked principal' }, reviewer)).status, 404)
    await run('job-levels', { id: job.id, members: { [reviewerEmail]: limited.id } })
    assert.equal((await state()).messages.some(m => m.candidateUpdate), false, 'lost reviewer access hides every retained narrative and draft')
    assert.equal((await state()).approvals.some(a => a.subjectId === draft.id), false)
    assert.equal((await send('/api/lodge/command/decide-proposal', { id: revokedPacket.id, decision: 'accepted', reason: 'Revoked reviewer' }, reviewer)).status, 404)
    await run('job-levels', { id: job.id, members: {} })
    const held = await run('hold', { candidate: fresh.candidate.id, reason: 'Legal hold' })
    assert.equal((await evidence()).cases.some(r => r.application === fresh.application.id), false)
    assert.equal((await send('/api/lodge/command/decide-proposal', { id: revokedPacket.id, decision: 'accepted', reason: 'Held' }, reviewer)).status, 404)
    await run('release-hold', { id: held.id, reason: 'Released' })
    await run('move', { application: fresh.application.id, to: 'withdrawn', closeReason: 'pay', reason: 'Candidate withdrew' })
    assert.equal((await send('/api/lodge/delete-candidate', { candidate: fresh.candidate.id, confirm: fresh.candidate.name, reason: 'Erasure requested' }, h.owner)).status, 200)
    assert.equal((await send('/api/lodge/command/propose', updateProposal(freshRow, reviewerEmail), agent)).status, 404)
    assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM l_records WHERE kind='proposal' AND id=?").bind(revokedPacket.id).first()).n, 0)
    assert.equal((await state()).messages.some(m => m.application === fresh.application.id), false)
    // A scheduled interview end supplies a later native anchor without asserting actual attendance.
    await h.setTime('2037-10-30T14:00:00.000Z')
    const autumn = await add(5)
    const iv = await run('interview', { application: autumn.application.id, planItem: job.plan[0].id, participants: [ownerEmail], slots: ['2037-10-30T15:00:00.000Z'], durationMinutes: 60 })
    await run('schedule', { interview: iv.id, slot: 0 })
    await h.setTime('2037-10-30T16:00:00.000Z')
    const autumnRow = (await evidence()).cases.find(r => r.application === autumn.application.id)
    assert.equal(autumnRow.anchor.kind, 'interview')
    assert.equal(autumnRow.dueAt, '2037-11-02T17:00:00.000Z', 'Friday noon becomes Monday noon EST across autumn DST')
    await h.setTime('2037-11-02T16:59:59.999Z'); assert.equal((await evidence()).cases.find(r => r.application === autumn.application.id).overdue, false)
    await h.setTime('2037-11-02T17:00:00.000Z'); assert.equal((await evidence()).cases.find(r => r.application === autumn.application.id).overdue, true)
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first()).n, mailBefore, 'native window evidence, draft reviews and EML enqueue no mail')
    assert.equal(outbound, callsBefore, 'zero outbound provider calls')
    await run('member', { email: agentEmail, name: 'Synthetic Lodge external agent', roles: [], agent: true, actsFor: managerEmail, active: false })
    assert.equal((await send('/api/lodge/candidate-updates', undefined, agent)).status, 403, 'revoked agent session loses evidence access')
    void policy
  } finally { await h.close() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { await checkCandidateUpdates(); console.log('COORD-005 native candidate update journey passed') }
