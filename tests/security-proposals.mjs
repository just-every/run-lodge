import assert from 'node:assert/strict'

const snapshot = async h => (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
const decision = (proposal, action = 'approved') => ({ id: proposal.id, decision: action, reason: 'Review current authority' })
async function visible(h, cookies, proposals, expected) {
 for (const cookie of cookies) {
  const view = await h.state(cookie)
  for (const proposal of proposals) assert.equal(view.proposals.some(p => p.id === proposal.id), expected, `${proposal.workflow} visibility follows current source fields and change permissions`)
 }
}
async function deniedDecisions(h, cookie, proposals) {
 for (const proposal of proposals) for (const action of ['approved', 'rejected']) {
  const before = await snapshot(h), result = await h.send('/api/lodge/command/decide-proposal', decision(proposal, action), cookie)
  assert.equal(result.status, 404, result.text)
  assert.deepEqual(result.value, { error: 'Proposal not found' })
  assert.deepEqual(await snapshot(h), before)
 }
}

export async function checkProposalAuthority(h) {
 const added = await h.command('candidate', { name: 'Proposal candidate', email: 'proposal@example.test', source: 'Referral', consentBasis: 'referral', vacancy: h.vacancy.id }, h.manager)
 const app = added.application, candidate = added.candidate
 await h.command('assign-reviewers', { application: app.id, reviewers: ['panel@example.test', 'review@example.test'] }, h.manager)
 const document = await h.command('document', { application: app.id, name: 'evidence.txt', base64: Buffer.from('Source evidence').toString('base64') }, h.manager)
 const interview = await h.command('interview', { application: app.id, planItem: h.vacancy.plan[0].id, participants: ['panel@example.test'], slots: ['2026-12-07T15:00:00Z'] }, h.manager)
 await h.command('schedule', { interview: interview.id, slot: 0 }, h.manager)
 h = { ...h, app, candidate, document, interview }
 const newVacancy = await h.command('propose', { workflow: 'prepare-vacancy', approver: 'm1@example.test', summary: 'New vacancy', intake: 'Budget for a new team member', changes: [
  { op: 'vacancy', input: { title: 'Proposed role', manager: 'm1@example.test', compensation: h.vacancy.compensation } },
  { op: 'vacancy-stages', input: { id: { $result: 0 }, stages: [{ name: 'Applied' }, { name: 'Interview' }] } },
  { op: 'rubric', input: { id: { $result: 1 }, criteria: [{ name: 'Experience', description: 'Evidence from prior work' }] } },
  { op: 'interview-plan', input: { id: { $result: 2 }, plan: [{ name: 'Conversation', stageName: 'Interview' }] } },
 ] }, h.agent)
 const coordination = await h.command('propose', { workflow: 'coordination', approver: 'm1@example.test', summary: 'Arrange a follow-up', sources: [{ kind: 'candidate', id: h.candidate.id }, { kind: 'interview', id: h.interview.id }, { kind: 'document', id: h.document.id }], changes: [
  { op: 'message', input: { application: h.app.id, purpose: 'interview-invitation', subject: 'A follow-up', body: 'Please join the next interview', to: h.candidate.email } },
  { op: 'interview', input: { application: h.app.id, planItem: h.vacancy.plan[0].id, participants: ['panel@example.test'], slots: ['2026-12-07T15:00:00Z'] } },
  { op: 'schedule', input: { interview: { $result: 1 }, slot: 0 } },
 ] }, h.agent)
 const ownerPrepared = await h.command('propose', { workflow: 'prepare-vacancy', approver: 'm1@example.test', summary: 'Owner prepares manager review', sources: [{ kind: 'vacancy', id: h.pendingVacancy.id }], changes: [{ op: 'vacancy', input: { ...h.pendingVacancy, description: 'Owner wording for review' } }] })
 await h.command('decide-proposal', decision(ownerPrepared, 'rejected'), h.manager)
 await visible(h, [h.owner, h.manager, h.agent], [ownerPrepared], true)
 const managerPrepared = await h.command('propose', { workflow: 'prepare-vacancy', approver: 'owner@example.test', summary: 'Manager asks owner to review', sources: [{ kind: 'vacancy', id: h.pendingVacancy.id }], changes: [{ op: 'vacancy', input: { ...h.pendingVacancy, description: 'Manager wording for owner review' } }] }, h.agent)
 await visible(h, [h.owner, h.manager, h.agent], [managerPrepared], true)
 await h.command('decide-proposal', decision(managerPrepared, 'rejected'))
 const managerProposals = [h.proposal, newVacancy, coordination, managerPrepared]
 await visible(h, [h.manager, h.agent], managerProposals, true)
 await h.command('assign-reviewers', { application: h.app.id, reviewers: ['m1@example.test', 'panel@example.test', 'review@example.test'] }, h.manager)
 await h.command('member', { email: 'm1@example.test', name: 'Former manager', roles: ['interviewer'] })
 await visible(h, [h.manager, h.agent], managerProposals, false)
 for (const cookie of [h.manager, h.agent]) {
  const view = await h.state(cookie)
  assert.ok(view.applications.some(a => a.id === h.app.id), 'current reviewer keeps the redacted application')
  assert.equal(view.vacancies.find(v => v.id === h.vacancy.id).compensation, undefined)
  assert.equal(view.candidates.find(c => c.id === h.candidate.id).email, undefined)
  assert.ok(!view.vacancies.some(v => v.id === h.pendingVacancy.id))
 }
 await deniedDecisions(h, h.manager, managerProposals)
 // The creator cannot use another capable approver to regain their own lost grant.
 const before = await snapshot(h)
 assert.equal((await h.send('/api/lodge/command/propose', { workflow: 'prepare-vacancy', approver: 'owner@example.test', intake: 'A vacancy', summary: 'Old creator grant', changes: [{ op: 'vacancy', input: { title: 'Out of scope', manager: 'owner@example.test' } }] }, h.agent)).status, 403)
 assert.deepEqual(await snapshot(h), before)
 let refused
 for (const id of [h.pendingVacancy.id, crypto.randomUUID()]) {
  const response = await h.send('/api/lodge/command/propose', { workflow: 'prepare-vacancy', approver: 'owner@example.test', intake: 'Terms for the owner', summary: 'Cannot probe targets through another reviewer', changes: [{ op: 'vacancy', input: { id, title: 'Hidden target', manager: 'owner@example.test' } }] }, h.agent)
  assert.equal(response.status, 403)
  if (refused) assert.deepEqual(response.value, refused, 'hidden and nonexistent targets produce the same refusal before dry-run')
  refused = response.value
  assert.deepEqual(await snapshot(h), before)
 }
 await h.command('member', { email: 'm1@example.test', name: 'Current manager', roles: ['manager'] })
 await visible(h, [h.manager, h.agent], managerProposals, true)
 await h.command('decide-proposal', decision(newVacancy), h.manager)
 await h.command('decide-proposal', decision(coordination), h.manager)
 await visible(h, [h.manager, h.agent], [newVacancy, coordination], true)
 const appliedView = await h.state(h.manager)
 const coordinated = appliedView.interviews.find(i => i.id === appliedView.proposals.find(p => p.id === coordination.id).results[1])
 assert.equal(coordinated.status, 'scheduled')
 await h.command('member', { email: 'm1@example.test', name: 'Former manager', roles: ['interviewer'] })
 await visible(h, [h.manager, h.agent], managerProposals, false)
 await deniedDecisions(h, h.manager, [newVacancy, coordination])
 await h.command('member', { email: 'm1@example.test', name: 'Current manager', roles: ['manager'] })

 // Keep management of the proposal's target while removing only source fields.
 // Full candidate consent/retention source fields must not leak via a packet
 // once an admin becomes that candidate's ordinary manager.
 await h.command('member', { email: 'm1@example.test', name: 'Hiring admin', roles: ['admin', 'manager'] })
 const privateSource = await h.command('propose', { workflow: 'prepare-vacancy', approver: 'm1@example.test', summary: 'Plan using candidate history', rationale: 'Consent and retention reviewed', sources: [{ kind: 'candidate', id: h.candidate.id }], changes: [{ op: 'vacancy', input: { ...h.pendingVacancy, description: 'Prepared by hiring admin' } }] }, h.agent)
 await visible(h, [h.manager, h.agent], [privateSource], true)
 await h.command('member', { email: 'm1@example.test', name: 'Current manager', roles: ['manager'] })
 const managerView = await h.state(h.manager)
 assert.equal(managerView.vacancies.find(v => v.id === h.pendingVacancy.id).manages, true)
 assert.equal(managerView.candidates.find(c => c.id === h.candidate.id).email, h.candidate.email)
 assert.equal(managerView.candidates.find(c => c.id === h.candidate.id).consent, undefined)
 await visible(h, [h.manager, h.agent], [privateSource], false)
 await deniedDecisions(h, h.manager, [privateSource])
 await h.command('member', { email: 'm1@example.test', name: 'Hiring admin', roles: ['admin', 'manager'] })
 await h.command('decide-proposal', decision(privateSource, 'rejected'), h.manager)
 await visible(h, [h.manager, h.agent], [privateSource], true)
 await h.command('member', { email: 'm1@example.test', name: 'Current manager', roles: ['manager'] })

 // Feedback stays private after role removal even when the assignment remains.
 const reviewerAgent = await h.member('role-review-agent@example.test', [], 'Reviewer agent', { agent: true, actsFor: 'review@example.test' })
 const note = await h.command('note', { application: h.app.id, text: 'Exact private role-removal evidence' }, h.reviewer)
 const criterion = h.vacancy.rubrics[0].criteria[0].id
 const feedback = await h.command('propose', { workflow: 'feedback-packet', summary: 'Feedback', sources: [{ kind: 'interview-note', id: note.id }], citations: [{ note: note.id, criterion, quote: note.text }], changes: [{ op: 'scorecard', input: { application: h.app.id, ratings: { [criterion]: 3 }, evidence: { [criterion]: note.text } } }] }, reviewerAgent)
 await h.command('member', { email: 'review@example.test', name: 'Former reviewer', roles: ['approver'] })
 await visible(h, [h.reviewer, reviewerAgent], [feedback], false)
 await deniedDecisions(h, h.reviewer, [feedback])
 await h.command('member', { email: 'review@example.test', name: 'Current reviewer', roles: ['interviewer'] })
 await h.command('decide-proposal', decision(feedback), h.reviewer)
 await visible(h, [h.reviewer, reviewerAgent], [feedback], true)

 // Rediscovery keeps full talent-pool evidence with capable reviewers. A
 // packet must not claim the admin prepared it from a manager's narrower view.
 const poolAdmin = await h.member('pool-admin@example.test', ['admin'])
 const poolAgent = await h.member('pool-agent@example.test', [], 'Talent-pool agent', { agent: true, actsFor: 'pool-admin@example.test' })
 const { candidate: poolCandidate } = await h.command('candidate', { name: 'Contactable candidate', email: 'contactable@example.test', source: 'Referral', consentBasis: 'referral', talentPool: true, vacancy: h.vacancy.id }, h.manager)
 const rediscoveryInput = { workflow: 'rediscovery', approver: 'm1@example.test', summary: 'Consider another current vacancy', sources: [{ kind: 'candidate', id: poolCandidate.id }], changes: [{ op: 'apply', input: { candidate: poolCandidate.id, vacancy: h.otherVacancy.id, source: 'Talent pool' } }] }
 const crossFieldBefore = await snapshot(h)
 assert.equal((await h.send('/api/lodge/command/propose', rediscoveryInput, poolAgent)).status, 403, 'admin source consent cannot be carried into a manager packet')
 assert.deepEqual(await snapshot(h), crossFieldBefore)
 rediscoveryInput.approver = 'pool-admin@example.test'
 const rediscovery = await h.command('propose', rediscoveryInput, poolAgent)
 await visible(h, [poolAdmin, poolAgent], [rediscovery], true)
 await h.command('member', { email: 'pool-admin@example.test', name: 'Former pool admin', roles: ['approver'] })
 await visible(h, [poolAdmin, poolAgent], [rediscovery], false)
 await deniedDecisions(h, poolAdmin, [rediscovery])
 await h.command('member', { email: 'pool-admin@example.test', name: 'Pool admin', roles: ['admin'] })
 await h.command('correct-candidate', { ...poolCandidate, talentPool: false, reason: 'Withdraw permission' })
 await visible(h, [poolAdmin, poolAgent], [rediscovery], false)
 await deniedDecisions(h, poolAdmin, [rediscovery])
 await h.command('correct-candidate', { ...poolCandidate, talentPool: true, reason: 'Fresh permission recorded' })
 const fresh = await h.command('propose', rediscoveryInput, poolAgent)
 await h.command('decide-proposal', decision(fresh), poolAdmin)
 await visible(h, [poolAdmin, poolAgent], [fresh], true)
 assert.ok((await h.state(h.manager)).applications.some(a => a.candidate === poolCandidate.id && a.vacancy === h.otherVacancy.id))
}
