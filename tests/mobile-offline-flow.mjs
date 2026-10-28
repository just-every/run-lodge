import assert from 'node:assert/strict'
import { hiringScenario, RUBRIC } from './hiring-fixture.mjs'

/** Native reconnect uses the same authenticated Worker and D1 command as the web. */
export async function checkMobileOffline(t) {
  const f = await hiringScenario(t)
  const { h, cmd, send, state, manager, ivy, ian, openJob } = f
  const address = name => name + String.fromCharCode(64) + 'example.test'
  const job = await openJob('synthetic-lodge-1')
  let sequence = 10
  const make = async () => {
    const { application } = await cmd('candidate', { name: 'synthetic-lodge-2', email: address('synthetic-lodge-' + sequence++), source: 'Referral', consentBasis: 'referral', vacancy: job.id }, manager)
    const iv = await cmd('interview', { application: application.id, planItem: job.plan[0].id, participants: [address('ivy')], slots: ['2027-01-04T15:00:00.000Z'] }, manager)
    await cmd('schedule', { interview: iv.id, slot: 0 }, manager)
    return { app: application, iv }
  }
  const kit = async (iv, cookie = ivy) => {
    const r = await send('/api/lodge/kit/' + iv.id, undefined, cookie)
    assert.equal(r.status, 200, r.text)
    assert.equal(r.value.application.length > 0, true)
    assert.equal(r.value.focus.length, 2)
    assert.match(r.value.offlineContext, /^[a-f0-9]{64}$/)
    return r.value
  }
  const draft = k => ({ application: k.application, interview: k.interview.id, offlineContext: k.offlineContext, rubricVersion: k.rubricVersion, submissionId: crypto.randomUUID(), submit: true, ratings: Object.fromEntries(k.focus.map(c => [c.id, 3])), evidence: Object.fromEntries(k.focus.map(c => [c.id, 'Described a concrete example.'])), recommendation: 'yes', takeaways: 'synthetic-lodge-3 independent feedback', notes: '' })
  const submit = (b, cookie = ivy) => send('/api/lodge/command/scorecard', b, cookie)
  const { app, iv } = await make(), captured = await kit(iv), b = draft(captured)
  assert.equal((await send('/api/lodge/kit/' + iv.id, undefined, ian)).status, 404, 'another interviewer cannot cache this kit')
  assert.equal((await submit({ ...b, rubricVersion: b.rubricVersion + 1 })).status, 409, 'a captured rubric version is checked independently')
  const concurrent = await Promise.all([submit(b), submit(b)])
  assert.ok(concurrent.every(r => [200, 409].includes(r.status)))
  const first = concurrent.find(r => r.status === 200)
  assert.ok(first, 'one concurrent request must commit')
  assert.equal(first.value.status, 'submitted')
  const audit = async () => (await h.db.prepare("SELECT COUNT(*) AS n FROM l_records WHERE kind='audit' AND json_extract(value,'$.action')='scorecard-submitted'").first()).n
  const count = await audit()
  assert.equal(count, 1, 'concurrent requests submit exactly once')
  await h.restart()
  const replay = await submit(b)
  assert.equal(replay.status, 200)
  assert.equal(replay.value.id, first.value.id, 'lost confirmation reconciles to the same scorecard after restart')
  assert.equal(await audit(), count, 'reconciliation creates no duplicate submission or audit event')
  assert.equal((await submit({ ...b, takeaways: 'Changed after submission' })).status, 409, 'a reused id cannot change submitted text')
  assert.equal((await state(ian)).scorecards.some(c => c.id === first.value.id), false, 'private feedback is not released')
  const next = await make(), cancelled = await make(), revoked = await make(), old = draft(await kit(next.iv))
  await cmd('unpublish', { id: job.id, reason: 'Review rubric' }, manager)
  await cmd('rubric', { id: job.id, criteria: RUBRIC }, manager)
  assert.equal((await submit(old)).status, 409, 'a changed job rubric refuses the original draft even if its old rubric remains')
  const revisionDraft = draft(await kit(next.iv))
  await cmd('assign-reviewers', { application: next.app.id, reviewers: [address('ivy'), address('ian')] }, manager)
  assert.equal((await submit(revisionDraft)).status, 409, 'an application revision change refuses the captured draft')
  const fresh = draft(await kit(next.iv))
  await cmd('scorecard', { ...fresh, offlineContext: undefined, submissionId: undefined, submit: false, notes: 'Edited in the web app' }, ivy)
  assert.equal((await submit(fresh)).status, 409, 'another saved draft cannot be overwritten')
  const stale = draft(await kit(cancelled.iv))
  await cmd('cancel-interview', { interview: cancelled.iv.id, reason: 'Panel changed' }, manager)
  assert.equal((await submit(stale)).status, 404, 'a removed interview assignment refuses submission')
  const pending = draft(await kit(revoked.iv))
  await cmd('member', { email: address('ivy'), name: 'Ivy Chen', roles: ['employee'] })
  assert.equal((await submit(pending)).status, 404, 'a role change cannot submit cached feedback')
  await cmd('member', { email: address('ivy'), name: 'Ivy Chen', roles: ['interviewer'] })
  assert.equal((await submit(pending)).status, 409, 'restoring a role never silently refreshes the original draft')
  const sessionDraft = draft(await kit(revoked.iv))
  await h.db.prepare('UPDATE oa_sessions SET revoked_at=1 WHERE id IN (SELECT se.id FROM oa_sessions se JOIN oa_operators o ON o.id=se.operator_id WHERE o.email=?)').bind(address('ivy')).run()
  assert.equal((await submit(sessionDraft)).status, 401, 'a revoked native session cannot replay a cached draft')
  const renewed = await h.signIn(address('ivy'))
  assert.equal((await submit(sessionDraft, renewed)).status, 409, 'a new sign-in does not adopt the old session draft')
  // An erased application cannot be revived by the old request or its reconciliation id.
  await cmd('mark-spam', { application: app.id, reason: 'synthetic-lodge-4 closed record' }, manager)
  await send('/api/lodge/delete-candidate', { candidate: app.candidate, confirm: 'synthetic-lodge-2', reason: 'synthetic-lodge-4 erasure' }, f.owner).then(r => assert.equal(r.status, 200, r.text))
  assert.equal((await submit(b, renewed)).status, 404)
  assert.equal((await state(f.owner)).scorecards.some(c => c.id === first.value.id), false)
}
