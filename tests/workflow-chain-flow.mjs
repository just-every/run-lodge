import assert from 'node:assert/strict'
import { RANGE, RUBRIC } from './hiring-fixture.mjs'
import { reviewHeadcountChain } from './operations-driver.mjs'

export async function checkWorkflowChains({ h, cmd, send, state, owner, manager, ivy }) {
  const address = n => ['synthetic-lodge-' + n, 'example.test'].join('@')
  const emails = [1, 2, 3].map(address), cookies = []
  for (const [i, email] of emails.entries()) cookies.push(await h.member(email, ['approver', 'manager'], 'synthetic-lodge-' + (i + 1)))
  const managerEmail = (await state(manager)).actor.email
  const job = await cmd('vacancy', { title: 'Headcount chain supervisor', location: 'Denver', headcount: 2, compensation: RANGE, manager: managerEmail }, manager)
  await cmd('rubric', { id: job.id, criteria: RUBRIC }, manager)
  const ready = await cmd('interview-plan', { id: job.id, plan: [{ name: 'Work review', stage: job.stages[2].id }] }, manager)
  const steps = [{ approvers: [emails[0]] }, { approvers: emails.slice(1) }]
  const decisions = emails.map(approver => ({ approver, decision: 'approved' }))
  const configured = await reviewHeadcountChain(h, ready, steps, decisions)
  const asked = () => cmd('request-vacancy-approval', { id: job.id }, manager)
  const decide = (request, i, decision = 'approved', cookie = cookies[i]) => send('/api/lodge/command/decide-approval', { id: request.id, version: request.version, decision, reason: 'Reviewed exact headcount terms' }, cookie)
  const approval = async request => (await state()).approvals.find(x => x.id === request.id)
  const currentJob = async () => (await state()).vacancies.find(x => x.id === job.id)
  const snapshot = async () => (await h.db.prepare("SELECT kind,id,revision,value FROM l_records ORDER BY kind,id").all()).results
  const refused = async (request, i, status, decision = 'approved', cookie) => {
    const before = await snapshot()
    assert.equal((await decide(request, i, decision, cookie)).status, status)
    assert.deepEqual(await snapshot(), before, 'refused decisions change no record or audit')
  }
  const unpublished = async () => {
    await cmd('publish', { id: job.id }, manager, 409)
    assert.equal((await currentJob()).approvedNow, false)
    assert.equal(((await currentJob()).openings ?? []).filter(x => x.status === 'open').length, 0)
  }
  let request = await asked()
  assert.equal(request.chain.version, configured.approvalChain.version)
  assert.equal((await state(cookies[2])).approvals.find(x => x.id === request.id).chain.steps.length, 2, 'every named approver can review the frozen chain terms')
  await refused(request, 1, 403, 'approved')
  await refused(request, 0, 403, 'approved', ivy)
  await refused(request, 0, 403, 'approved', owner)
  const noCapability = await cmd('sandbox-create', { name: 'Invalid chain', vacancy: job.id, mode: 'synthetic', confirmSynthetic: true, samples: [{ label: 'synthetic-lodge-2' }] })
  await cmd('sandbox-edit', { id: noCapability.id, edits: [{ op: 'approval-routing', input: { chain: [{ approvers: [(await state(ivy)).actor.email] }] } }] }, owner, 400)
  await unpublished()
  assert.equal((await decide(request, 0)).status, 200)
  assert.equal((await decide(request, 2)).status, 200)
  await unpublished()
  await h.restart()
  assert.deepEqual((await approval(request)).decisions.map(x => x.approver), [emails[0], emails[2]], 'completed steps survive a Worker restart')
  assert.equal((await decide(request, 1)).status, 200)
  assert.equal((await approval(request)).status, 'approved')
  assert.equal((await currentJob()).openings.filter(x => x.status === 'open').length, 2)
  await cmd('publish', { id: job.id }, manager)
  await cmd('unpublish', { id: job.id, reason: 'Next approval round' }, manager)

  // A parallel rejection ends the whole chain even after another person approved.
  request = await asked()
  assert.equal((await decide(request, 0)).status, 200)
  assert.equal((await decide(request, 1)).status, 200)
  assert.equal((await decide(request, 2, 'rejected')).status, 200)
  assert.equal((await approval(request)).status, 'rejected')
  await refused(request, 2, 403)
  await cmd('publish', { id: job.id }, manager, 409)

  // An exact terms change never carries completed decisions into a fresh request.
  request = await asked()
  assert.equal((await decide(request, 0)).status, 200)
  await cmd('vacancy', { ...await currentJob(), description: 'Changed employer terms' }, manager)
  await refused(request, 1, 409)
  const stale = request
  request = await asked()
  assert.equal((await approval(stale)).status, 'superseded')
  assert.deepEqual(request.decisions, [])
  assert.notEqual(request.version, stale.version)

  // Current native authority and job permission are checked at the decision door.
  await cmd('member', { email: emails[0], name: 'synthetic-lodge-1', roles: ['approver', 'manager'], active: false })
  await refused(request, 0, 403)
  await cmd('member', { email: emails[0], name: 'synthetic-lodge-1', roles: ['approver', 'manager'], active: true })
  const level = await cmd('permission-level', { name: 'Headcount read only', permissions: [] })
  await cmd('job-levels', { id: job.id, members: { [emails[0]]: level.id } })
  await refused(request, 0, 403)
  assert.equal((await state(cookies[0])).approvals.some(x => x.id === request.id), false, 'lost approval authority withholds the chain terms from current reads')
  await cmd('job-levels', { id: job.id, members: {} })
  assert.equal((await decide(request, 0)).status, 200)
  await cmd('member', { email: emails[0], name: 'synthetic-lodge-1', roles: ['approver', 'manager'], active: false })
  await refused(request, 2, 400)
  await cmd('member', { email: emails[0], name: 'synthetic-lodge-1', roles: ['approver', 'manager'], active: true })
  await cmd('job-levels', { id: job.id, members: { [emails[0]]: level.id } })
  await refused(request, 2, 403)
  await cmd('job-levels', { id: job.id, members: {} })
  await h.db.prepare('UPDATE oa_sessions SET revoked_at=1 WHERE operator_id=(SELECT id FROM oa_operators WHERE email=?)').bind(emails[1]).run()
  await refused(request, 1, 401)
  cookies[1] = await h.signIn(emails[1])
  // Both permitted decision orders work; simultaneous saves retain both after an explicit stale retry.
  const responses = await Promise.all([decide(request, 1), decide(request, 2)])
  assert.ok(responses.every(x => [200, 409].includes(x.status)), JSON.stringify(responses))
  for (const [i, response] of responses.entries()) if (response.status === 409) assert.equal((await decide(request, i + 1)).status, 200)
  assert.equal((await approval(request)).status, 'approved')
  assert.deepEqual((await approval(request)).decisions.map(x => x.approver).sort(), [...emails].sort())
  const openings = (await currentJob()).openings.map(x => x.id)
  await refused(request, 1, 403)
  assert.deepEqual((await currentJob()).openings.map(x => x.id), openings, 'decision replay cannot open more headcount')

  // A second serial run uses the other parallel order without relying on concurrency scheduling.
  request = await asked()
  for (const i of [0, 1, 2]) {
    assert.equal((await decide(request, i)).status, 200)
    assert.equal((await approval(request)).status, i === 2 ? 'approved' : 'pending')
  }
  // Additional openings remain requested until the same entire chain completes.
  await cmd('request-opening', { id: job.id }, manager)
  request = (await currentJob()).approval
  const openBefore = (await currentJob()).openings.filter(x => x.status === 'open').length
  for (const i of [0, 2]) assert.equal((await decide(request, i)).status, 200)
  assert.equal((await currentJob()).openings.filter(x => x.status === 'open').length, openBefore)
  assert.equal((await currentJob()).openings.filter(x => x.status === 'requested').length, 1)
  assert.equal((await decide(request, 1)).status, 200)
  assert.equal((await currentJob()).openings.filter(x => x.status === 'open').length, openBefore + 1)
  await cmd('request-opening', { id: job.id }, manager)
  request = (await currentJob()).approval
  assert.equal((await decide(request, 0)).status, 200)
  assert.equal((await decide(request, 1, 'rejected')).status, 200)
  assert.equal((await currentJob()).openings.filter(x => x.status === 'open').length, openBefore + 1)
  assert.equal((await currentJob()).openings.filter(x => x.status === 'requested').length, 0)
  assert.equal((await currentJob()).approvedNow, true, 'refused extra headcount preserves the earlier fully approved terms')

  // A requester with approver capability still cannot independently decide their request.
  const ownJob = await cmd('vacancy', { title: 'Independent headcount request', location: 'Denver', compensation: RANGE, headcount: 1, manager: emails[0] }, cookies[0])
  await cmd('rubric', { id: ownJob.id, criteria: RUBRIC }, cookies[0])
  const ownReady = await cmd('interview-plan', { id: ownJob.id, plan: [{ name: 'Work review', stage: ownJob.stages[2].id }] }, cookies[0])
  await reviewHeadcountChain(h, ownReady, [{ approvers: [emails[0], emails[1]] }])
  const self = await cmd('request-vacancy-approval', { id: ownJob.id }, cookies[0])
  await refused(self, 0, 403)

  const template = await cmd('job-template', { fromVacancy: job.id, name: 'Headcount chain template' })
  const child = await cmd('vacancy-from-template', { template: template.id, title: 'Template headcount', location: 'Denver', compensation: RANGE, headcount: 1, manager: managerEmail }, manager)
  const clone = await cmd('clone-vacancy', { id: job.id, title: 'Cloned headcount' }, manager)
  for (const fresh of [child, clone]) {
    assert.deepEqual(fresh.approvalChain.steps, steps)
    assert.equal((fresh.openings ?? []).length, 0)
    assert.equal((await state()).approvals.filter(x => x.subjectId === fresh.id).length, 0)
    await cmd('publish', { id: fresh.id }, manager, 409)
    const own = await cmd('request-vacancy-approval', { id: fresh.id }, manager)
    assert.deepEqual(own.decisions, [])
    assert.equal((await decide(own, 0)).status, 200)
    await cmd('publish', { id: fresh.id }, manager, 409)
    for (const i of [1, 2]) assert.equal((await decide(own, i)).status, 200)
    await cmd('publish', { id: fresh.id }, manager)
  }
  // A fresh template snapshot cannot edit an existing job's chain or approval decisions.
  const isolated = (await state()).vacancies.find(x => x.id === child.id).approvalChain
  const next = await reviewHeadcountChain(h, await currentJob(), [{ approvers: [emails[2]] }], [])
  await cmd('job-template', { id: template.id, fromVacancy: job.id, name: template.name })
  assert.notEqual(next.approvalChain.version, isolated.version)
  assert.deepEqual((await state()).vacancies.find(x => x.id === child.id).approvalChain, isolated)
  assert.equal((await state()).vacancies.find(x => x.id === clone.id).approvedNow, true)
  await checkHeadcountAvailability()
}

