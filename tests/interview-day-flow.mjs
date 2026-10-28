import assert from 'node:assert/strict'
import { businessHarness } from './harness.mjs'
import { RANGE, RUBRIC } from './hiring-fixture.mjs'

// One native scheduling journey. Provider boundaries are counted at the network edge.
export async function checkInterviewDay(t) {
  let providerCalls = 0
  const h = await businessHarness({ clock: '2027-03-01T12:00:00Z', outboundService: () => { providerCalls++; return new Response('No provider authorized', { status: 503 }) } })
  t.after(() => h.close())
  const { command: cmd, state, send } = h
  const address = n => ['synthetic-lodge-' + n, 'example.test'].join('@')
  const [a, b, c, managerAddress, outsiderAddress] = [1, 2, 3, 4, 5].map(address)
  const manager = await h.member(managerAddress, ['manager'], 'Synthetic coordinator')
  const sessions = []
  for (const who of [a, b, c]) sessions.push(await h.member(who, ['interviewer'], 'Synthetic panellist ' + sessions.length))
  const outsider = await h.member(outsiderAddress, ['manager'], 'Unrelated coordinator')
  let job = await cmd('vacancy', { title: 'Synthetic interview day', location: 'New York', headcount: 1, manager: managerAddress, compensation: RANGE }, manager)
  await cmd('rubric', { id: job.id, criteria: RUBRIC }, manager)
  job = await cmd('interview-plan', { id: job.id, plan: ['Safety', 'Work review', 'Team review'].map(name => ({ name, stageName: 'Interview', durationMinutes: 30 })) }, manager)
  const approval = await cmd('request-vacancy-approval', { id: job.id, approver: h.owner ? (await state()).actor.email : '' }, manager)
  await cmd('decide-approval', { id: approval.id, version: approval.version, decision: 'approved', reason: 'Reviewed native fixture' })
  job = await cmd('publish', { id: job.id }, manager)
  const added = await cmd('candidate', { vacancy: job.id, name: 'Synthetic day candidate', email: address(6), source: 'Employer referral', consentBasis: 'application' }, manager)
  const app = added.application
  const range = (start, end) => ({ start, end })
  const available = [range('2027-03-15T08:00:00Z', '2027-03-15T23:00:00Z')]
  const poolInput = { vacancy: job.id, version: 0, name: 'Declared safety pool', members: [a, b, c].map((email, i) => ({ email, qualifications: ['safety'], timezone: i === 1 ? 'America/Los_Angeles' : 'America/New_York', dailyCap: i === 2 ? 1 : 2, breakMinutes: 15, weekdays: [1, 2, 3, 4, 5], workStart: i === 1 ? '07:00' : '09:00', workEnd: '17:00', availability: available, evidence: 'Employer recorded qualification and availability' })), rooms: [{ name: 'North room', availability: available, busy: [], evidence: 'Employer room declaration' }] }
  const pool = await cmd('interviewer-pool', poolInput, manager)
  assert.equal((await send('/api/lodge/command/interviewer-pool', poolInput, outsider)).status, 403)
  assert.equal((await send('/api/lodge/command/interviewer-pool', poolInput, sessions[0])).status, 403)
  const input = { application: app.id, poolVersion: pool.version, candidateTimezone: 'America/New_York', candidateAvailability: available, candidateBreakMinutes: 15, sessions: job.plan.map((p, i) => ({ planItem: p.id, starts: ['2027-03-15T' + [14, 15, 16][i] + ':00:00Z'], qualifications: ['safety'], required: i === 0 ? [a] : i === 1 ? [b] : [], optional: [c], size: 1, room: 'North room' })) }
  const create = (body = input, cookie = manager) => cmd('interview-day', body, cookie)
  const review = (draft, cookie = manager) => send('/api/lodge/command/interview-day-review', { id: draft.id, fingerprint: draft.fingerprint, alternative: 0 }, cookie)
  const production = async () => (await h.db.prepare("SELECT kind,id,value FROM l_records WHERE kind IN ('interview','scorecard','application','notification') ORDER BY kind,id").all()).results
  // Preserve a real production interview and independent draft scorecard, not just empty arrays.
  const interview = await cmd('interview', { application: app.id, planItem: job.plan[0].id, participants: [a], slots: ['2027-03-16T14:00:00Z'] }, manager)
  await cmd('schedule', { interview: interview.id, slot: 0 }, manager)
  await cmd('scorecard', { application: app.id, interview: interview.id, ratings: {}, evidence: {}, submit: false }, sessions[0])
  const before = await production(), callsBefore = providerCalls
  const feasible = await create()
  assert.equal(feasible.alternatives.length, 2)
  // Expected sets are independently enumerated: compulsory A, compulsory B, then either A or B.
  assert.deepEqual(feasible.alternatives.map(day => day.map(s => s.participants)), [[[a, c], [b], [a]], [[a, c], [b], [b]]])
  assert.deepEqual(feasible.alternatives[0].map(s => s.omitted), [[], [c], [c]])
  assert.equal(feasible.providerAvailability, 'unverified')
  assert.equal(feasible.resourceAvailability, 'manually-declared-unverified')
  assert.ok(feasible.conflicts.some(x => x.includes('daily cap')), 'optional caps are explained')
  assert.deepEqual((await state(sessions[1])).applications, [], 'pool declaration and draft choice grant no candidate access')
  assert.deepEqual((await state(sessions[1])).scheduling, { jobs: [], pools: [], drafts: [] })
  assert.equal((await review(feasible, outsider)).status, 404)
  assert.equal((await review(feasible, sessions[0])).status, 403)
  await h.restart()
  assert.equal((await review(feasible)).status, 200, 'current human reviews the same durable exact draft after restart')
  assert.equal((await review(feasible)).status, 409, 'replay does not apply or duplicate a review')
  assert.deepEqual(await production(), before)
  assert.equal(providerCalls, callsBefore, 'drafts and review make zero provider calls')

  const conflict = async (body, expected) => {
    const draft = await create(body)
    assert.deepEqual(draft.alternatives, [], expected + ' must prevent all panels')
    assert.ok(draft.conflicts.some(s => s.includes(expected)), JSON.stringify(draft.conflicts))
    assert.equal((await review(draft)).status, 400, 'no infeasible panel can be reviewed')
  }
  await conflict({ ...input, sessions: input.sessions.map(x => ({ ...x, qualifications: ['undeclared'] })) }, 'qualification')
  await conflict({ ...input, sessions: input.sessions.map(x => ({ ...x, required: [a], optional: [] })) }, 'daily cap')
  await conflict({ ...input, sessions: input.sessions.map((x, i) => ({ ...x, required: [a], optional: [], starts: [i === 1 ? '2027-03-15T14:35:00Z' : x.starts[0]] })), candidateBreakMinutes: 0 }, 'insufficient break')
  await conflict({ ...input, candidateAvailability: [range('2027-03-15T18:00:00Z', '2027-03-15T19:00:00Z')] }, 'candidate has no recorded availability')
  await conflict({ ...input, sessions: input.sessions.map(x => ({ ...x, starts: ['2027-03-15T11:00:00Z'] })) }, 'working hours')
  await conflict({ ...input, excluded: [a] }, 'excluded')

  let currentPool = pool
  const configure = async change => {
    currentPool = await cmd('interviewer-pool', { ...poolInput, ...change, version: currentPool.version }, manager)
    input.poolVersion = currentPool.version
  }
  const beforeConfig = await create()
  await configure({ rooms: [{ ...poolInput.rooms[0], busy: [range('2027-03-15T14:00:00Z', '2027-03-15T14:45:00Z')] }] })
  assert.equal((await review(beforeConfig)).status, 409, 'configuration revisions refuse stale human review')
  await conflict(input, 'room is unavailable')
  assert.deepEqual(currentPool.versions[0], pool.versions[0], 'declarations preserve their earlier versions')
  await configure({})
  const stale = await create()
  await cmd('assign-reviewers', { application: app.id, reviewers: [a] }, manager)
  assert.equal((await review(stale)).status, 409, 'assignment changes invalidate review')
  const removal = await create()
  await cmd('member', { email: a, name: 'Synthetic panellist 0', roles: ['interviewer'], active: false })
  assert.equal((await review(removal)).status, 409, 'removed panellist invalidates review')
  const replacement = await create({ ...input, excluded: [a], sessions: input.sessions.map(x => ({ ...x, required: [], optional: [c] })) })
  assert.equal(replacement.alternatives.length, 0, 'one remaining compulsory filler cannot cover three sessions under cap two')
  await cmd('member', { email: a, name: 'Synthetic panellist 0', roles: ['interviewer'], active: true })
  const substitute = await create({ ...input, excluded: [a], sessions: input.sessions.map((x, i) => ({ ...x, required: i === 2 ? [c] : [b], optional: [] })) })
  assert.equal(substitute.alternatives.length, 1)
  assert.deepEqual(substitute.alternatives[0].map(s => s.participants), [[b], [b], [c]])
  assert.equal((await review(substitute)).status, 200, 'human can review a feasible draft substitute without applying it')
  const changedAuthority = await create()
  const restricted = await cmd('permission-level', { name: 'Read only coordinator', permissions: ['contact'] })
  await cmd('job-levels', { id: job.id, members: { [managerAddress]: restricted.id } })
  assert.equal((await review(changedAuthority)).status, 403, 'current job settings authority is required')
  assert.deepEqual((await state(manager)).scheduling.drafts, [], 'revoked authority hides previous drafts')
  await cmd('job-levels', { id: job.id, members: {} })
  assert.equal((await review(changedAuthority)).status, 409, 'restored permission alone does not restore stale review')

  // DST uses actual instants and each person's local working clock, never a fixed UTC offset.
  const dstDays = [['2027-03-12', '14', false], ['2027-03-15', '13', true]]
  for (const [day, hour, expected] of dstDays) {
    const broad = [range(day + 'T08:00:00Z', day + 'T23:00:00Z')]
    await configure({ members: poolInput.members.map(m => ({ ...m, workStart: '09:00', availability: broad })), rooms: [{ ...poolInput.rooms[0], availability: broad }] })
    const draft = await create({ ...input, candidateAvailability: broad, sessions: [{ ...input.sessions[0], required: [a], optional: [], starts: [day + 'T' + hour + ':00:00Z'] }] })
    assert.equal(draft.alternatives.length > 0, true, 'New York 09:00 fits before and after US daylight saving')
    const west = await create({ ...input, candidateAvailability: broad, sessions: [{ ...input.sessions[0], required: [b], optional: [], starts: [day + 'T16:00:00Z'] }] })
    assert.equal(west.alternatives.length > 0, expected, 'Los Angeles 16:00 UTC changes from 08:00 to 09:00 after DST')
  }
  const history = await send('/api/lodge/download/vacancy/' + job.id, undefined, manager)
  assert.ok(history.value.interviewDays.some(d => d.id === feasible.id), 'authorized history includes native drafts')
  assert.equal(providerCalls, callsBefore)
  const candidateBefore = (await state()).applications.find(x => x.id === app.id)
  assert.equal(candidateBefore.status, 'active')
  assert.deepEqual(candidateBefore.reviewers, [a], 'review never replaces independent assignments')
  await cmd('move', { application: app.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Synthetic journey completed' }, manager)
  const erase = await send('/api/lodge/delete-candidate', { candidate: added.candidate.id, confirm: added.candidate.name, reason: 'Synthetic erasure request' }, h.owner)
  assert.equal(erase.status, 200, erase.text)
  assert.ok(erase.value.counts['interview-day'] > 0)
  assert.equal((await review(feasible)).status, 404, 'erasure removes drafts and replay cannot recreate them')
}
