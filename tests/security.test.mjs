import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './security-fixture.mjs'
import { checkReviewerAuthority } from './security-authority.mjs'
import { checkProposalAuthority } from './security-proposals.mjs'
import { checkFeedback } from './security-feedback.mjs'
import { checkImportedHistory } from './security-history.mjs'
import { checkRaces } from './security-races.mjs'
import { commandBodies } from './security-commands.mjs'
import { checkLevels } from './security-levels.mjs'

const snapshot = async h => (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results

test('LDG-006/008/016 current roles and principals govern every private HTTP door without refusal side effects', async () => {
 const h = await fixture()
 try {
  const admin = await h.member('admin@example.test', ['admin'])
  const panelAgent = await h.member('panel-agent@example.test', [], 'Panel agent', { agent: true, actsFor: 'panel@example.test' })
  // Only the owner adds or changes an agent, and a person who is already a member never becomes one.
  const unchanged = await snapshot(h)
  assert.equal((await h.send('/api/lodge/command/member', { email: 'm2@example.test', name: 'm2', agent: true, actsFor: 'panel@example.test' }, admin)).status, 403)
  assert.equal((await h.send('/api/lodge/command/member', { email: 'new-agent@example.test', name: 'New agent', agent: true, actsFor: 'panel@example.test' }, admin)).status, 403)
  assert.equal((await h.send('/api/lodge/command/member', { email: 'panel-agent@example.test', name: 'Panel agent', roles: ['manager'] }, admin)).status, 403)
  assert.equal((await h.send('/api/lodge/command/member', { email: 'm2@example.test', name: 'm2', agent: true, actsFor: 'panel@example.test' }, h.owner)).status, 409)
  assert.deepEqual(await snapshot(h), unchanged)
  const stale = []
  for (const mode of ['inactive', 'missing', 'empty']) {
   const email = mode + '@example.test', cookie = await h.member(email, ['interviewer'])
   if (mode === 'missing') await h.db.prepare("DELETE FROM l_records WHERE kind='member' AND id=?").bind(email).run()
   else await h.db.prepare("UPDATE l_records SET revision=?,value=json_set(value,'$.active',json(?),'$.roles',json(?)) WHERE kind='member' AND id=?").bind(crypto.randomUUID(), mode === 'inactive' ? 'false' : 'true', mode === 'empty' ? '[]' : '["interviewer"]', email).run()
   stale.push({ name: mode + ' member', cookie, denied: 403 })
  }
  for (const mode of ['inactive', 'missing']) {
   const email = mode + '-principal@example.test'
   await h.member(email, ['interviewer'])
   const cookie = await h.member(mode + '-agent@example.test', [], mode + ' agent', { agent: true, actsFor: email })
   if (mode === 'missing') await h.db.prepare("DELETE FROM l_records WHERE kind='member' AND id=?").bind(email).run()
   else await h.command('member', { email, name: mode, roles: ['interviewer'], active: false })
   stale.push({ name: mode + ' principal', cookie, denied: 403 })
  }
  for (const mode of ['inactive', 'missing']) {
   const email = mode + '-own-agent@example.test', cookie = await h.member(email, [], mode, { agent: true, actsFor: 'm1@example.test' })
   if (mode === 'missing') await h.db.prepare("DELETE FROM l_records WHERE kind='member' AND id=?").bind(email).run()
   else await h.command('member', { email, name: mode, roles: [], agent: true, actsFor: 'm1@example.test', active: false })
   stale.push({ name: mode + ' agent member', cookie, denied: 403 })
  }
  const sessionLost = await h.member('revoked@example.test', ['manager'])
  await h.db.prepare("UPDATE oa_sessions SET revoked_at=1 WHERE operator_id=(SELECT id FROM oa_operators WHERE email='revoked@example.test')").run()
  stale.push({ name: 'revoked native session', cookie: sessionLost, denied: 401 })
  await h.command('member', { email: 'invite-target@example.test', name: 'Invite target', roles: ['interviewer'] })
  await checkReviewerAuthority(h, panelAgent)
  await h.command('offer-outcome', { id: h.offer.id, outcome: 'accepted', reason: 'Accepted' }, h.manager)
  const roles = [
   { name: 'owner', cookie: h.owner, admin: true, manages: true, owner: true },
   { name: 'admin', cookie: admin, admin: true, manages: true },
   { name: 'own manager', cookie: h.manager, manages: true },
   { name: 'other manager', cookie: h.otherManager },
   { name: 'approver', cookie: h.approver },
   { name: 'panel interviewer', cookie: h.panel, assigned: true, panel: true },
   { name: 'non-panel reviewer', cookie: h.reviewer, assigned: true },
   { name: 'unassigned interviewer', cookie: h.outsider },
   { name: 'manager agent', cookie: h.agent, manages: true, agent: true },
   { name: 'interviewer agent', cookie: panelAgent, assigned: true, panel: true, agent: true },
   { name: 'signed out', cookie: '', denied: 401 }, ...stale,
  ]
  const download = (kind, id) => '/api/lodge/download/' + kind + '/' + id
  const doors = [
   ['state', '/api/lodge/state', undefined, () => 200],
   ['search', '/api/lodge/search?q=private', undefined, () => 200],
   ['talent', '/api/lodge/talent?q=private', undefined, r => r.admin ? 200 : 403],
   ['command', '/api/lodge/command/availability', { interview: h.interview.id, slots: [0] }, r => r.panel && !r.agent ? 409 : 403],
   ['invite', '/api/lodge/invite', { email: 'invite-target@example.test' }, r => r.owner ? 200 : 403],
   ...['preview', 'commit', 'resume', 'undo', 'status'].map(op => ['import ' + op, '/api/lodge/import/' + op, {}, r => r.owner ? 400 : 403]),
   ['delete', '/api/lodge/delete-candidate', { candidate: h.candidate.id, confirm: h.candidate.name, reason: 'Test hold refusal' }, r => r.admin ? 409 : 403],
   ['document', download('document', h.document.id), undefined, r => r.manages || r.assigned ? 200 : 404],
   ['restricted document', download('document', h.restricted.id), undefined, r => r.admin ? 200 : 404],
   ['calendar', download('calendar', h.interview.id), undefined, r => r.panel || r.manages ? 200 : 404],
   ['message', download('message', h.message.id), undefined, r => r.agent ? 403 : r.manages ? 200 : 404],
   ['packet', download('packet', h.offer.id), undefined, r => r.manages ? 200 : 404],
   ['handoff', download('handoff', h.offer.id), undefined, r => r.manages ? 200 : 404],
   ['vacancy export', download('vacancy', h.vacancy.id), undefined, r => r.manages ? 200 : 404],
   ['candidate export', download('candidate', h.candidate.id), undefined, r => r.admin ? 200 : 403],
  ]
  for (const role of roles) for (const [label, path, body, expected] of doors) {
   const status = role.denied ?? expected(role), before = status >= 400 ? await snapshot(h) : null
   const response = await h.send(path, body, role.cookie)
   assert.equal(response.status, status, `${role.name} / ${label}: ${response.text}`)
   if (before) assert.deepEqual(await snapshot(h), before, `${role.name} / ${label} refusal changed durable records or audits`)
   if (status !== 200) continue
   if (label === 'document') assert.equal(response.text, 'Ordinary original bytes')
   if (label === 'restricted document') assert.equal(response.text, 'RESTRICTED-IDENTITY-BYTES')
   if (label === 'calendar') assert.match(response.text, /DTSTART:20261201T150000Z/)
   if (label === 'message') { assert.match(response.text, /To: private-candidate@example.test/); assert.ok(response.text.includes(Buffer.from('PRIVATE-CANDIDATE-MESSAGE').toString('base64'))) }
   if (label === 'handoff') {
    const view = await h.state(role.cookie)
    assert.deepEqual(response.value.documents.map(d => d.id).sort(), view.documents.filter(d => d.candidate === h.candidate.id).map(d => d.id).sort())
    assert.equal(response.value.person.email, h.candidate.email)
   }
   if (label === 'candidate export') {
    assert.equal(response.value.candidate.email, h.candidate.email)
    assert.equal(response.value.candidate.consent.note, 'Private consent note')
    assert.deepEqual(response.value.scorecard, [])
    assert.deepEqual(response.value['interview-note'], [])
   }
  }
  for (const role of roles.filter(r => r.denied || r.agent || r.name === 'unassigned interviewer')) {
   for (const [op, body] of Object.entries(commandBodies(h))) {
    if (role.agent && (op === 'propose' || op === 'debrief')) continue // real allowed proposals and briefs are exercised separately
    const before = await snapshot(h), response = await h.send('/api/lodge/command/' + op, body, role.cookie)
    if (role.denied || role.agent) assert.equal(response.status, role.denied ?? 403, `${role.name}: ${op}`)
    else assert.ok([403, 404].includes(response.status), `${role.name}: ${op}: ${response.text}`)
    assert.deepEqual(await snapshot(h), before, `${role.name}: ${op} changed durable records or audits`)
   }
  }
  // A redacted reviewer grant must not widen into a manager's contact grant.
  const link = { candidate: h.candidate.id, vacancy: h.otherVacancy.id, source: 'Transfer attempt' }
  for (const reviewed of [false, true]) {
   if (reviewed) await h.command('assign-reviewers', { application: h.app.id, reviewers: ['m2@example.test', 'panel@example.test', 'review@example.test'] }, h.manager)
   const before = await snapshot(h)
   assert.equal((await h.send('/api/lodge/command/apply', link, h.otherManager)).status, 404)
   assert.deepEqual(await snapshot(h), before)
   assert.equal((await h.state(h.otherManager)).candidates.find(c => c.id === h.candidate.id)?.email, undefined)
  }
  // Pre-existing full contact grants can link another vacancy they manage.
  await h.command('unpublish', { id: h.otherVacancy.id, reason: 'Transfer manager' })
  const owned = await h.command('vacancy', { ...h.otherVacancy, manager: 'm1@example.test' })
  const transferApproval = await h.command('request-vacancy-approval', { id: owned.id, approver: 'owner@example.test' }, h.manager)
  await h.command('decide-approval', { id: transferApproval.id, decision: 'approved', version: transferApproval.version, reason: 'Approved transfer' })
  await h.command('publish', { id: owned.id }, h.manager)
  assert.equal((await h.send('/api/lodge/command/apply', { ...link, vacancy: owned.id }, h.manager)).status, 200)
  await checkProposalAuthority(h)
  await checkFeedback(h, panelAgent)
  await checkImportedHistory(h, panelAgent)
  await checkRaces(h)
 } finally { await h.close() }
})

test('OPS-004 named permission levels on a job, a team role and a department grant govern the app, API, exports and agent reads at once', async () => {
 const h = await fixture()
 try { await checkLevels(h) } finally { await h.close() }
})