// A separate installation pins the clock across the autumn daylight-saving change.
async function checkHeadcountAvailability() {
  const { businessHarness } = await import('./harness.mjs')
  const h = await businessHarness({ clock: '2026-10-30T16:00:00.000Z' })
  try {
    const { command: cmd, state } = h
    const emails = [11, 12, 13, 14, 15, 16].map(n => ['synthetic-lodge-' + n, 'example.test'].join('@'))
    const [original, second, delegate, escalation, manager, novice] = emails
    const sessions = {}
    for (const [index, email] of emails.entries()) sessions[email] = await h.member(email, index < 4 ? ['approver', 'manager'] : index === 4 ? ['manager'] : ['interviewer'], 'synthetic-lodge-' + (index + 11))
    const snapshot = async () => (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
    const refuse = async (op, input, who, status) => {
      const before = await snapshot()
      await cmd(op, input, sessions[who], status)
      assert.deepEqual(await snapshot(), before, 'an unsafe route or decision changes no records or audit')
    }
    const away = { delegate, from: '2026-10-30', through: '2026-11-03' }
    await refuse('approval-delegation', { ...away, delegate: novice }, original, 400)
    await refuse('approval-delegation', { ...away, delegate: original }, original, 400)
    await refuse('approval-delegation', { ...away, through: '2026-10-29' }, original, 400)
    await refuse('approval-delegation', away, manager, 403)
    const saved = await cmd('approval-delegation', { ...away, principal: second }, sessions[original])
    assert.equal(saved.principal, original, 'a supplied principal never changes someone else routing')
    assert.equal((await state(sessions[second])).approvalDelegation, null)
    const job = await cmd('vacancy', { title: 'Delegated headcount', location: 'Denver', headcount: 1, compensation: RANGE, manager }, sessions[manager])
    await cmd('rubric', { id: job.id, criteria: RUBRIC }, sessions[manager])
    const ready = await cmd('interview-plan', { id: job.id, plan: [{ name: 'Work review', stage: job.stages[2].id }] }, sessions[manager])
    const steps = [{ approvers: [original], escalation: { businessDays: 1, owner: escalation } }, { approvers: [second] }]
    await reviewHeadcountChain(h, ready, steps)
    const ask = () => cmd('request-vacancy-approval', { id: job.id }, sessions[manager])
    const view = async request => (await state()).approvals.find(a => a.id === request.id)
    const decision = (request, who, status = 200) => cmd('decide-approval', { id: request.id, version: request.version, decision: 'approved', reason: 'Reviewed the complete terms' }, sessions[who], status)
    const refusedDecision = (request, who, status) => refuse('decide-approval', { id: request.id, version: request.version, decision: 'approved', reason: 'Review attempted' }, who, status)
    let request = await ask()
    assert.equal(request.stepDueAt, '2026-11-02T17:00:00.000Z', 'Friday noon plus one business day is Monday noon after the clock change')
    assert.deepEqual((await state(sessions[delegate])).approvals.find(a => a.id === request.id).waitingApprovers, [delegate])
    await refusedDecision(request, original, 403)
    await refusedDecision(request, escalation, 403)
    const tick = async at => { await h.setTime(at); await (await h.mf.getWorker()).scheduled({ scheduledTime: Date.parse(at), cron: '0 * * * *' }) }
    await tick('2026-11-02T16:59:59.000Z')
    assert.equal((await view(request)).escalations, undefined)
    await h.restart()
    await tick('2026-11-02T17:00:00.000Z')
    let current = await view(request)
    assert.deepEqual(current.escalations.map(e => [e.step, e.owner, e.dueAt]), [[0, escalation, request.stepDueAt]])
    const notified = await state(sessions[escalation])
    assert.ok(notified.approvals.some(a => a.id === request.id), 'the escalation owner can inspect the scoped request')
    assert.ok(notified.alerts.some(a => a.title.startsWith('Approval escalated:') && a.link === '/app?approval=' + request.id), 'the escalation appears through the real notification door')
    await tick('2026-11-02T18:00:00.000Z')
    assert.equal((await view(request)).escalations.length, 1, 'scheduler replay does not duplicate escalation')
    await refusedDecision(request, escalation, 403)
    await decision(request, delegate)
    current = await view(request)
    assert.deepEqual(current.decisions.map(d => [d.approver, d.by, d.onBehalfOf, d.delegationVersion]), [[original, delegate, original, saved.version]])
    assert.equal(current.status, 'pending')
    await cmd('publish', { id: job.id }, sessions[manager], 409)
    await h.restart(); await h.setTime('2026-11-02T18:00:00.000Z')
    await decision(request, second)
    assert.equal((await view(request)).status, 'approved')
    assert.equal((await state()).vacancies.find(v => v.id === job.id).openings.filter(o => o.status === 'open').length, 1)
    assert.ok((await state()).audit.some(a => a.action === 'approval-step-approved' && a.onBehalfOf === original && a.email === delegate))

    request = await ask()
    const level = await cmd('permission-level', { name: 'Delegation read only', permissions: [] })
    await cmd('job-levels', { id: job.id, members: { [delegate]: level.id } })
    assert.ok(!(await state(sessions[delegate])).approvals.some(a => a.id === request.id))
    await refusedDecision(request, delegate, 403)
    await cmd('job-levels', { id: job.id, members: {} })
    await cmd('member', { email: original, name: 'synthetic-lodge-11', roles: ['approver'], active: false })
    assert.ok(!(await state(sessions[delegate])).approvals.some(a => a.id === request.id))
    await refusedDecision(request, delegate, 409)
    await cmd('member', { email: original, name: 'synthetic-lodge-11', roles: ['approver'], active: true })
    await h.db.prepare('UPDATE oa_sessions SET revoked_at=1 WHERE operator_id=(SELECT id FROM oa_operators WHERE email=?)').bind(delegate).run()
    await refusedDecision(request, delegate, 401)
    sessions[delegate] = await h.signIn(delegate)
    await cmd('approval-delegation', { active: false }, sessions[original])
    await refusedDecision(request, delegate, 409)
    assert.ok(!(await state(sessions[delegate])).approvals.some(a => a.id === request.id))
    request = await ask()
    assert.deepEqual(request.delegations, [])
    await refusedDecision(request, delegate, 403)
    await decision(request, original)
    await decision(request, second)

    // Delegation edits invalidate a saved sandbox review before activation.
    const box = await cmd('sandbox-create', { name: 'Delegation revision fence', vacancy: job.id, mode: 'synthetic', confirmSynthetic: true, samples: [{ label: 'synthetic-lodge-20' }] })
    const preview = await cmd('sandbox-preview', { id: box.id })
    assert.equal(preview.impact.approval.escalationTrial[0].owner, escalation)
    await cmd('approval-delegation', away, sessions[original])
    await cmd('sandbox-deploy', { id: box.id, token: preview.token, confirmProduction: true }, h.owner, 409)
    request = await ask()
    await cmd('vacancy', { id: job.id, title: job.title, description: 'Updated reviewed headcount terms', location: 'Denver', compensation: RANGE, manager, headcount: 1 }, sessions[manager])
    await refusedDecision(request, delegate, 409)
    await h.setTime('2026-11-04T17:00:00.000Z')
    request = await ask()
    assert.deepEqual(request.delegations, [], 'requests outside the saved date range route to the named approver')
    const template = await cmd('job-template', { fromVacancy: job.id, name: 'Timed chain template' })
    const child = await cmd('vacancy-from-template', { template: template.id, title: 'Timed template job', location: 'Denver', compensation: RANGE, headcount: 1, manager }, sessions[manager])
    const clone = await cmd('clone-vacancy', { id: job.id, title: 'Timed cloned job' }, sessions[manager])
    for (const fresh of [child, clone]) {
      assert.deepEqual(fresh.approvalChain.steps, steps)
      const own = await cmd('request-vacancy-approval', { id: fresh.id }, sessions[manager])
      assert.deepEqual(own.decisions, [])
      assert.deepEqual(own.delegations, [], 'new jobs resolve their own current delegation rather than copying an earlier request')
      assert.equal(own.escalations, undefined)
      await cmd('publish', { id: fresh.id }, sessions[manager], 409)
    }
  } finally { await h.close() }
}
