import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID, webcrypto, createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = process.cwd(), packet = dirname(fileURLToPath(import.meta.url))
const load = path => import(pathToFileURL(join(root, path)))
const { businessHarness } = await import('./production-harness.mjs')
const { default: initializeAgent } = await load('tests/initialize-agent.mjs')
const { default: prepareFixtures } = await load('tests/agent-phase-fixtures.mjs')
const { createProtocol, VERSION, DECISION } = await load('src/modules/agent-door/conformance/protocol.mjs')
const { autonomousPolicy, heldPolicy, seconds, signJws, accessToken } = await load('src/modules/agent-door/conformance/crypto.mjs')
const surface = JSON.parse(await readFile(join(root, 'agent-surface.json'), 'utf8'))
const receipt = { schema: 1, tag: 'sx-lodge-c-f59', head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), started: new Date().toISOString(), checks: [], screenshots: [], status: 'running' }
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
let providerCalls = 0
const ring = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const kid = randomUUID(), issuer = 'https://synthetic-lodge-59.invalid', installationId = randomUUID()
const h = await businessHarness({ bindings: {
  RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId,
  RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify({ [kid]: await webcrypto.subtle.exportKey('jwk', ring.publicKey) }),
}, outboundService: () => { providerCalls++; return new Response('External service refused by qualification', { status: 502 }) } })
const request = (url, init = {}) => h.mf.dispatchFetch(url, init)
const ownerRequest = async (url, init = {}) => {
  const headers = new Headers(init.headers)
  headers.set('Origin', h.origin); headers.set('Cookie', h.owner)
  const response = await request(url, { ...init, headers: Object.fromEntries(headers) })
  assert.ok(response.ok, 'Native fixture refused: ' + new URL(url).pathname)
  return response
}
const rows = async table => (await h.db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()).results
const snapshot = async () => ({
  records: (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results,
  calls: await rows('agent_door_calls'), reviews: await rows('agent_door_reviews'), approvals: await rows('agent_door_approvals'),
  audit: await rows('agent_door_audit'), usage: await rows('agent_door_usage'), events: await rows('agent_door_events'),
  mail: await rows('rer_mail_development_outbox'), providerCalls,
})
// This is an actual HTTP connection to workerd. Node supplies chunked framing
// when no length is declared; neither dispatchFetch nor a buffered fetch is used.
async function raw(body, token, mode) {
  return new Promise((resolve, reject) => {
    const headers = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json',
      Origin: h.origin, Authorization: 'Bearer ' + token, 'MCP-Protocol-Version': VERSION,
      'Mcp-Method': 'tools/call', 'Mcp-Name': 'lodge.proposals.prepare',
      ...(mode === 'declared' ? { 'Content-Length': Buffer.byteLength(body) } : {}),
    }
    let chunksWritten = 0, bytesWritten = 0, settled = false
    const req = httpRequest(h.origin + '/mcp', { method: 'POST', headers }, res => {
      const parts = []
      res.on('data', part => parts.push(part))
      res.on('end', () => {
        settled = true
        const text = Buffer.concat(parts).toString('utf8')
        const framing = { contentLength: req.getHeader('content-length') ?? null,
          chunked: /\r\ntransfer-encoding: chunked\r\n/i.test(req._header), chunksWritten, bytesWritten }
        resolve({ status: res.statusCode, body: JSON.parse(text), framing })
      })
      res.on('error', reject)
    })
    req.setTimeout(30000, () => req.destroy(new Error('Raw request timed out')))
    req.on('error', error => { if (!settled) reject(error) })
    if (mode === 'declared') { chunksWritten++; bytesWritten = Buffer.byteLength(body); req.end(body); return }
    const bytes = Buffer.from(body)
    let offset = 0
    function next() {
      if (settled || req.destroyed) return
      if (offset === bytes.length) { req.end(); return }
      const chunk = bytes.subarray(offset, Math.min(offset + 16384, bytes.length))
      offset += chunk.length; chunksWritten++; bytesWritten += chunk.length
      req.write(chunk, () => setImmediate(next))
    }
    next()
  })
}

