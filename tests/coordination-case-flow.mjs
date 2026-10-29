import assert from 'node:assert/strict'
import { businessHarness } from './harness.mjs'
import { RANGE, RUBRIC } from './hiring-fixture.mjs'

const address = name => [name, 'example.test'].join('@')

export async function coordinationFixture() {
  const h = await businessHarness({ clock: '2030-10-07T12:00:00.000Z' })
  try {
    const managerEmail = address('synthetic-lodge-coordinator'), panellist = address('synthetic-lodge-panellist'), agentEmail = address('synthetic-lodge-case-agent'), recruiterEmail = address('synthetic-lodge-recruiter')
    const manager = await h.member(managerEmail, ['manager'], 'Case principal')
    const panel = await h.member(panellist, ['interviewer'], 'Responsible panellist')
    const recruiter = await h.member(recruiterEmail, ['manager'], 'Current recruiter')
    const agent = await h.member(agentEmail, [], 'Case agent', { agent: true, actsFor: managerEmail })
    const job = await h.command('vacancy', { title: 'Synthetic feedback coordination', location: 'Denver, CO', manager: managerEmail, headcount: 1, compensation: RANGE })
    await h.command('rubric', { id: job.id, criteria: RUBRIC })
    await h.command('interview-plan', { id: job.id, plan: [{ name: 'Work review', stageName: 'Interview' }] })
    await h.command('hiring-team', { id: job.id, recruiters: [recruiterEmail] })
    const ownerEmail = (await h.state()).actor.email
    const approval = await h.command('request-vacancy-approval', { id: job.id, approver: ownerEmail })
    await h.command('decide-approval', { id: approval.id, version: approval.version, decision: 'approved', reason: 'Reviewed' })
    const published = await h.command('publish', { id: job.id })
    const app = (await h.command('candidate', { name: 'Synthetic feedback candidate', email: address('synthetic-lodge-feedback-candidate'), vacancy: job.id, source: 'Direct', consentBasis: 'manual' })).application
    const iv = await h.command('interview', { application: app.id, planItem: published.plan[0].id, participants: [panellist], slots: ['2030-10-06T12:00:00.000Z'] })
    await h.command('schedule', { interview: iv.id, slot: 0 })
    return Object.assign(h, { managerEmail, manager, panel, panellist, recruiterEmail, recruiter, agentEmail, agent, job: published, app, iv, ownerEmail })
  } catch (error) { await h.close(); throw error }
}

export const caseProposal = (row, approver, owner, extra = {}) => ({
  workflow: 'feedback-coordination', case: row.id, sources: row.sources, approver, summary: 'Review native missing feedback ownership',
  input: { action: 'assign', owner, nextAction: 'Review the missing native feedback with the panellist', deadline: '2030-10-08T12:00:00.000Z' }, ...extra,
})

