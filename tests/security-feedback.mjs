import assert from 'node:assert/strict'

export async function checkFeedback(h) {
 const { application: app } = await h.command('candidate', { name: 'Feedback candidate', email: 'feedback@example.test', source: 'Referral', consentBasis: 'referral', vacancy: h.vacancy.id }, h.manager)
 await h.command('assign-reviewers', { application: app.id, reviewers: ['panel@example.test', 'review@example.test'] }, h.manager)
 const reviewerAgent = await h.member('reviewer-agent@example.test', [], 'Reviewer agent', { agent: true, actsFor: 'review@example.test' })
 const note = await h.command('note', { application: app.id, text: 'PRIVATE-DRAFT-NOTE exact evidence from the reviewer' }, h.reviewer)
 const criterion = h.vacancy.rubrics[0].criteria[0].id
 const proposalInput = { workflow: 'feedback-packet', summary: 'Private feedback draft', sources: [{ kind: 'interview-note', id: note.id }], changes: [{ op: 'scorecard', input: { application: app.id, ratings: { [criterion]: 3 }, evidence: { [criterion]: note.text } } }], citations: [{ criterion, note: note.id, quote: note.text }] }
 const proposal = await h.command('propose', proposalInput, reviewerAgent)
 for (const cookie of [h.owner, h.manager, h.panel, h.agent]) assert.ok(!(await h.state(cookie)).proposals.some(p => p.id === proposal.id), 'unreleased draft is private to its principal and agent')
 for (const cookie of [h.reviewer, reviewerAgent]) assert.equal((await h.state(cookie)).proposals.find(p => p.id === proposal.id).citations[0].quote, note.text)
 assert.equal((await h.send('/api/lodge/command/decide-proposal', { id: proposal.id, decision: 'approved', reason: 'Owner attempted independent feedback override' }, h.owner)).status, 404)
 assert.equal((await h.send('/api/lodge/command/propose', { ...proposalInput, approver: 'owner@example.test' }, reviewerAgent)).status, 403)
 const hiddenDecision = { id: proposal.id, decision: 'approved', reason: 'Unauthorized' }
 const hiddenBefore = await h.send('/api/lodge/command/decide-proposal', hiddenDecision, h.manager)
 assert.equal(hiddenBefore.status, 404)
 assert.deepEqual(hiddenBefore.value, { error: 'Proposal not found' })
 await h.command('decide-proposal', { id: proposal.id, decision: 'approved', reason: 'My evidence' }, h.reviewer)
 const hiddenAfter = await h.send('/api/lodge/command/decide-proposal', hiddenDecision, h.manager)
 assert.equal(hiddenAfter.status, hiddenBefore.status)
 assert.deepEqual(hiddenAfter.value, hiddenBefore.value, 'hidden draft status and approving email never become an error-message oracle')
 const card = await h.command('scorecard', { application: app.id, ratings: { [criterion]: 4 }, evidence: { [criterion]: 'RELEASED-SCORECARD-EVIDENCE' }, recommendation: 'yes', takeaways: 'Steady and specific', submit: true }, h.panel)
 const sourceProposal = source => ({ workflow: 'prepare-vacancy', approver: 'm1@example.test', summary: 'Prepare from permitted sources', sources: [source], changes: [{ op: 'vacancy', input: { ...h.pendingVacancy, description: 'Prepared with current permissions' } }] })
 for (const source of [{ kind: 'scorecard', id: card.id }, { kind: 'interview-note', id: note.id }, { kind: 'document', id: h.restricted.id }]) {
  const before = (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
  assert.equal((await h.send('/api/lodge/command/propose', sourceProposal(source), h.agent)).status, 404)
  assert.deepEqual((await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results, before)
 }
 await h.command('release-feedback', { application: app.id, reason: 'Panel submitted; reviewer draft intentionally withheld' }, h.manager)
 for (const cookie of [h.owner, h.manager, h.panel, h.agent]) {
  const view = await h.state(cookie)
  assert.ok(!view.proposals.some(p => p.id === proposal.id), 'release does not release private notes or draft payloads')
  assert.equal(view.scorecards.find(c => c.id === card.id).evidence[criterion], 'RELEASED-SCORECARD-EVIDENCE')
  assert.ok(!view.scorecards.some(c => c.author === 'review@example.test'))
 }
 const exported = await h.send('/api/lodge/download/candidate/' + app.candidate, undefined, h.owner)
 assert.equal(exported.status, 200)
 assert.equal(exported.value.scorecard.length, 1)
 assert.deepEqual(exported.value['interview-note'], [])
 assert.ok(!exported.text.includes('PRIVATE-DRAFT-NOTE'))
 assert.equal((await h.send('/api/lodge/command/propose', sourceProposal({ kind: 'scorecard', id: card.id }), h.agent)).status, 200)
 assert.equal((await h.send('/api/lodge/command/propose', sourceProposal({ kind: 'document', id: h.document.id }), h.agent)).status, 200)
 // Revoking a decision role while keeping the member active takes effect now.
 await h.command('member', { email: 'approve@example.test', name: 'Former approver', roles: ['interviewer'] })
 const decision = { id: h.pending.id, decision: 'approved', version: h.pending.version, reason: 'Old assignment' }
 const before = (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
 assert.equal((await h.send('/api/lodge/command/decide-approval', decision, h.approver)).status, 403)
 assert.deepEqual((await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results, before)
 await h.command('member', { email: 'approve@example.test', name: 'Inactive approver', roles: ['approver'], active: false })
 assert.equal((await h.send('/api/lodge/command/decide-approval', decision, h.approver)).status, 403)
 await h.command('member', { email: 'approve@example.test', name: 'Current approver', roles: ['approver'] })
 assert.equal((await h.send('/api/lodge/command/decide-approval', decision, h.approver)).status, 200)
 await h.command('member', { email: 'approve@example.test', name: 'Former approver', roles: ['interviewer'] })
 assert.equal((await h.send('/api/lodge/command/decide-approval', decision, h.approver)).status, 403, 'lost capability cannot probe a closed approval status')
 await h.command('member', { email: 'approve@example.test', name: 'Current approver', roles: ['approver'] })
 // Exact decision capabilities are checked separately for message and offer approvals.
 const privateMessage = await h.command('message', { application: app.id, purpose: 'other', subject: 'Reviewed terms', body: 'Exact private text' }, h.manager)
 const messageApproval = await h.command('request-message-approval', { id: privateMessage.id, approver: 'm2@example.test' }, h.manager)
 const newOffer = await h.command('offer', { application: app.id, title: 'Feedback role', salary: { currency: 'USD', amount: 150, period: 'year' }, startDate: '2026-12-10' }, h.manager)
 const offerApproval = await h.command('request-offer-approval', { id: newOffer.id, approver: 'approve@example.test' }, h.manager)
 for (const [request, email, cookie, role] of [[messageApproval, 'm2@example.test', h.otherManager, 'manager'], [offerApproval, 'approve@example.test', h.approver, 'approver']]) {
  await h.command('member', { email, name: 'Decision reviewer', roles: ['interviewer'] })
  const input = { id: request.id, decision: 'approved', version: request.version, reason: 'Exact terms' }
  const before = (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
  assert.equal((await h.send('/api/lodge/command/decide-approval', input, cookie)).status, 403)
  assert.deepEqual((await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results, before)
  assert.ok(!(await h.state(cookie)).approvals.some(a => a.id === request.id), 'revoked decision role also loses its terms projection')
  await h.command('member', { email, name: 'Decision reviewer', roles: [role] })
  assert.equal((await h.send('/api/lodge/command/decide-approval', input, cookie)).status, 200)
 }
 const ownerOverride = await h.command('request-message-approval', { id: privateMessage.id, approver: 'm2@example.test' }, h.manager)
 assert.equal((await h.send('/api/lodge/command/decide-approval', { id: ownerOverride.id, decision: 'approved', version: ownerOverride.version, reason: 'Owner decision' }, h.owner)).status, 200)
 // Availability remains a mutation even though it only depends on panel assignment.
 const iv = await h.command('interview', { application: app.id, planItem: h.vacancy.plan[0].id, participants: ['panel@example.test'], slots: ['2026-12-02T15:00:00Z'] }, h.manager)
 await h.command('member', { email: 'panel@example.test', name: 'Panel', roles: ['interviewer'], active: false })
 assert.equal((await h.send('/api/lodge/command/availability', { interview: iv.id, slots: [0] }, h.panel)).status, 403)
 assert.equal((await h.send('/api/lodge/state', undefined, h.panel)).status, 403)
 await h.command('member', { email: 'panel@example.test', name: 'Panel', roles: ['interviewer'] })
}
