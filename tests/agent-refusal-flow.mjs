import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID, webcrypto } from 'node:crypto'
import { businessHarness } from './harness.mjs'
import initializeAgent from './initialize-agent.mjs'
import prepareFixtures from './agent-phase-fixtures.mjs'
import { createProtocol, errorCode } from '../src/modules/agent-door/conformance/protocol.mjs'
import { autonomousPolicy, heldPolicy, seconds, signJws } from '../src/modules/agent-door/conformance/crypto.mjs'

// Disposable signed Business fixtures use the existing bound agent and sponsor.
// Both doors execute native commands; only the provider network edge is denied.
export async function checkAgentRefusals({ observe } = {}) {
  const surface = JSON.parse(await readFile('agent-surface.json', 'utf8'))
  const ring = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const kid = randomUUID(), issuer = 'https://synthetic-lodge-63.invalid', installationId = randomUUID()
  const publicKeys = { [kid]: await webcrypto.subtle.exportKey('jwk', ring.publicKey) }
  const attempts = []
  const h = await businessHarness({ bindings: {
    RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId,
    RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify(publicKeys),
  }, outboundService: async request => {
    attempts.push(new URL(request.url).origin)
    return new Response('Synthetic provider refused', { status: 503 })
  } })
  try {
    const request = (url, init = {}) => h.mf.dispatchFetch(url, init)
    const ownerRequest = async (url, init = {}) => {
      const headers = new Headers(init.headers)
      headers.set('Origin', h.origin)
      headers.set('Cookie', h.owner)
      const response = await request(url, { ...init, headers: Object.fromEntries(headers) })
      assert.ok(response.ok, `native fixture: HTTP ${response.status} ${await response.clone().text()}`)
      return response
    }
    const { operator } = (await h.send('/auth/session', undefined, h.owner)).value
    const email = operator.email, sub = randomUUID(), iat = seconds()
    const settings = await signJws(ring.privateKey, kid, 'rer-business-settings+jwt', {
      v: 1, iss: issuer, aud: h.origin, sub: installationId, business: 'synthetic-lodge-63',
      email, owner_id: sub, jti: randomUUID(), iat, exp: iat + 300, rev: 1,
      values: {}, logo: null, team: null,
    })
    assert.equal((await h.send('/api/rer/business-settings', { settings })).status, 200)
    const c = createProtocol({ fetch: request, origin: h.origin, surface, points: [],
      signer: { issuer, installationId, kid, privateKey: ring.privateKey },
      person: { email, sub, cookie: h.owner }, business: 'synthetic-lodge-63',
      agentId: randomUUID(), consent: randomUUID(), seq: 0, revision: 0,
    })
    await initializeAgent({ agentId: c.agentId, request: ownerRequest, origin: h.origin, email })
    const bound = (await h.state()).members.find(member => member.businessAgentId === c.agentId)
    assert.ok(bound?.agent && bound.actsFor === email)
    const cookie = await h.member(bound.email, [], bound.name, { agent: true, actsFor: email, businessAgentId: c.agentId })
    const fixtures = await prepareFixtures({ request: ownerRequest, origin: h.origin, cookie: h.owner, email, phase: 'autonomous' })
    const application = fixtures.values.debrief.application
    const app = (await h.state()).applications.find(row => row.id === application)
    const restricted = await h.command('document', { application, kind: 'right-to-work', name: 'synthetic-lodge-63.txt', base64: Buffer.from('Synthetic restricted original').toString('base64') })
    const { application: unreleased } = await h.command('candidate', { name: 'Synthetic Lodge 63',
      email: email.replace(/^[^@]+/, 'synthetic-lodge-63'), source: 'Synthetic referral', consentBasis: 'referral', vacancy: app.vacancy })
    const proposal = {
      workflow: 'prepare-vacancy', summary: 'Synthetic unsent vacancy proposal', intake: 'Prepare a native vacancy for human review.', approver: email,
      changes: [{ op: 'vacancy', input: { title: 'Synthetic Lodge 63 estimator', location: 'Brooklyn, NY', headcount: 1, manager: email, description: 'Prepare estimates from drawings.' } }],
    }
    const snapshot = async () => (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
    const audit = async () => (await h.send('/agents/api/audit?limit=200', undefined, h.owner)).value
    const inventory = async () => {
      const answer = await c.tool('lodge.proposals.list', {})
      assert.equal(answer.result?.isError, false)
      return answer.result.structuredContent
    }
    const receipts = []
    for (const [phase, policy, disposition] of [
      ['autonomous', autonomousPolicy(), 'autonomous'], ['held', heldPolicy(), 'review'],
    ]) {
      await c.adopt(policy)
      // Seed nonempty inventory before refusals so an accidental deletion is seen.
      const seededProposal = await h.command('propose', proposal, cookie)
      const seededDebrief = await h.command('debrief', fixtures.values.debrief, cookie)
      const cases = [
        { label: 'proposal validation', op: 'propose', args: { ...proposal, changes: [] }, status: 400, code: 'native_refused', message: 'Propose between 1 and 20 changes' },
        ...[restricted.id, 'synthetic-lodge-missing'].map(id => ({ label: id === restricted.id ? 'hidden source' : 'missing source', op: 'propose', args: { ...proposal, sources: [{ kind: 'document', id }] }, status: 404, code: 'record_unavailable', message: 'Source outside your scope' })),
        { label: 'proposal precondition', op: 'propose', args: { workflow: 'rediscovery', approver: email, summary: 'Synthetic consent refusal', sources: [{ kind: 'candidate', id: app.candidate }], changes: [{ op: 'apply', input: { candidate: app.candidate, vacancy: app.vacancy } }] }, status: 409, code: 'native_conflict', message: 'This person has not given current permission to be contacted about other roles' },
        { label: 'debrief validation', op: 'debrief', args: { application, statements: [{ kind: 'gap', criterion: 'synthetic-lodge-unknown', text: 'Synthetic missing criterion.' }] }, status: 400, code: 'native_refused', message: 'Statement 1: choose a criterion from this application’s rubric' },
        { label: 'debrief unavailable', op: 'debrief', args: { ...fixtures.values.debrief, application: 'synthetic-lodge-missing' }, status: 404, code: 'record_unavailable', message: 'Application not found' },
        { label: 'debrief precondition', op: 'debrief', args: { ...fixtures.values.debrief, application: unreleased.id }, status: 409, code: 'native_conflict', message: 'Feedback is not released yet; a debrief brief reads released scorecards only' },
      ]
      const hidden = []
      for (const item of cases) {
        const tool = item.op === 'propose' ? 'lodge.proposals.prepare' : 'lodge.debriefs.prepare'
        const before = await snapshot(), drafts = await inventory(), priorAudit = await audit()
        assert.ok(drafts.proposals.some(row => row.id === seededProposal.id))
        assert.ok(drafts.debriefs.some(row => row.id === seededDebrief.id))
        const native = await h.send('/api/lodge/command/' + item.op, item.args, cookie)
        assert.equal(native.status, item.status, item.label)
        assert.deepEqual(native.value, { error: item.message, code: item.code }, item.label)
        assert.deepEqual(await snapshot(), before, item.label + ': native refusal preserves every value, revision and native audit')
        const key = randomUUID()
        const answer = await c.tool(tool, { ...item.args, idempotency_key: key })
        assert.equal(answer.status, 200, item.label)
        assert.equal(answer.body.error, undefined, 'schema-valid native failures are tool results')
        assert.equal(answer.result?.isError, true, item.label)
        assert.equal(errorCode(answer), native.value.code, item.label)
        assert.equal(answer.result._meta['com.runeditrun/error'].status, native.status)
        assert.equal(answer.result.structuredContent, undefined, 'refusals expose no draft or source result')
        assert.deepEqual(await snapshot(), before, item.label + ': MCP refusal preserves every value, revision and native audit')
        const afterAudit = await audit()
        const newRows = afterAudit.rows.filter(row => !priorAudit.rows.some(old => old.id === row.id) && row.tool === tool)
        assert.equal(newRows.length, 1)
        const row = newRows[0]
        assert.equal(row.outcome, 'refused')
        assert.equal(row.code, item.code)
        assert.equal(row.agent.id, c.agentId)
        assert.equal(row.sponsor.id, operator.id)
        assert.equal(row.revision, c.revision)
        assert.equal(row.approval, null)
        assert.equal(row.review, null)
        assert.equal(afterAudit.differs_from_policy, 0)
        assert.deepEqual(await inventory(), drafts, item.label + ': nonempty draft inventory is unchanged')
        const replay = await c.tool(tool, { ...item.args, idempotency_key: key })
        assert.equal(replay.result?.isError, true, item.label + ': repeated refusal stays an error')
        assert.equal(errorCode(replay), item.code, item.label + ': repeated refusal keeps its native code')
        assert.deepEqual(replay.result._meta['com.runeditrun/error'], answer.result._meta['com.runeditrun/error'])
        assert.deepEqual(await snapshot(), before, item.label + ': repeated refusal cannot create or alter native records')
        assert.deepEqual(await inventory(), drafts, item.label + ': repeated refusal leaves existing drafts intact')
        if (item.label.endsWith('source')) hidden.push({ native: native.value, error: answer.result._meta['com.runeditrun/error'], content: answer.result.content })
        receipts.push({ phase, case: item.label, status: native.status, code: native.value.code, audit: row.outcome })
      }
      assert.deepEqual(hidden[0], hidden[1], 'hidden and absent sources disclose identical refusals through both doors')
      // A refusal grants no authority and leaves no poisoned draft state.
      for (const [op, args, name] of [['propose', proposal, 'lodge.proposals.prepare'], ['debrief', fixtures.values.debrief, 'lodge.debriefs.prepare']]) {
        const before = await snapshot()
        const answer = await c.tool(name, { ...args, idempotency_key: randomUUID() })
        assert.equal(answer.result?.isError, false, JSON.stringify(answer.body))
        assert.equal(answer.decision?.disposition, disposition)
        const id = answer.result.structuredContent.id
        const current = await h.state()
        assert.equal((op === 'propose' ? current.proposals : current.debriefs).find(row => row.id === id)?.status, op === 'propose' ? 'proposed' : 'draft')
        const after = await snapshot()
        assert.deepEqual(after.filter(row => !['proposal', 'debrief', 'audit'].includes(row.kind)), before.filter(row => !['proposal', 'debrief', 'audit'].includes(row.kind)), 'valid preparation never applies a hiring mutation')
        const expectedAction = op === 'propose' ? 'proposal-created' : 'debrief-prepared'
        assert.ok(after.some(row => row.kind === 'audit' && !before.some(old => old.id === row.id) && JSON.parse(row.value).action === expectedAction))
      }
    }
    // Admission, malformed transport and other commands retain their old errors.
    const before = await snapshot()
    for (const [op, args] of [['propose', proposal], ['debrief', fixtures.values.debrief]]) {
      const signedOut = await h.send('/api/lodge/command/' + op, args)
      assert.equal(signedOut.status, 401)
      assert.deepEqual(signedOut.value, { error: 'Sign in required' })
    }
    const malformed = await request(h.origin + '/api/lodge/command/propose', { method: 'POST', headers: { Origin: h.origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: '{' })
    assert.equal(malformed.status, 400)
    assert.deepEqual(await malformed.json(), { error: 'Send a JSON object' })
    const direct = await h.send('/api/lodge/command/vacancy', proposal.changes[0].input, cookie)
    assert.equal(direct.status, 403)
    assert.equal(direct.value.code, undefined)
    assert.deepEqual(await snapshot(), before)
    assert.deepEqual(attempts, [], 'neither refused nor successful draft preparation attempts a provider')
    assert.ok(c.points.every(point => point.ok), JSON.stringify(c.points.filter(point => !point.ok)))
    await observe?.({ h, c, cookie, fixtures, receipts, attempts })
    return { refusals: receipts, providerAttempts: attempts.length }
  } finally { await h.close() }
}
