import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { businessHarness } from './harness.mjs'
import { enterpriseFixture, enterpriseJob } from './enterprise-flow.mjs'

export const integrationsPath = '/api/lodge/integrations'
export const applicationsPath = '/api/integrations/v1/applications'
const address = n => ['synthetic-lodge-' + n, 'example.test'].join('@')
const snapshot = async h => ({ records: (await h.db.prepare('SELECT * FROM l_records ORDER BY kind,id').all()).results, credentials: (await h.db.prepare('SELECT * FROM l_app_credentials ORDER BY id').all()).results })

/** Native management and the versioned API, real Worker and D1, seeded nonempty reads. */
export async function checkIntegrationApi(t) {
  await checkDevIntegrationAdmission(t)
  const h = await businessHarness(); t.after(() => h.close())
  const adminEmail = address(1), managerEmail = address(2)
  const admin = await h.member(adminEmail, ['admin']), manager = await h.member(managerEmail, ['manager'])
  const agent = await h.member(address(3), [], 'Synthetic app agent', { agent: true, actsFor: adminEmail })
  const job = await enterpriseJob(h, 'Synthetic integration job'), otherJob = await enterpriseJob(h, 'Synthetic other job')
  const person = await h.command('candidate', { name: 'Synthetic authorized candidate', email: address(4), phone: '+15550101234', source: 'Direct', consentBasis: 'application', vacancy: job.id })
  const other = await h.command('candidate', { name: 'Synthetic other candidate', email: address(5), source: 'Direct', consentBasis: 'application', vacancy: otherJob.id })
  await h.command('note', { application: person.application.id, text: 'Synthetic private hiring evidence' })
  const restricted = await h.command('document', { application: person.application.id, kind: 'right-to-work', name: 'synthetic-lodge-1.txt', base64: Buffer.from('Synthetic protected original').toString('base64') })
  const input = { name: 'Synthetic reader', jobs: [job.id], fields: ['identity', 'contact'] }
  for (const cookie of ['', manager, agent]) assert.ok([401, 403].includes((await h.send(integrationsPath, input, cookie)).status))
  assert.equal((await h.send(integrationsPath, input, admin, { origin: 'https://synthetic-lodge.example.test' })).status, 403)
  assert.equal((await h.send(integrationsPath, { ...input, jobs: [] }, admin)).status, 400)
  const create = await h.send(integrationsPath, input, admin)
  assert.equal(create.status, 200, create.text)
  let issued = create.value
  const read = (path = applicationsPath, token = issued.token, body, cookie = '') => h.send(path, body, cookie, { authorization: 'Bearer ' + token })
  const full = await read()
  assert.equal(full.status, 200, full.text)
  assert.deepEqual(full.value.applications.map(a => a.id), [person.application.id])
  assert.deepEqual(full.value.applications[0], { id: person.application.id, job: job.id, stage: person.application.stage, status: 'active', submittedAt: person.application.submittedAt, candidateName: person.candidate.name, email: person.candidate.email, phone: '+15550101234' })
  assert.deepEqual((await read(applicationsPath + '/' + person.application.id)).value, full.value.applications[0])
  assert.equal(full.headers.get('cache-control'), 'no-store')
  const before = await snapshot(h)
  for (const path of [applicationsPath + '/' + other.application.id, applicationsPath + '/synthetic-lodge-unknown', applicationsPath + '?job=' + otherJob.id]) assert.equal((await read(path)).status, 404)
  for (const path of [applicationsPath, applicationsPath + '/' + person.application.id, '/api/integrations/v1/decisions', '/api/integrations/v1/credentials']) assert.equal((await read(path, issued.token, { status: 'hired' })).status, 405)
  for (const path of ['/api/lodge/state', '/api/lodge/download/document/' + restricted.id, '/api/lodge/download/candidate/' + person.candidate.id]) assert.equal((await read(path)).status, 401)
  for (const op of ['member', 'move', 'decide-approval', 'vacancy-compliance', 'scorecard', 'delete-candidate']) assert.equal((await read('/api/lodge/command/' + op, issued.token, {}, h.owner)).status, 401, 'bearer never upgrades a native cookie')
  assert.equal((await read(integrationsPath, issued.token, input)).status, 401)
  assert.equal((await h.send(applicationsPath + '?token=' + issued.token)).status, 401)
  assert.deepEqual(await snapshot(h), before, 'refused reads and writes change nothing')
  const summary = await h.send(integrationsPath, { ...input, name: 'Synthetic summary', fields: [] }, admin)
  assert.equal(summary.status, 200, summary.text)
  assert.equal((await read(applicationsPath + '?fields=contact', summary.value.token)).status, 403)
  const minimal = (await read(applicationsPath, summary.value.token)).value.applications[0]
  assert.deepEqual(Object.keys(minimal).sort(), ['id', 'job', 'stage', 'status', 'submittedAt'])
  const listed = (await h.send(integrationsPath, undefined, admin)).value.credentials
  assert.equal(JSON.stringify(listed).includes(issued.token), false)
  assert.equal(JSON.stringify(listed).includes('token_hash'), false)
  assert.equal((await h.send(integrationsPath, undefined, h.owner)).value.credentials.length, 0, 'management does not adopt another human authority')
  assert.equal((await h.send(integrationsPath + '/' + issued.credential.id + '/rotate', { revision: issued.credential.revision }, h.owner)).status, 404)
  const old = issued
  const rotate = await h.send(integrationsPath + '/' + old.credential.id + '/rotate', { revision: old.credential.revision }, admin)
  assert.equal(rotate.status, 200, rotate.text); issued = rotate.value
  assert.notEqual(issued.token, old.token)
  assert.equal((await read(applicationsPath, old.token)).status, 401)
  assert.equal((await h.send(integrationsPath + '/' + old.credential.id + '/rotate', { revision: old.credential.revision }, admin)).status, 409)
  await h.restart()
  assert.equal((await read()).status, 200, 'installation restart retains active local credentials')
  await h.command('job-board', { token: 'synthetic-lodge-board' })
  const board = await h.command('board-key', { label: 'Synthetic board key' })
  assert.equal((await read(applicationsPath, board.key)).status, 401)
  const boardSubmit = await h.send('/api/board/v1/synthetic-lodge-board/jobs/' + job.id + '/applications', { job: job.id }, '', { authorization: 'Bearer ' + issued.token })
  assert.equal(boardSubmit.status, 401, boardSubmit.text)

  // The author keeps only the current member and team permissions, not their former admin role.
  await h.command('member', { email: adminEmail, name: 'Synthetic current manager', roles: ['manager'] })
  await h.command('hiring-team', { id: job.id, recruiters: [adminEmail], coordinators: [], hiringManagers: [] })
  const noContact = await h.command('permission-level', { name: 'Synthetic summary only', permissions: ['settings'] })
  await h.command('job-levels', { id: job.id, members: { [adminEmail]: noContact.id }, roles: {} })
  assert.equal('email' in (await read()).value.applications[0], false)
  await h.command('job-levels', { id: job.id, members: {}, roles: {} })
  assert.equal((await read()).value.applications[0].email, person.candidate.email)
  await h.command('hiring-team', { id: job.id, recruiters: [], coordinators: [], hiringManagers: [] })
  assert.deepEqual((await read()).value.applications, [])
  assert.equal((await read(applicationsPath + '/' + person.application.id)).status, 404)
  await h.command('member', { email: adminEmail, name: 'Synthetic current admin', roles: ['admin'] })
  await h.command('vacancy-privacy', { id: job.id, confidential: true, namedPeople: [], publicTitle: 'Synthetic confidential role' })
  assert.deepEqual((await read()).value.applications, [])
  await h.command('vacancy-privacy', { id: job.id, confidential: false, namedPeople: [] })
  await h.command('candidate-privacy', { id: person.candidate.id, private: true, namedPeople: [] })
  assert.deepEqual((await read()).value.applications, [])
  await h.command('candidate-privacy', { id: person.candidate.id, private: false, namedPeople: [] })
  // REVIEW-002 hides identity even when a different job lets the same person read contacts.
  await h.command('member', { email: adminEmail, name: 'Synthetic blinded manager', roles: ['manager'] })
  await h.command('hiring-team', { id: job.id, recruiters: [], coordinators: [], hiringManagers: [adminEmail] })
  await h.command('blind-review', { id: job.id, enabled: true, stages: [job.stages[0].id], revealStage: job.stages[2].id })
  assert.equal('candidateName' in (await read()).value.applications[0], false)
  assert.equal('email' in (await read()).value.applications[0], false)
  await h.command('blind-review', { id: job.id, enabled: false, stages: [], revealStage: job.stages[2].id })
  await h.command('member', { email: adminEmail, name: 'Synthetic current admin', roles: ['admin'] })
  const revoke = await h.send(integrationsPath + '/' + issued.credential.id + '/revoke', { revision: issued.credential.revision }, admin)
  assert.equal(revoke.status, 200, revoke.text)
  assert.equal((await read()).status, 401)
  assert.equal((await h.send(integrationsPath + '/' + issued.credential.id + '/rotate', { revision: revoke.value.credential.revision }, admin)).status, 409)
  let renewed = (await h.send(integrationsPath, input, admin)).value
  await h.command('member', { email: adminEmail, name: 'Synthetic suspended admin', roles: ['admin'], active: false })
  assert.equal((await read(applicationsPath, renewed.token)).status, 401)
  await h.command('member', { email: adminEmail, name: 'Synthetic restored admin', roles: ['admin'], active: true })
  assert.equal((await read(applicationsPath, renewed.token)).status, 401, 'reactivation never revives a suspended app credential')
  renewed = (await h.send(integrationsPath, input, admin)).value
  // Erasure leaves no previously projected person behind a still-active token.
  await h.command('move', { application: person.application.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Synthetic erasure request' })
  const erase = await h.send('/api/lodge/delete-candidate', { candidate: person.candidate.id, confirm: person.candidate.name, reason: 'Synthetic erasure' }, h.owner)
  assert.equal(erase.status, 200, erase.text)
  assert.deepEqual((await read(applicationsPath, renewed.token)).value.applications, [])
  assert.equal((await read(applicationsPath + '/' + person.application.id, renewed.token)).status, 404)
  await h.db.prepare('UPDATE oa_sessions SET revoked_at=1 WHERE id=(SELECT author_session FROM l_app_credentials WHERE id=?)').bind(renewed.credential.id).run()
  assert.equal((await read(applicationsPath, renewed.token)).status, 401)
  const stored = await h.db.prepare('SELECT * FROM l_app_credentials').all()
  assert.equal(stored.results.find(c => c.id === renewed.credential.id).token_hash, createHash('sha256').update(renewed.token).digest('hex'))
  const personalRecords = JSON.stringify((await h.db.prepare('SELECT * FROM l_records').all()).results)
  for (const result of [old, issued, renewed, summary.value]) {
    assert.equal(personalRecords.includes(result.token), false)
    assert.equal(personalRecords.includes(createHash('sha256').update(result.token).digest('hex')), false)
  }
}

/** Provider deprovisioning uses the same bound native identity as API reads. */
export async function checkEnterpriseIntegration(t) {
  const h = await enterpriseFixture(); t.after(() => h.close())
  await h.send('/enterprise/settings', { enabled: true }, h.owner)
  const email = address(6)
  assert.equal((await h.scim('POST', '', { externalId: 'synthetic-lodge-5', userName: email, displayName: 'Synthetic provisioned author', active: true })).status, 201)
  await h.command('member', { email, name: 'Synthetic provisioned author', roles: ['admin'] })
  const session = await h.login(); assert.equal(session.status, 303, session.text)
  const job = await enterpriseJob(h)
  const person = await h.command('candidate', { name: 'Synthetic provider candidate', source: 'Direct', consentBasis: 'manual', vacancy: job.id })
  const created = await h.send(integrationsPath, { name: 'Synthetic provisioned app', jobs: [job.id], fields: [] }, session.cookie)
  assert.equal(created.status, 200, created.text)
  const read = () => h.send(applicationsPath, undefined, '', { authorization: 'Bearer ' + created.value.token })
  assert.deepEqual((await read()).value.applications.map(a => a.id), [person.application.id])
  assert.equal((await h.scim('PUT', '/synthetic-lodge-5', { userName: email, displayName: 'Synthetic provisioned author', active: false })).status, 200)
  assert.ok([401, 403].includes((await read()).status))
  assert.equal((await h.scim('PATCH', '/synthetic-lodge-5', { Operations: [{ op: 'replace', path: 'active', value: true }] })).status, 200)
  assert.equal((await read()).status, 401, 'reactivation cannot resurrect revoked authorizing sessions')
}

/** Dev-issued authority stays behind the local gate and cannot enter preview. */
async function checkDevIntegrationAdmission(t) {
  const key = 'synthetic-lodge-' + '1'.repeat(43)
  const h = await businessHarness({ devIdentity: true, bindings: { RER_DEV_KEY: key } }); t.after(() => h.close())
  const job = await enterpriseJob(h, 'Synthetic dev integration job')
  const person = await h.command('candidate', { name: 'Synthetic dev candidate', email: address(6), source: 'Direct', consentBasis: 'application', vacancy: job.id })
  const entered = await h.send('/auth/dev/enter?as=owner', undefined, '', { 'x-rer-dev-key': key })
  assert.equal(entered.status, 303, entered.text)
  const gate = { 'x-rer-dev-key': key }
  const created = await h.send(integrationsPath, { name: 'Synthetic dev reader', jobs: [job.id], fields: ['identity', 'contact'] }, entered.cookie, gate)
  assert.equal(created.status, 200, created.text)
  const auth = { authorization: 'Bearer ' + created.value.token }
  const read = (path = applicationsPath, extra = {}) => h.send(path, undefined, '', { ...auth, ...extra })
  const allowed = await read(applicationsPath, gate)
  assert.equal(allowed.status, 200, allowed.text)
  assert.equal(allowed.value.applications[0].email, person.candidate.email)
  const before = await snapshot(h)
  const sessionOnly = entered.cookie.split('; ').filter(part => !part.startsWith('rer_dev_gate_')).join('; ')
  assert.equal((await h.send('/api/lodge/state', undefined, sessionOnly)).status, 401)
  const ungated = await read()
  const wrongKey = await read(applicationsPath + '/' + person.application.id, { 'x-rer-dev-key': key + '2' })
  assert.deepEqual(await snapshot(h), before, 'refused dev reads change nothing')
  await h.restart({ devIdentity: false, bindings: { RER_DEV_KEY: '', AUTH_LOCAL: 'true' } })
  assert.equal((await h.send('/api/lodge/state', undefined, entered.cookie, gate)).status, 401)
  for (const path of [applicationsPath, applicationsPath + '/' + person.application.id]) {
    const denied = await read(path, gate)
    assert.equal(denied.status, 401, 'production preview refuses dev-issued app credentials even with the old key')
    assert.equal(denied.text.includes(person.candidate.email), false)
  }
  assert.deepEqual(await snapshot(h), before, 'production refusal exposes no data and changes nothing')
  assert.equal(ungated.status, 401, 'dev app credential requires the local gate on every read')
  assert.equal(wrongKey.status, 401)
}
