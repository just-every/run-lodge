import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID, webcrypto, createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = resolve(process.argv[2]), packet = resolve(process.argv[3])
process.chdir(root)
const fromRepo = path => import(pathToFileURL(join(root, path)).href)
const { businessHarness } = await fromRepo('tests/harness.mjs')
const { default: initializeAgent } = await fromRepo('tests/initialize-agent.mjs')
const { default: prepareFixtures } = await fromRepo('tests/agent-phase-fixtures.mjs')
const { createProtocol } = await fromRepo('src/modules/agent-door/conformance/protocol.mjs')
const { autonomousPolicy, heldPolicy, seconds, signJws, accessToken } = await fromRepo('src/modules/agent-door/conformance/crypto.mjs')
const method = (family, verb) => [family, verb].join('/')
const surface = JSON.parse(await readFile('agent-surface.json', 'utf8'))
const report = { schema: 1, clause: 'BASE-AGENT-011', acceptance: 1,
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  started: new Date().toISOString(), driver: 'one-off raw authenticated MCP qualification; no automatic retry', phases: [] }
const ring = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const kid = randomUUID(), issuer = 'https://synthetic-lodge-44.invalid', installationId = randomUUID()
const publicKeys = { [kid]: await webcrypto.subtle.exportKey('jwk', ring.publicKey) }
const h = await businessHarness({ bindings: {
  RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId,
  RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify(publicKeys),
} })
let sequence = 0
try {
  // Use the runtime's listening HTTP socket. Only the existing mail edge is faked.
  const request = (url, init = {}) => fetch(url, { redirect: 'manual', ...init })
  const ownerRequest = async (url, init = {}) => {
    const headers = new Headers(init.headers)
    headers.set('Origin', h.origin); headers.set('Cookie', h.owner)
    const response = await request(url, { ...init, headers })
    assert.ok(response.ok, `fixture HTTP ${response.status}`)
    return response
  }
  const session = await h.send('/auth/session', undefined, h.owner)
  const email = session.value.operator.email, sub = randomUUID(), iat = seconds()
  const settings = await signJws(ring.privateKey, kid, 'rer-business-settings+jwt', {
    v: 1, iss: issuer, aud: h.origin, sub: installationId, business: 'synthetic-lodge-44',
    email, owner_id: sub, jti: randomUUID(), iat, exp: iat + 300, rev: 1,
    values: {}, logo: null, team: null,
  })
  assert.equal((await h.send('/api/rer/business-settings', { settings })).status, 200)
  const snapshot = async () => (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const humanState = async () => {
    const response = await request(h.origin + '/api/lodge/state', { headers: { Cookie: h.owner } })
    assert.equal(response.status, 200)
    return { status: response.status, value: await response.json() }
  }
  for (const [phase, policy, disposition] of [
    ['autonomous', autonomousPolicy(), 'autonomous'], ['held', heldPolicy(), 'review'],
  ]) {
    const c = createProtocol({ fetch: request, origin: h.origin, surface, points: [],
      signer: { issuer, installationId, kid, privateKey: ring.privateKey },
      person: { email, sub, cookie: h.owner }, business: 'synthetic-lodge-44',
      agentId: randomUUID(), consent: randomUUID(), seq: report.phases.length, revision: report.phases.length,
    })
    await c.adopt(policy)
    await initializeAgent({ agentId: c.agentId, request: ownerRequest, origin: h.origin, email })
    const fixtures = await prepareFixtures({ request: ownerRequest, origin: h.origin, cookie: h.owner, email, phase })
    assert.ok(fixtures.values.job.id)
    const token = await accessToken(c)
    const raw = async (rpcMethod, params = {}) => {
      const response = await request(h.origin + '/mcp', { method: 'POST', headers: {
        Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', Origin: h.origin,
        'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': rpcMethod,
        ...(params.name ? { 'Mcp-Name': params.name } : {}), Authorization: `Bearer ${token}`,
      }, body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method: rpcMethod, params: {
        ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': { elicitation: { url: {} } } },
      } }) })
      return { status: response.status, retryAfter: response.headers.get('retry-after'), body: await response.json() }
    }
    const discover = await raw(method('server', 'discover'))
    assert.equal(discover.status, 200)
    const limits = discover.body.result._meta['com.runeditrun/limits']
    const limit = limits.requestsPerMinute
    assert.ok(Number.isSafeInteger(limit) && limit > 1 && limit <= 10000, 'discovery supplies a bounded effective capacity')
    const args = { workflow: 'prepare-vacancy', summary: 'Synthetic capacity qualification draft',
      intake: 'Prepare a synthetic estimator vacancy.', approver: email,
      changes: [{ op: 'vacancy', input: { title: 'Synthetic capacity estimator', location: 'Brooklyn, NY',
        headcount: 1, manager: email, description: 'Prepare estimates from drawings.' } }],
    }
    const beforeAllowed = await humanState()
    const allowed = await raw(method('tools', 'call'), { name: 'lodge.proposals.prepare',
      arguments: { ...args, idempotency_key: randomUUID() } })
    assert.equal(allowed.status, 200)
    assert.equal(allowed.body.result.isError, false)
    assert.equal(allowed.body.result._meta['com.runeditrun/decision'].disposition, disposition)
    const draftId = allowed.body.result.structuredContent.id
    const afterAllowed = await humanState()
    assert.equal(afterAllowed.value.proposals.length, beforeAllowed.value.proposals.length + 1)
    assert.equal(afterAllowed.value.proposals.find(row => row.id === draftId)?.status, 'proposed')
    assert.deepEqual(afterAllowed.value.vacancies, beforeAllowed.value.vacancies, 'supported preparation does not apply a vacancy')
    const initial = await h.db.prepare('SELECT window,requests FROM agent_door_agents WHERE id=?').bind(c.agentId).first()
    assert.equal(initial.requests, 1, 'only the supported authenticated call has consumed capacity')
    let admitted = 1, rollover = false
    const started = Date.now()
    // Bound the raw fill by the discovered capacity; crossing a real minute is diagnosed rather than hidden.
    for (let count = 1; count < limit; count++) {
      const answer = await raw(method('tools', 'list'))
      assert.equal(answer.status, 200, `fill call ${count + 1} should still fit the discovered capacity`)
      assert.ok(answer.body.result.tools.some(tool => tool.name === 'lodge.proposals.prepare'))
      admitted++
    }
    const full = await h.db.prepare('SELECT window,requests FROM agent_door_agents WHERE id=?').bind(c.agentId).first()
    rollover = full.window !== initial.window
    assert.equal(rollover, false, 'qualification must fill a single real limiter window')
    assert.equal(full.requests, limit)
    const nativeBefore = await snapshot(), humanBefore = await humanState()
    const refused = await raw(method('tools', 'call'), { name: 'lodge.proposals.prepare',
      arguments: { ...args, idempotency_key: randomUUID() } })
    assert.equal(refused.status, 429)
    assert.equal(refused.body.error.data.code, 'rate_limited')
    assert.match(refused.retryAfter, /^\d+$/)
    assert.ok(Number(refused.retryAfter) > 0)
    assert.equal(Object.hasOwn(refused.body, 'result'), false)
    const nativeAfter = await snapshot(), humanAfter = await humanState()
    assert.deepEqual(nativeAfter, nativeBefore, 'capacity refusal changes no native record, revision or audit')
    assert.deepEqual(humanAfter.value, humanBefore.value, 'the signed-in human still reads identical native state')
    assert.equal(humanAfter.value.proposals.length, humanBefore.value.proposals.length)
    assert.ok(c.points.every(point => point.ok))
    const row = { policy: phase, supportedDisposition: disposition, advertisedLimits: limits,
      admitted, fillDurationMs: Date.now() - started, singleWindow: !rollover,
      supportedProposal: { status: allowed.status, draftCreated: true, nativeDecisionApplied: false },
      overrun: { status: refused.status, code: refused.body.error.data.code,
        retryAfterSeconds: Number(refused.retryAfter), toolResultPresent: false },
      nativeRecords: { before: nativeBefore.length, after: nativeAfter.length,
        beforeSha256: digest(nativeBefore), afterSha256: digest(nativeAfter), unchanged: true },
      humanState: { status: humanAfter.status, unchanged: true,
        proposalsBefore: humanBefore.value.proposals.length, proposalsAfter: humanAfter.value.proposals.length },
      pass: true }
    report.phases.push(row)
    console.log(`PROBE BASE-AGENT-011 acceptance-1 ${phase}: discovered ${limit}, admitted ${admitted}; next otherwise-valid proposal -> HTTP ${refused.status} ${refused.body.error.data.code}, Retry-After ${refused.retryAfter}; no result or native change; human state HTTP ${humanAfter.status}`)
  }
  report.pass = true
} catch (error) {
  report.pass = false
  report.failure = { name: error.name, message: error.message, stack: error.stack }
  process.exitCode = 1
} finally {
  await h.close()
  report.finished = new Date().toISOString()
  await writeFile(join(packet, 'capacity-receipt.json'), JSON.stringify(report, null, 2) + '\n')
}