/** One public-door sanity journey: durable ownership, truthful readback, authority and erasure. */
export async function checkCoordinationCases() {
  const h = await coordinationFixture()
  try {
    const { command: cmd, send: rawSend, state, app, iv, panel, panellist, manager, managerEmail, recruiterEmail, agent, agentEmail } = h
    const send = (path, body, cookie = h.owner) => rawSend(path, body, cookie)
    const discover = () => send('/api/lodge/command/coordination-discover', { application: app.id, interview: iv.id, panellist }, manager)
    const mailBefore = (await h.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first()).n
    const initial = await Promise.all([discover(), discover()])
    assert.ok(initial.every(r => [200, 409].includes(r.status)), JSON.stringify(initial))
    let row = await cmd('coordination-discover', { application: app.id, interview: iv.id, panellist }, manager)
    const read = async () => (await state()).coordination.cases.find(c => c.id === row.id)
    const act = async input => { row = await read(); return cmd('coordination-case', { id: row.id, sources: row.sources, ...input }) }
    const approve = async packet => cmd('decide-proposal', { id: packet.id, decision: 'approved', reason: 'Human reviewed exact native case action' }, manager)
    assert.equal((await state()).coordination.cases.length, 1, 'concurrent and repeated discovery share one durable assignment key')
    assert.deepEqual([row.status, row.owner, row.confirmation], ['review-required', null, null])
    assert.equal((await send('/api/lodge/command/coordination-case', { id: row.id, action: 'assign' }, agent)).status, 403)
    const hidden = await send('/api/lodge/command/coordination-case', { id: row.id, action: 'stop', sources: row.sources, reason: 'Outside hiring authority' }, panel)
    const unknown = await send('/api/lodge/command/coordination-case', { id: 'synthetic-lodge-unknown', action: 'stop' }, panel)
    assert.equal(hidden.status, 404)
    assert.deepEqual(hidden.value, unknown.value, 'a panellist cannot probe case existence or mutate ownership')
    const packet = await cmd('propose', caseProposal(row, managerEmail, recruiterEmail), agent)
    assert.equal((await read()).owner, null, 'a proposal creates no ownership')
    const staleSources = row.sources
    await act({ action: 'assign', owner: managerEmail, nextAction: 'Human interim review', deadline: '2030-10-08T12:00:00.000Z' })
    assert.equal((await send('/api/lodge/command/decide-proposal', { id: packet.id, decision: 'approved', reason: 'Stale approval' }, manager)).status, 409)
    assert.equal((await send('/api/lodge/command/coordination-case', { id: row.id, sources: staleSources, action: 'stop', reason: 'Stale stop' })).status, 409)
    const currentPacket = await cmd('propose', caseProposal(await read(), managerEmail, recruiterEmail), agent)
    await approve(currentPacket)
    row = await read()
    assert.deepEqual([row.status, row.owner, row.nextAction], ['open', recruiterEmail, currentPacket.input.nextAction])
    const exported = await send('/api/lodge/download/vacancy/' + h.job.id)
    assert.equal(exported.status, 200)
    assert.equal(exported.value.coordinationCases[0].id, row.id, 'authorized job export retains case ownership and progress')
    assert.equal((await send('/api/lodge/download/vacancy/' + h.job.id, undefined, panel)).status, 404)
    await checkCaseRestore(h, row.id)
    await h.restart()
    assert.equal((await read()).owner, recruiterEmail, 'ownership and progress survive Worker restart')
    await h.setTime('2030-10-09T12:00:00.000Z')
    assert.equal((await read()).overdue, true, 'overdue remains visibly unresolved')
    const beforeRefusals = await read()
    for (const input of [{ action: 'complete' }, { action: 'reconcile', status: 'completed' }, { action: 'progress', nextAction: 'Review native feedback', deadline: '2030-10-09' }]) {
      assert.equal((await send('/api/lodge/command/coordination-case', { id: row.id, sources: (await read()).sources, ...input })).status, 400)
    }
    assert.deepEqual(await read(), beforeRefusals, 'unsafe assertions and ambiguous deadlines change no case history or ownership')
    const protectedPacket = caseProposal(await read(), managerEmail, recruiterEmail, { summary: 'Compare protected age before chasing feedback' })
    assert.equal((await send('/api/lodge/command/propose', protectedPacket, agent)).status, 400)
    const fabricated = caseProposal(await read(), managerEmail, recruiterEmail); fabricated.sources.push({ kind: 'monitoring', id: app.id, revision: 'synthetic-lodge-1' })
    assert.equal((await send('/api/lodge/command/propose', fabricated, agent)).status, 409, 'restricted or fabricated evidence is never accepted')
    await cmd('task', { application: app.id, owner: recruiterEmail, due: '2030-10-08', note: 'Review native feedback' })
    await act({ action: 'reconcile' })
    assert.equal((await read()).status, 'open', 'a generated task is not feedback completion')
    await cmd('scorecard', { application: app.id, recommendation: 'yes', takeaways: 'Application-only feedback', submit: true }, panel)
    await act({ action: 'reconcile' })
    assert.equal((await read()).status, 'open', 'application-only feedback cannot complete this interview case')
    const draft = await cmd('scorecard', { application: app.id, interview: iv.id, recommendation: 'yes', takeaways: 'Private native feedback', submit: false }, panel)
    assert.equal((await read()).status, 'open', 'a draft is not a submission')
    await cmd('scorecard', { application: app.id, interview: iv.id, recommendation: 'yes', takeaways: 'Private native feedback', submit: true }, panel)
    row = await read()
    assert.deepEqual([row.status, row.confirmation.scorecard, row.overdue], ['completed', draft.id, false])
    assert.equal((await state(agent)).scorecards.length, 0, 'readback never releases independent feedback content')
    assert.ok(!JSON.stringify((await state(agent)).coordination).includes('Private native feedback'))
    assert.ok(row.history.some(event => event.event === 'completed' && event.confirmation.scorecard === draft.id))
    await h.restart()
    assert.equal((await read()).status, 'completed')
    await h.setTime('2030-10-09T12:00:00.000Z')

    // A changed assignment invalidates prior local completion until human review.
    await cmd('assign-reviewers', { application: app.id, reviewers: [panellist] })
    assert.equal((await read()).status, 'review-required')
    await act({ action: 'assign', owner: recruiterEmail, nextAction: 'Review current assignment', deadline: '2030-10-10T12:00:00.000Z' })
    assert.equal((await read()).status, 'completed', 'human review can acknowledge the same genuine current submission')
    await cmd('cancel-interview', { interview: iv.id, reason: 'Panellist removed; replacement requires separate approval' })
    assert.equal((await read()).status, 'stopped', 'removing this panel cannot fabricate success for its replacement')

    // A second current case exercises principal and owner revocation before native submission.
    const second = await cmd('interview', { application: app.id, planItem: h.job.plan[0].id, participants: [panellist], slots: ['2030-10-08T12:00:00.000Z'] })
    await cmd('schedule', { interview: second.id, slot: 0 })
    row = await cmd('coordination-discover', { application: app.id, interview: second.id, panellist })
    const nextPacket = await cmd('propose', caseProposal(await read(), managerEmail, recruiterEmail), agent)
    await approve(nextPacket)
    await cmd('member', { email: recruiterEmail, name: 'Former recruiter', roles: ['manager'], active: false })
    assert.equal((await read()).status, 'review-required')
    assert.equal((await send('/api/lodge/command/coordination-case', { id: row.id, sources: (await read()).sources, action: 'assign', owner: recruiterEmail, nextAction: 'Unsafe owner', deadline: '2030-10-10T12:00:00.000Z' })).status, 403)
    await act({ action: 'assign', owner: managerEmail, nextAction: 'Current principal owns review', deadline: '2030-10-10T12:00:00.000Z' })
    const revokedPacket = await cmd('propose', caseProposal(await read(), managerEmail, managerEmail), agent)
    await approve(revokedPacket)
    await cmd('member', { email: agentEmail, name: 'Revoked case agent', roles: [], agent: true, actsFor: managerEmail, active: false })
    assert.equal((await read()).status, 'review-required', 'lost preparing authority is not success')
    assert.ok(!(await state()).proposals.some(p => p.id === revokedPacket.id), 'whole historical packet is hidden after preparer revocation')
    await cmd('member', { email: agentEmail, name: 'Case agent', roles: [], agent: true, actsFor: managerEmail, active: true })
    assert.equal((await read()).status, 'review-required', 'restoring an agent grant alone cannot resume a paused case')
    const pending = await cmd('propose', caseProposal(await read(), managerEmail, managerEmail), agent)
    await cmd('member', { email: managerEmail, name: 'Revoked principal', roles: [], active: false })
    assert.equal((await read()).status, 'review-required')
    assert.ok([401, 403].includes((await send('/api/lodge/state', undefined, agent)).status))
    assert.ok(!(await state()).proposals.some(p => p.id === pending.id))
    await act({ action: 'assign', owner: h.ownerEmail, nextAction: 'Owner manually reviews unresolved case', deadline: '2030-10-10T12:00:00.000Z' })
    await act({ action: 'stop', reason: 'Explicit human stop without completion' })
    assert.deepEqual([(await read()).status, (await read()).confirmation], ['stopped', null])
    await cmd('scorecard', { application: app.id, interview: second.id, recommendation: 'yes', takeaways: 'Feedback submitted after a human stopped coordination', submit: true }, panel)
    assert.deepEqual([(await read()).status, (await read()).confirmation], ['stopped', null], 'a later submission cannot undo the explicit human stop')
    await cmd('move', { application: app.id, to: 'withdrawn', reason: 'Candidate withdrew', closeReason: 'other-offer' })
    const erased = await send('/api/lodge/delete-candidate', { candidate: app.candidate, confirm: 'Synthetic feedback candidate', reason: 'Native erasure request' }, h.owner)
    assert.equal(erased.status, 200, erased.text)
    assert.equal((await state()).coordination.cases.length, 0)
    const stored = (await h.db.prepare("SELECT kind,value FROM l_records WHERE kind IN ('coordination-case','proposal')").all()).results
    assert.ok(stored.every(r => !r.value.includes(app.id) && !r.value.includes(iv.id)), 'erasure removes retained case history and related proposals')
    assert.equal((await send('/api/lodge/command/coordination-discover', { application: app.id, interview: second.id, panellist })).status, 404, 'replay cannot resurrect an erased case')
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first()).n, mailBefore, 'native coordination creates no outbound notices')
  } finally { await h.close() }
}

