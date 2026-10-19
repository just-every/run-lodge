// OPS-004: named permission levels assigned on a job, a team role or a
// department grant, enforced through the app state, API commands, exports and
// an agent's read, and changed at once.
import assert from 'node:assert/strict'

const MANAGER = ['contact', 'scorecards', 'move', 'reject', 'offers', 'export', 'settings']

export async function checkLevels(h) {
  const { command: cmd, send, state, owner } = h
  const m1 = h.manager, m2 = h.otherManager, vacancy = h.vacancy
  const level = (body, cookie = owner) => send('/api/lodge/command/permission-level', body, cookie)
  assert.equal((await level({ name: 'Mine', permissions: MANAGER }, m1)).status, 403, 'admins define levels')
  assert.equal((await level({ name: 'Peek', permissions: [...MANAGER, 'monitoring'] })).status, 409, 'no level grants monitoring answers')
  assert.equal((await level({ name: 'Peek', permissions: ['accommodation requests'] })).status, 409)
  assert.equal((await level({ name: 'Odd', permissions: ['payroll'] })).status, 400)
  const noOffers = (await level({ name: 'Hiring manager without offers', permissions: MANAGER.filter(p => p !== 'offers') })).value

  await cmd('release-feedback', { application: h.app.id, reason: 'Panel submitted' }, m1)
  await cmd('job-levels', { id: vacancy.id, members: { 'm1@example.test': noOffers.id } })
  const offersSeen = async cookie => (await state(cookie)).offers.filter(o => o.application === h.app.id).length
  // Offers vanish from the app state, the agent's read, the vacancy export, the packet and handoff; released scorecards stay.
  for (const cookie of [m1, h.agent]) {
    const w = await state(cookie)
    assert.deepEqual([w.offers.length, w.scorecards.some(c => c.application === h.app.id && c.status === 'submitted')], [0, true])
    assert.ok(!w.activity.some(e => e.kind === 'offer') && !w.approvals.some(x => x.subjectKind === 'offer'))
  }
  assert.deepEqual((await send('/api/lodge/download/vacancy/' + vacancy.id, undefined, m1)).value.offers, [])
  assert.equal((await send('/api/lodge/download/packet/' + h.offer.id, undefined, m1)).status, 404)
  assert.equal((await send('/api/lodge/download/handoff/' + h.offer.id, undefined, m1)).status, 404)
  assert.equal((await send('/api/lodge/command/offer', { id: h.offer.id, application: h.app.id, title: 'Changed', salary: h.offer.salary, startDate: h.offer.startDate, opening: h.offer.opening }, m1)).status, 403)
  // Allowing offers on the level gives them back at once.
  await cmd('permission-level', { id: noOffers.id, name: 'Hiring manager without offers', permissions: MANAGER })
  assert.deepEqual([await offersSeen(m1), await offersSeen(h.agent)], [1, 1])
  assert.equal((await level({ id: noOffers.id, name: 'Hiring manager without offers', permissions: [...MANAGER, 'voluntary monitoring'] })).status, 409)

  // A level with none of the permissions: each door refuses its own action.
  const bare = (await level({ name: 'Observer', permissions: [] })).value
  await cmd('job-levels', { id: vacancy.id, members: { 'm1@example.test': bare.id } })
  const stages = (await state(m1)).vacancies.find(v => v.id === vacancy.id).stages
  const refused = async (op, body) => assert.equal((await send('/api/lodge/command/' + op, body, m1)).status, 403, op)
  await refused('move', { application: h.app.id, to: stages[1].id, reason: 'Next' })
  await refused('move', { application: h.app.id, to: 'rejected', closeReason: 'skills' })
  await refused('job-questions', { id: vacancy.id, questions: [] })
  assert.equal((await send('/api/lodge/download/vacancy/' + vacancy.id, undefined, m1)).status, 403)
  assert.equal((await send('/api/lodge/download/activity/' + h.candidate.id, undefined, m1)).status, 403)
  let w = await state(m1)
  assert.deepEqual([w.candidates.find(c => c.id === h.candidate.id).email, w.scorecards.some(c => c.application === h.app.id), w.vacancies.find(v => v.id === vacancy.id).permissions], [undefined, false, []])
  // "See private candidates" clears this job's private candidates only.
  await cmd('candidate-privacy', { id: h.candidate.id, private: true })
  assert.equal((await state(m1)).applications.some(a => a.id === h.app.id), false)
  const privateLevel = (await level({ name: 'Private reader', permissions: ['private'] })).value
  await cmd('job-levels', { id: vacancy.id, members: { 'm1@example.test': privateLevel.id } })
  assert.equal((await state(m1)).applications.some(a => a.id === h.app.id), true)
  await cmd('candidate-privacy', { id: h.candidate.id, private: false })
  // "Approve": a manager who is also an approver, held to a level without it, cannot decide the job's terms.
  const both = await h.member('both@example.test', ['manager', 'approver'])
  const asked = await cmd('request-vacancy-approval', { id: h.pendingVacancy.id, approver: 'both@example.test' }, m1)
  await cmd('job-levels', { id: h.pendingVacancy.id, members: { 'both@example.test': bare.id } })
  assert.equal((await send('/api/lodge/command/decide-approval', { id: asked.id, decision: 'approved', version: asked.version, reason: 'ok' }, both)).status, 403)
  await cmd('job-levels', { id: h.pendingVacancy.id, members: {} })
  assert.equal((await send('/api/lodge/command/decide-approval', { id: asked.id, decision: 'approved', version: asked.version, reason: 'ok' }, both)).status, 200, 'the seeded approver rights return')
  assert.equal((await send('/api/lodge/command/delete-permission-level', { id: bare.id }, owner)).status, 200, 'an unused level can be deleted')
  assert.equal((await send('/api/lodge/command/delete-permission-level', { id: privateLevel.id }, owner)).status, 409, 'a level in use cannot')

  // The job's REQ-003 coordinator under a level without offers sees none on that job, and their own job's offer still.
  const coordinator = (await level({ name: 'Coordinator without offers', permissions: MANAGER.filter(p => p !== 'offers') })).value
  await cmd('hiring-team', { id: vacancy.id, coordinators: ['m2@example.test'] })
  await cmd('job-levels', { id: vacancy.id, members: {}, roles: { coordinators: coordinator.id } })
  const own = await cmd('candidate', { name: 'Own Candidate', email: 'own@example.test', source: 'Referral', consentBasis: 'referral', vacancy: h.otherVacancy.id }, m2)
  await cmd('offer', { application: own.application.id, title: 'Own role', salary: { currency: 'USD', amount: 150, period: 'year' }, startDate: '2026-12-10', opening: h.otherVacancy.openings[0].id }, m2)
  w = await state(m2)
  assert.deepEqual([w.applications.some(a => a.id === h.app.id), w.offers.map(o => o.application)], [true, [own.application.id]])
  assert.deepEqual([await offersSeen(m1)], [1], 'the job’s own manager keeps Lodge’s seeded rights')

  // A department grant carries its level to the department's jobs.
  const ops = await cmd('department', { name: 'Field operations' })
  const v = await cmd('vacancy', { title: 'Field lead', departmentId: ops.id, headcount: 1, manager: 'm1@example.test', compensation: vacancy.compensation }, m1)
  await cmd('member-org', { email: 'm2@example.test', grantDepartments: [ops.id], grantLevels: { [ops.id]: coordinator.id } })
  assert.deepEqual((await state(m2)).vacancies.find(x => x.id === v.id).permissions.sort(), MANAGER.filter(p => p !== 'offers').sort())
  assert.equal((await send('/api/lodge/command/member-org', { email: 'm2@example.test', grantDepartments: [], grantLevels: { [ops.id]: coordinator.id } }, owner)).status, 400, 'a level goes with a grant')
}