let browser
try {
  const session = await h.send('/auth/session', undefined, h.owner)
  const email = session.value.operator.email, sub = randomUUID(), iat = seconds()
  const settings = await signJws(ring.privateKey, kid, 'rer-business-settings+jwt', {
    v: 1, iss: issuer, aud: h.origin, sub: installationId, business: 'synthetic-lodge-59', email,
    owner_id: sub, jti: randomUUID(), iat, exp: iat + 300, rev: 1, values: {}, logo: null, team: null,
  })
  assert.equal((await h.send('/api/rer/business-settings', { settings })).status, 200)
  const c = createProtocol({ fetch: request, origin: h.origin, surface, points: [],
    signer: { issuer, installationId, kid, privateKey: ring.privateKey }, person: { email, sub, cookie: h.owner },
    business: 'synthetic-lodge-59', agentId: randomUUID(), consent: randomUUID(), seq: 0, revision: 0,
  })
  await initializeAgent({ agentId: c.agentId, request: ownerRequest, origin: h.origin, email })
  const fixtures = await prepareFixtures({ request: ownerRequest, origin: h.origin, email, cookie: h.owner, phase: 'autonomous' })
  const discover = await c.mcp('server/discover')
  const maxBodyBytes = discover.result._meta['com.runeditrun/limits'].maxBodyBytes
  assert.ok(Number.isSafeInteger(maxBodyBytes) && maxBodyBytes > 0)
  receipt.maxBodyBytes = maxBodyBytes
  receipt.discovery = { versions: discover.result.supportedVersions, capabilities: discover.result.capabilities,
    serverInfo: discover.result._meta['io.modelcontextprotocol/serverInfo'], instructions: Boolean(discover.result.instructions) }

  // The rest of the transport acceptance remains exercised, without changing it.
  for (const [phase, policy, disposition] of [['autonomous', autonomousPolicy(), 'autonomous'], ['held', heldPolicy(), 'review']]) {
    await c.adopt(policy)
    if (phase === 'autonomous') {
      const retained = await c.tool('lodge.proposals.prepare', { workflow: 'prepare-vacancy', summary: 'Synthetic retained draft',
        intake: 'Retain this existing draft across capacity refusals.', approver: email, idempotency_key: randomUUID(),
        changes: [{ op: 'vacancy', input: { title: 'Synthetic retained vacancy', location: 'Brooklyn, NY', headcount: 1, manager: email } }] })
      assert.equal(retained.result.isError, false)
      const source = await h.db.prepare("SELECT revision FROM l_records WHERE kind='application' AND id=?").bind(fixtures.values.debrief.application).first()
      const debrief = await c.tool('lodge.debriefs.prepare', { ...fixtures.values.debrief, expected_revision: source.revision, idempotency_key: randomUUID() })
      assert.equal(debrief.result.isError, false)
      receipt.retainedDrafts = { proposals: 1, debriefs: 1 }
    }
    const first = await c.mcp('tools/list'), second = await c.mcp('tools/list')
    assert.deepEqual(first.result, second.result)
    assert.equal(first.result.cacheScope, 'private'); assert.equal(typeof first.result.ttlMs, 'number')
    for (const version of [VERSION, '2025-11-25']) {
      const initialized = await c.mcp('initialize', { protocolVersion: version, capabilities: {} }, { version })
      assert.equal(initialized.result.protocolVersion, version)
      assert.deepEqual((await c.mcp('tools/list', {}, { version })).result.tools, first.result.tools)
    }
    assert.equal((await c.mcp('server/discover', {}, { version: '2099-01-01' })).body.error.message, 'UnsupportedProtocolVersion')
    assert.equal((await c.mcp('server/discover', {}, { headers: { Origin: issuer } })).status, 403)
    assert.equal((await c.mcp('server/discover', {}, { headers: { 'Mcp-Method': 'tools/list' } })).body.error.message, 'HeaderMismatch')
    for (const mode of ['declared', 'streamed']) {
      const title = 'Synthetic overflow ' + phase + ' ' + mode
      const args = { workflow: 'prepare-vacancy', summary: title, intake: 'Prepare an estimator vacancy.', approver: email,
        idempotency_key: randomUUID(), changes: [{ op: 'vacancy', input: { title, location: 'Brooklyn, NY', headcount: 1, manager: email, description: 'Prepare estimates from drawings.' } }] }
      const rpc = { jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name: 'lodge.proposals.prepare', arguments: args,
        _meta: { 'io.modelcontextprotocol/protocolVersion': VERSION } } }
      const small = JSON.stringify(rpc), oversized = small + ' '.repeat(maxBodyBytes + 1 - Buffer.byteLength(small))
      assert.ok(Buffer.byteLength(small) < maxBodyBytes)
      assert.deepEqual(JSON.parse(oversized), rpc, 'Whitespace padding preserves the exact valid tool arguments')
      const before = await snapshot(), stateBefore = await h.state()
      assert.ok(stateBefore.proposals.length > 0 && stateBefore.debriefs.length > 0, 'The refusal comparison protects nonempty draft inventories')
      const denied = await raw(oversized, await accessToken(c), mode)
      assert.equal(denied.status, 413); assert.equal(denied.body.result, undefined)
      assert.equal(denied.body.error.message, 'Body too large')
      if (mode === 'streamed') {
        assert.equal(denied.framing.contentLength, null); assert.equal(denied.framing.chunked, true)
        assert.ok(denied.framing.chunksWritten > 1); assert.ok(denied.framing.bytesWritten > maxBodyBytes)
      } else assert.equal(Number(denied.framing.contentLength), Buffer.byteLength(oversized))
      const after = await snapshot()
      assert.deepEqual(after, before, 'Oversize refusal preserves all native values, revisions and effect inventories')
      const stateAfter = await h.state()
      for (const key of ['proposals', 'debriefs', 'vacancies', 'applications', 'offers', 'approvals', 'scorecards', 'messages'])
        assert.deepEqual(stateAfter[key], stateBefore[key], 'Refusal preserves ' + key)
      const accepted = await raw(small, await accessToken(c), 'declared')
      assert.equal(accepted.status, 200); assert.equal(accepted.body.result.isError, false)
      const result = accepted.body.result, decision = result._meta[DECISION], proposalId = result.structuredContent.id
      assert.equal(decision.disposition, disposition); assert.equal(decision.revision, c.revision)
      const current = await h.state(), saved = current.proposals.find(row => row.id === proposalId)
      assert.equal(saved.status, 'proposed'); assert.equal(saved.summary, title)
      assert.equal(current.proposals.length, stateBefore.proposals.length + 1)
      assert.equal(current.proposals.filter(row => row.summary === title).length, 1)
      for (const key of ['debriefs', 'vacancies', 'applications', 'offers', 'approvals', 'scorecards', 'messages'])
        assert.deepEqual(current[key], stateBefore[key], 'Draft preparation preserves ' + key)
      const afterSmall = await snapshot()
      assert.deepEqual(afterSmall.records.filter(row => !['proposal', 'audit'].includes(row.kind)), before.records.filter(row => !['proposal', 'audit'].includes(row.kind)), 'Every non-proposal native record retains its exact value and revision')
      const call = afterSmall.calls.find(row => row.key === args.idempotency_key)
      assert.equal(call.decision_id, decision.id); assert.equal(call.state, 'done')
      const audit = afterSmall.audit.map(row => JSON.parse(row.row)).find(row => row.idempotency_key === args.idempotency_key)
      assert.equal(audit.id, decision.id); assert.equal(audit.revision, c.revision); assert.equal(audit.outcome, 'done')
      const reviewId = result._meta['com.runeditrun/review']?.id ?? null
      if (phase === 'held') {
        const review = afterSmall.reviews.find(row => row.id === reviewId)
        assert.equal(review.state, 'open'); assert.equal(JSON.parse(review.saved).decision_id, decision.id)
        assert.equal(audit.review.id, reviewId)
      } else assert.equal(reviewId, null)
      const replay = await raw(small, await accessToken(c), 'declared')
      assert.equal(replay.status, 200); assert.equal(replay.body.result.structuredContent.id, proposalId)
      assert.deepEqual((await h.state()).proposals, current.proposals)
      assert.equal(providerCalls, 0); assert.deepEqual((await snapshot()).mail, before.mail)
      receipt.checks.push({ phase, mode, maxBodyBytes, requestBytes: Buffer.byteLength(oversized), withinCapacityBytes: Buffer.byteLength(small),
        framing: denied.framing, refusal: denied.body, status: denied.status, nativeBeforeSha256: hash(before.records), nativeAfterSha256: hash(after.records),
        nativeRecordCount: before.records.length, allEffectTablesUnchanged: true, inventoriesAndHiringDecisionsUnchanged: true,
        retryStatus: accepted.status, exactlyOneProposedDraft: true, decisionDisposition: decision.disposition, policyRevision: decision.revision,
        decisionLinkedToCallAndAudit: true, reviewLinked: phase === 'held', replaySameDraft: true, providerCalls: 0, mailUnchanged: true })
      console.log('PROBE BASE-AGENT-001 6 ' + phase + ' ' + mode + ': authenticated raw HTTP -> 413, native state identical; same valid arguments and key within capacity -> exactly one proposed draft, ' + disposition + ', no applied vacancy or provider call')
    }
  }
  assert.ok(c.points.every(point => point.ok))
  receipt.transportPointsOneToFive = 'passed under both policies'

  if (process.env.QUALIFY_BROWSER === '1') {
    const { chromium } = await load('node_modules/@playwright/test/index.mjs')
    browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    await context.addCookies(h.owner.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: h.origin })))
    const page = await context.newPage()
    const capture = async name => {
      const { iconTooltips } = await load('tests/icon-tooltips.mjs')
      await iconTooltips(page)
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        const filename = name + '-' + width + '.png'
        await page.screenshot({ path: join(packet, filename), fullPage: true })
        receipt.screenshots.push(filename)
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    await page.goto(h.origin + '/app')
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^Proposals/ }).click()
    await page.getByRole('heading', { name: 'Agent proposals', exact: true }).waitFor()
    assert.equal(await page.getByRole('heading', { name: /^Synthetic overflow/ }).count(), 4)
    await capture('native-proposed-drafts')
    await page.goto(h.origin + '/app?application=' + fixtures.values.debrief.application)
    await page.getByRole('tab', { name: 'Scorecards', exact: true }).click()
    await page.getByRole('region', { name: 'Debrief brief', exact: true }).waitFor()
    await capture('native-retained-debrief')
    // An ordinary policy refusal is visible in the existing agent activity page.
    const blocked = autonomousPolicy(); blocked.rules[0].do = 'blocked'
    await c.adopt(blocked)
    const denied = await c.tool('lodge.jobs.list', {})
    assert.equal(denied.result._meta['com.runeditrun/error'].code, 'policy_blocked')
    await page.goto(h.origin + '/agents')
    await page.getByRole('heading', { name: 'Agents', exact: true }).waitFor()
    assert.match(await page.locator('body').innerText(), /blocked|refused|not allowed/i)
    await capture('native-policy-refusal')
    await context.close()
    receipt.browser = 'Unchanged emitted production Worker, native session, real D1 and built assets over HTTP; no intercepted browser responses'
  }
  receipt.status = 'passed'
} catch (error) {
  receipt.status = 'failed'; receipt.failure = { name: error.name, message: error.message, stack: error.stack?.split('\n').filter(line => line.includes('oversize-qualification.mjs')).join('\n') }
  console.error(receipt.failure)
  process.exitCode = 1
} finally {
  await browser?.close(); await h.close()
  receipt.completed = new Date().toISOString()
  await writeFile(join(packet, 'qualification-receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
}
