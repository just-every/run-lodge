import { checkIntegrationApi, checkEnterpriseIntegration } from './integration-api-flow.mjs'
import { checkEnterpriseSaml } from './enterprise-saml-flow.mjs'
import { checkEnterprise } from './enterprise-flow.mjs'
import { checkBulkInvitations } from './bulk-invitations-flow.mjs'
import { checkCompliance } from './compliance-flow.mjs'
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
import { checkOperations } from './operations-driver.mjs'

const snapshot = async h => (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results

test('OPS-003 selected workflow trials isolate production, bind reviewed deployment and rollback, and expose confirmed provider setup estimates', async () => {
 const h = await fixture()
 try { await checkOperations(h) } finally { await h.close() }
})

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

test('a manager whose permission level hides contact details reaches no candidate email through messages', async () => {
 const h = await fixture()
 try {
  const template = await h.command('rejection-template', { name: 'Decline', subject: 'Your application', body: 'Dear {candidate_name}, thank you for applying.' })
  const { application: second } = await h.command('candidate', { name: 'Second Candidate', email: 'second-candidate@example.test', source: 'Referral', consentBasis: 'referral', vacancy: h.vacancy.id }, h.manager)
  await h.command('move', { application: second.id, to: 'rejected', closeReason: 'certification', send: 'delay', businessDays: 2, template: template.id }, h.manager)
  const noContact = await h.command('permission-level', { name: 'Hiring manager without contact', permissions: ['scorecards', 'move', 'reject', 'offers', 'export', 'settings'] })
  await h.command('job-levels', { id: h.vacancy.id, members: { 'm1@example.test': noContact.id } })
  const tries = [
   await h.send('/api/lodge/download/message/' + h.message.id, undefined, h.manager),
   await h.send('/api/lodge/command/request-message-approval', { id: h.message.id, approver: 'owner@example.test' }, h.manager),
   await h.send('/api/lodge/command/message', { id: h.message.id, application: h.app.id, purpose: 'other', subject: 'Edited', body: 'Hello' }, h.manager),
   await h.send('/api/lodge/command/message', { application: h.app.id, purpose: 'other', subject: 'Checking in', body: 'Hello' }, h.manager),
  ]
  assert.deepEqual(tries.map(r => [r.status, r.text.includes('private-candidate@example.test')]), [[403, false], [403, false], [403, false], [403, false]])
  const w = await h.state(h.manager), view = JSON.stringify(w)
  assert.ok(w.messages.some(m => m.id === h.message.id) && w.rejectionEmails.some(m => m.application === second.id), 'the drafts and scheduled emails stay in view')
  assert.ok(!view.includes('private-candidate@example.test') && !view.includes('second-candidate@example.test'), 'their recipients do not')
 } finally { await h.close() }
})

test('DATA-006 inline originals and restricted-view audit obey live reviewer authorization', async () => {
 const h = await fixture()
 try {
  const { readerFiles } = await import('./document-fixtures.mjs')
  for (const file of readerFiles()) {
   const doc = await h.command('document', { application: h.app.id, ...file, bytes: undefined, base64: file.bytes.toString('base64') }, h.manager)
   const r = await h.mf.dispatchFetch(h.origin + '/api/lodge/view/document/' + doc.id, { headers: { cookie: h.panel } })
   assert.equal(r.status, 200)
   assert.deepEqual(Buffer.from(await r.arrayBuffer()), file.bytes, 'viewer receives the actual PDF, DOCX, text or image original')
   assert.match(r.headers.get('cache-control'), /no-store/)
   assert.equal((await h.send('/api/lodge/view/document/' + doc.id + '?access=1', undefined, h.panel)).status, 204)
   assert.equal((await h.send('/api/lodge/view/document/' + doc.id, undefined, h.outsider)).status, 404)
  }
  assert.equal((await h.send('/api/lodge/view/document/' + h.restricted.id, undefined, h.panel)).status, 404)
  assert.equal((await h.send('/api/lodge/view/document/' + h.restricted.id, undefined, h.owner)).status, 200)
  const audit = await h.send('/api/lodge/audit', undefined, h.owner)
  assert.ok(JSON.stringify(audit.value).includes('document-viewed'))
  const events = (await h.db.prepare("SELECT value FROM l_records WHERE kind='audit'").all()).results.map(r => JSON.parse(r.value))
  assert.ok(events.some(e => e.action === 'document-viewed' && JSON.stringify(e).includes(h.restricted.id)), 'restricted viewing has its own audit event')
  await h.command('member', { email: 'panel@example.test', name: 'Revoked interviewer', roles: ['interviewer'], active: false })
  for (const path of ['/view/document/', '/download/document/']) assert.equal((await h.send('/api/lodge' + path + h.document.id, undefined, h.panel)).status, 403)
  assert.equal((await h.send('/api/lodge/view/document/' + h.document.id + '?access=1', undefined, h.panel)).status, 403)
 } finally { await h.close() }
})


test('INT-002 admin connector registry refuses credentials and never fabricates provider access', async () => {
 const h = await fixture()
 try { const { checkConnectors } = await import('./connectors-driver.mjs'); await checkConnectors(h) } finally { await h.close() }
})

test('enterprise provisioned identities use bound Okta subjects, revoke access and transfer owned work without losing referrals', checkEnterprise)
test('bulk invitation preview grants scoped access and sends each valid row once', checkBulkInvitations)
test('compliance grants are separate from hiring scope and are revoked on every document door', checkCompliance)

test('signed SAML sign-in binds the provisioned subject and refuses replay, stale settings and invalid assertions', checkEnterpriseSaml)

test('INT-001 scoped read-only applications honor current authority and installation credential lifecycle', checkIntegrationApi)
test('INT-001 employer deprovisioning immediately refuses app credentials without resurrection', checkEnterpriseIntegration)
