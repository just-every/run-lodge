import assert from 'node:assert/strict'
import { createHash, randomUUID, webcrypto } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const repo = resolve(process.argv[2]), receiptPath = resolve(process.argv[3])
process.chdir(repo)
const load = path => import(pathToFileURL(resolve(repo, path)).href)
const { businessHarness } = await load('tests/harness.mjs')
const { default: initializeAgent } = await load('tests/initialize-agent.mjs')
const { default: prepareFixtures } = await load('tests/agent-phase-fixtures.mjs')
const { createProtocol } = await load('src/modules/agent-door/conformance/protocol.mjs')
const { autonomousPolicy, heldPolicy, seconds, signJws, accessToken } = await load('src/modules/agent-door/conformance/crypto.mjs')
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const fixtureTime = '2026-11-06T12:00:05.000Z'
const surface = JSON.parse(await readFile('agent-surface.json', 'utf8'))
const ring = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const kid = randomUUID(), issuer = 'https://synthetic-lodge-45.invalid', installationId = randomUUID()
const publicKeys = { [kid]: await webcrypto.subtle.exportKey('jwk', ring.publicKey) }
const h = await businessHarness({ clock: fixtureTime, bindings: {
  RER_OWNER_CLAIM_ISSUER: issuer,
  RER_OWNER_CLAIM_INSTALLATION_ID: installationId,
  RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify(publicKeys),
} })
const rows = []
try {
  // Real HTTP to the Worker socket. Only signed disposable Business fixtures
  // and the harness mail edge are used; no held account or provider is called.
  const request = (url, init = {}) => fetch(url, { redirect: 'manual', ...init })
  const ownerRequest = async (url, init = {}) => {
    const headers = new Headers(init.headers)
    headers.set('Origin', h.origin)
    headers.set('Cookie', h.owner)
    const response = await request(url, { ...init, headers })
    assert.ok(response.ok, `native fixture ${new URL(url).pathname}: HTTP ${response.status}`)
    return response
  }
  const session = await h.send('/auth/session', undefined, h.owner)
  assert.equal(session.status, 200)
  const email = session.value.operator.email, sub = randomUUID(), iat = seconds(fixtureTime)
  const settings = await signJws(ring.privateKey, kid, 'rer-business-settings+jwt', {
    v: 1, iss: issuer, aud: h.origin, sub: installationId, business: 'synthetic-lodge-45',
    email, owner_id: sub, jti: randomUUID(), iat, exp: iat + 300, rev: 1,
    values: {}, logo: null, team: null,
  })
  assert.equal((await h.send('/api/rer/business-settings', { settings })).status, 200)
  const c = createProtocol({ fetch: request, origin: h.origin, surface, points: [],
    signer: { issuer, installationId, kid, privateKey: ring.privateKey },
    person: { email, sub, cookie: h.owner }, business: 'synthetic-lodge-45',
    agentId: randomUUID(), consent: randomUUID(), seq: 0, revision: 0,
    now: () => Date.parse(fixtureTime),
  })
  const snapshot = async () => (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  let id = 0
  for (const [phase, policy, disposition] of [
    ['autonomous', autonomousPolicy(), 'autonomous'],
    ['held', heldPolicy(), 'review'],
  ]) {
    c.agentId = randomUUID()
    c.consent = randomUUID()
    await initializeAgent({ agentId: c.agentId, request: ownerRequest, origin: h.origin, email })
    const fixtures = await prepareFixtures({ request: ownerRequest, origin: h.origin, cookie: h.owner, email, phase })
    await c.adopt(policy)
    const token = await accessToken(c)
    const raw = async (method, params = {}) => {
      const version = '2026-07-28'
      const response = await request(h.origin + '/mcp', { method: 'POST', headers: {
        Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json',
        Origin: h.origin, Authorization: `Bearer ${token}`,
        'MCP-Protocol-Version': version, 'Mcp-Method': method,
        ...(method === 'tools/call' ? { 'Mcp-Name': params.name } : {}),
      }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params: { ...params, _meta: {
        'io.modelcontextprotocol/protocolVersion': version,
      } } }) })
      return { status: response.status, retryAfter: response.headers.get('retry-after'), body: await response.json() }
    }
    const discovered = await raw(['server', 'discover'].join('/'))
    assert.equal(discovered.status, 200)
    const limit = discovered.body.result._meta['com.runeditrun/limits'].requestsPerMinute
    assert.ok(Number.isSafeInteger(limit) && limit > 0, 'discovery advertises a usable request capacity')
    assert.ok(limit <= 10000, 'one-off qualification refuses an unbounded fill')
    const title = 'Synthetic capacity proposal ' + phase
    const args = {
      workflow: 'prepare-vacancy', summary: 'Synthetic request capacity qualification',
      intake: 'Prepare an estimator vacancy.', approver: email,
      changes: [{ op: 'vacancy', input: { title, location: 'Brooklyn, NY',
        headcount: 1, manager: email, description: 'Prepare estimates from drawings.' } }],
      idempotency_key: randomUUID(),
    }
    const first = await raw(['tools', 'call'].join('/'), { name: 'lodge.proposals.prepare', arguments: args })
    assert.equal(first.status, 200)
    assert.equal(first.body.result.isError, false)
    assert.equal(first.body.result._meta['com.runeditrun/decision'].disposition, disposition)
    const native = await h.state()
    assert.ok(native.vacancies.some(job => job.id === fixtures.values.job.id), 'human sees the real seeded vacancy')
    const proposalId = first.body.result.structuredContent.id
    assert.equal(native.proposals.find(row => row.id === proposalId)?.status, 'proposed')
    assert.ok(!native.vacancies.some(row => row.title === title), 'preparation does not apply the vacancy')
    // Discovery is not admitted. This first successful tool call consumes one;
    // the remaining read-only catalogue requests fill the discovered capacity.
    for (let count = 1; count < limit; count++) {
      const fill = await raw(['tools', 'list'].join('/'))
      assert.equal(fill.status, 200, `catalogue request ${count + 1} remains within discovered capacity`)
      assert.ok(fill.body.result.tools.some(tool => tool.name === 'lodge.proposals.prepare'))
    }
    const beforeRecords = await snapshot()
    const overrunArgs = { ...args, idempotency_key: randomUUID() }
    const overrun = await raw(['tools', 'call'].join('/'), { name: 'lodge.proposals.prepare', arguments: overrunArgs })
    assert.equal(overrun.status, 429)
    assert.equal(overrun.body.error?.data?.code, 'rate_limited')
    assert.equal(overrun.body.result, undefined)
    assert.ok(Number.isFinite(Number(overrun.retryAfter)) && Number(overrun.retryAfter) > 0)
    assert.deepEqual(await snapshot(), beforeRecords, 'refusal changes no native row, value or revision')
    const humanResponse = await ownerRequest(h.origin + '/api/lodge/state')
    assert.equal(humanResponse.status, 200)
    const afterNative = await humanResponse.json()
    assert.deepEqual(afterNative, native, 'human retains the exact nonempty native state after exhaustion')
    assert.equal(afterNative.proposals.length, native.proposals.length, 'no refused draft was saved')
    // The same otherwise-valid arguments must succeed after the advertised
    // wait, proving capacity rather than invalid proposal input caused refusal.
    const resumeAt = new Date(Date.parse(fixtureTime) + Number(overrun.retryAfter) * 1000).toISOString()
    await h.setTime(resumeAt)
    c.now = () => Date.parse(resumeAt)
    const recovered = await raw(['tools', 'call'].join('/'), { name: 'lodge.proposals.prepare', arguments: overrunArgs })
    assert.equal(recovered.status, 200)
    assert.equal(recovered.body.result.isError, false)
    assert.equal((await h.state()).proposals.length, native.proposals.length + 1)
    assert.ok(!(await h.state()).vacancies.some(row => row.title === title), 'recovery still leaves a human decision')
    rows.push({ phase, protocol: '2026-07-28', policyDisposition: disposition,
      discoveredRequestsPerMinute: limit, acceptedPreparationCallsBeforeFill: 1,
      acceptedCatalogueCalls: limit - 1, overrunStatus: overrun.status,
      overrunCode: overrun.body.error.data.code, retryAfterSeconds: Number(overrun.retryAfter),
      toolResultAbsent: overrun.body.result === undefined,
      nativeRecordsBefore: beforeRecords.length, nativeRecordsSha256: digest(beforeRecords),
      allNativeRowsValuesAndRevisionsUnchanged: true, humanStateStatus: humanResponse.status,
      humanStateUnchanged: true, draftCountBefore: native.proposals.length,
      draftCountAfterRefusal: afterNative.proposals.length, hiringStateUnchanged: true,
      sameRefusedArgumentsAfterRetryAfterStatus: recovered.status,
      recoveryDraftAdded: true, fixtureClockPinned: true, automatic429Retries: 0,
    })
    console.log(`PROBE BASE-AGENT-011 acceptance-1 ${phase}: authenticated raw MCP, discovered capacity ${limit} -> HTTP 429 rate_limited, Retry-After ${overrun.retryAfter}; native state unchanged; human HTTP 200; same input succeeds after wait`)
    await h.setTime(fixtureTime)
    c.now = () => Date.parse(fixtureTime)
  }
  assert.ok(c.points.every(point => point.ok), 'disposable policy adoption assertions pass')
  const receipt = { schema: 1, qualification: 'BASE-AGENT-011 acceptance 1 only',
    head, fixtureTime, transport: 'raw HTTP to real Worker socket with real D1',
    credentialSource: 'disposable signed Business fixture only', providerCalls: 0,
    status: 'passed', phases: rows,
    heldRemainder: 'All other original acceptance and all existing Base, provider, account, lifecycle and custody obligations remain open. No DONE claim.',
  }
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n')
} finally {
  await h.close()
}