async function checkCaseRestore(h, caseId) {
  const { createPortability, readArchive } = await import('@runeditrun/rer/modules/portability')
  const { loadPolicy } = await import('@runeditrun/rer/internal/cli/portability-policy.mjs')
  const { harness } = await import('./harness.mjs')
  const row = (await h.state()).coordination.cases.find(c => c.id === caseId)
  const pending = await h.command('propose', caseProposal(row, h.managerEmail, h.recruiterEmail), h.agent)
  const policy = await loadPolicy(process.cwd(), undefined, 'scripts/installer/portability-policy.mjs')
  const source = await createPortability({ db: h.db, policy }), exportId = await source.exports.create(), records = []
  try {
    while ((await source.exports.advance(exportId, { maxParts: 16 })).phase === 'building') {}
    for await (const record of readArchive(await source.exports.download(exportId))) records.push(record)
  } finally { await source.exports.abort(exportId) }
  const dst = await harness({ claim: false, clock: '2030-10-07T12:00:00.000Z' })
  try {
    const target = await createPortability({ db: dst.db, policy }), id = await target.imports.create(records[0])
    for (const part of records.filter(r => r.kind === 'part')) await target.imports.uploadPart(id, part.index, part)
    const closing = records.at(-1)
    await target.imports.finalize(id, { contentHash: closing.contentHash, archiveHash: closing.archiveHash })
    assert.equal((await target.imports.status(id)).phase, 'complete')
    const owner = await dst.signIn(h.ownerEmail), manager = await dst.signIn(h.managerEmail), view = await dst.state(owner)
    const restored = view.coordination.cases.find(c => c.id === caseId)
    assert.deepEqual([restored.owner, restored.status, restored.confirmation], [null, 'review-required', null])
    assert.deepEqual(restored.history, row.history, 'native progress survives an archive without enabling actions')
    assert.equal(view.proposals.find(p => p.id === pending.id).status, 'withheld')
    assert.equal((await dst.send('/api/lodge/command/decide-proposal', { id: pending.id, decision: 'approved', reason: 'Replay pre-restore approval' }, manager)).status, 409)
    assert.equal((await dst.state(owner)).coordination.cases.find(c => c.id === caseId).owner, null)
  } finally { await dst.close() }
}
