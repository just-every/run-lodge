import assert from 'node:assert/strict'
import { createHash, randomUUID, webcrypto } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd(), packet = new URL('.', import.meta.url)
const require = createRequire(join(root, 'package.json'))
const { Miniflare, convertV4MiniflareOptions } = require('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')
const { chromium } = require('@playwright/test')
const nativeImport = path => import(pathToFileURL(join(root, path)))
const { default: initializeOwner } = await nativeImport('tests/initialize-agent-owner.mjs')
const { default: initializeAgent } = await nativeImport('tests/initialize-agent.mjs')
const { default: prepareFixtures } = await nativeImport('tests/agent-phase-fixtures.mjs')
const { createProtocol } = await nativeImport('src/modules/agent-door/conformance/protocol.mjs')
const { autonomousPolicy, heldPolicy, signJws, seconds, accessToken, canonical } =
  await nativeImport('src/modules/agent-door/conformance/crypto.mjs')
const sha = value => createHash('sha256').update(value).digest('hex')
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
const output = { tag: 'sx-lodge-c-f58', head, trackedTreeClean: !status, startedAt: new Date().toISOString(),
  scope: 'BASE-AGENT-012 acceptance 2 only', cases: [], browser: [], outboundRequests: 0 }
const publicText = value => JSON.stringify(value, null, 2).replaceAll('@', '[at]')
const save = async () => writeFile(new URL('recovery-receipt.json', packet), publicText(output) + '\n')
const modules = []
async function collect(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name)
    if (item.isDirectory() && item.name !== '.wrangler') await collect(path)
    else if (item.isFile() && /\.(m?js)$/.test(item.name)) modules.push({ type: 'ESModule', path })
  }
}
await collect(join(root, 'dist/server'))
modules.sort((a, b) => a.path.endsWith('/index.js') ? -1 : b.path.endsWith('/index.js') ? 1 : a.path.localeCompare(b.path))
output.productionModules = await Promise.all(modules.map(async m => ({ path: m.path.slice(root.length + 1), sha256: sha(await readFile(m.path)) })))
const temp = await mkdtemp(join(tmpdir(), 'synthetic-lodge-f58-'))
const portServer = createServer()
await new Promise(done => portServer.listen(0, '127.0.0.1', done))
const port = portServer.address().port
await new Promise(done => portServer.close(done))
const origin = 'http://127.0.0.1:' + port
const ring = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const kid = randomUUID(), issuer = 'https://synthetic-lodge-58.invalid', installationId = randomUUID()
const publicKeys = { [kid]: await webcrypto.subtle.exportKey('jwk', ring.publicKey) }
const ownerEmail = 'synthetic-lodge-58' + String.fromCharCode(64) + 'example.invalid'
const setupToken = 'synthetic-lodge-' + randomUUID()
const config = JSON.parse(await readFile('dist/server/wrangler.json', 'utf8'))
const options = { host: '127.0.0.1', port, cf: false, unsafeLocalExplorer: false,
  resourcePersistencePath: temp, modules, modulesRoot: join(root, 'dist/server'),
  compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
  assets: { directory: join(root, 'dist/client'), binding: 'ASSETS',
    routerConfig: { has_user_worker: true }, run_worker_first: true },
  d1Databases: { DB: 'lodge' }, bindings: { AUTH_ORIGIN: origin, AUTH_LOCAL: 'true',
    OWNER_EMAIL: ownerEmail, SESSION_SECRET: randomUUID() + randomUUID(), SETUP_TOKEN: setupToken,
    MAIL_PROVIDER: 'development', MAIL_FROM: 'Synthetic Lodge <' + ownerEmail + '>',
    RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId,
    RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify(publicKeys) },
  outboundService: async () => { output.outboundRequests++; return new Response('External network refused by qualification driver', { status: 503 }) },
}
let mf, db, proxy, browser, owner
const request = (url, init = {}) => fetch(url, { redirect: 'manual', ...init })
const ownerRequest = async (url, init = {}) => {
  const headers = new Headers(init.headers); headers.set('Origin', origin); headers.set('Cookie', owner)
  return request(url, { ...init, headers })
}
const getJson = async path => {
  const res = await ownerRequest(origin + path)
  assert.equal(res.status, 200, path + ': ' + await res.clone().text())
  return res.json()
}
const snapshot = async () => (await db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
const calls = async (agent, key) => db.prepare('SELECT digest,state,outcome,decision_id FROM agent_door_calls WHERE agent=? AND key=?').bind(agent, key).first()
const parseRpc = bytes => {
  const raw = Buffer.from(bytes).toString()
  if (raw.startsWith('data:') || raw.startsWith('event:')) {
    const messages = raw.split(/\r?\n\r?\n/).flatMap(block => block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5).trim())))
    return messages.findLast(value => value.id !== undefined)
  }
  return JSON.parse(raw)
}
const semantics = body => {
  const meta = structuredClone(body.result._meta)
  if (meta['com.runeditrun/decision']) delete meta['com.runeditrun/decision'].id
  // The shared replay receipt and the fresh transport decision id describe the
  // retry. The stored structured result and review handle are the effect.
  delete meta['com.runeditrun/receipt']
  return { structuredContent: body.result.structuredContent, content: body.result.content,
    resultType: body.result.resultType, isError: body.result.isError, meta }
}
const start = async () => {
  mf = new Miniflare(convertV4MiniflareOptions(options))
  await mf.ready; db = await mf.getD1Database('DB')
}
let armed
try {
  await start()
  for (const file of (await readdir('migrations/core')).filter(x => x.endsWith('.sql')).sort()) {
    await db.batch(unstable_splitSqlQuery(await readFile('migrations/core/' + file, 'utf8')).map(sql => db.prepare(sql)))
  }
  const bootstrap = await initializeOwner({ request, origin, claim: { path: '/auth/bootstrap', token: setupToken },
    displayName: 'Synthetic Lodge Owner', email: ownerEmail, returnTo: '/app' })
  assert.equal(bootstrap.status, 303)
  owner = bootstrap.headers.getSetCookie().map(x => x.split(';')[0]).join('; ')
  assert.ok(owner); await bootstrap.body?.cancel()
  const session = await getJson('/auth/session')
  const email = session.operator.email, sub = randomUUID(), iat = seconds()
  const settings = await signJws(ring.privateKey, kid, 'rer-business-settings+jwt', {
    v: 1, iss: issuer, aud: origin, sub: installationId, business: 'synthetic-lodge-58',
    email, owner_id: sub, jti: randomUUID(), iat, exp: iat + 300, rev: 1, values: {}, logo: null, team: null,
  })
  const adopted = await request(origin + '/api/rer/business-settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings }) })
  assert.equal(adopted.status, 200, await adopted.clone().text()); await adopted.body?.cancel()
  const surface = JSON.parse(await readFile('agent-surface.json', 'utf8'))
  const c = createProtocol({ fetch: request, origin, surface, points: [],
    signer: { issuer, installationId, kid, privateKey: ring.privateKey }, person: { email, sub, cookie: owner },
    business: 'synthetic-lodge-58', agentId: randomUUID(), consent: randomUUID(), seq: 0, revision: 0 })
  await initializeAgent({ agentId: c.agentId, request: ownerRequest, origin, email })

  proxy = createServer(async (incoming, downstream) => {
    const current = armed
    try {
      assert.ok(current, 'one explicitly armed loss request')
      armed = null
      const body = Buffer.concat(await Array.fromAsync(incoming))
      assert.equal(sha(body), current.requestHash)
      const upstream = await request(origin + '/mcp', { method: 'POST', headers: current.headers, body })
      const bytes = Buffer.from(await upstream.arrayBuffer())
      current.upstreamStatus = upstream.status
      current.upstreamBytes = bytes.length
      current.upstreamSha256 = sha(bytes)
      current.upstreamBodyHex = bytes.toString('hex')
      current.first = parseRpc(bytes)
      assert.equal(upstream.status, 200, bytes.toString())
      assert.equal(current.first.result?.isError, false, bytes.toString())
      const durable = await calls(c.agentId, current.key)
      assert.equal(durable.state, 'done')
      assert.deepEqual(JSON.parse(durable.outcome).result, current.first.result.structuredContent)
      current.durableBeforeDrop = { state: durable.state, digest: durable.digest, outcomeSha256: sha(durable.outcome) }
      current.sequence.push('complete upstream body captured', 'durable outcome confirmed')
      const partial = Math.floor(bytes.length / 2)
      downstream.writeHead(200, { 'Content-Type': upstream.headers.get('content-type'), 'Content-Length': bytes.length, Connection: 'close' })
      downstream.write(bytes.subarray(0, partial), () => {
        current.deliveredBytes = partial
        current.sequence.push('partial downstream body flushed', 'downstream socket terminated')
        downstream.destroy()
      })
      current.finished()
    } catch (error) { current?.failed(error); downstream.destroy() }
  })
  await new Promise(done => proxy.listen(0, '127.0.0.1', done))
  const proxyOrigin = 'http://127.0.0.1:' + proxy.address().port
  for (const [phase, policy, disposition] of [['autonomous', autonomousPolicy(), 'autonomous'], ['held', heldPolicy(), 'review']]) {
    await c.adopt(policy)
    const fixtures = await prepareFixtures({ request: ownerRequest, origin, cookie: owner, email, phase })
    const inventory = await c.tool('lodge.proposals.list', {})
    assert.equal(inventory.result?.isError, false)
    const applicationRevision = inventory.result.structuredContent.records.find(r => r.kind === 'application' && r.id === fixtures.values.debrief.application).revision
    for (const family of ['proposals', 'debriefs']) {
      const label = phase + '-' + family, key = 'synthetic-lodge-' + randomUUID(), tool = 'lodge.' + family + '.prepare'
      const title = 'Synthetic Lodge response loss ' + phase
      const args = family === 'proposals' ? { workflow: 'prepare-vacancy', approver: email,
        summary: title, intake: 'Prepare an unsent estimator draft for human review.',
        changes: [{ op: 'vacancy', input: { title, location: 'Brooklyn, NY', headcount: 1,
          manager: email, description: 'Prepare estimates from drawings.' } }], idempotency_key: key } :
        { ...fixtures.values.debrief, expected_revision: applicationRevision, idempotency_key: key }
      const token = await accessToken(c)
      const headers = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json',
        Origin: origin, 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': tool,
        Authorization: 'Bearer ' + token }
      const envelope = id => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: args,
        _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': { elicitation: { url: {} } },
          'io.modelcontextprotocol/clientInfo': { name: 'rer-agent-conformance', version: '1' } } } })
      const firstId = label + '-first', retryId = label + '-retry'
      const before = await snapshot(), beforeState = await getJson('/api/lodge/state')
      const rowsName = family === 'proposals' ? 'proposals' : 'debriefs'
      const row = { phase, tool, key, firstId, retryId, requestHash: sha(envelope(firstId)), headers,
        sequence: [], requestArgumentsSha256: sha(canonical(args)), policyRevision: c.revision,
        policySha256: sha(canonical(policy)), principal: { agent: c.agentId, sponsor: sub, consent: c.consent,
          client: 'rer-agent-conformance' } }
      let finish, fail
      const upstreamDone = new Promise((done, rejected) => { finish = done; fail = rejected })
      row.finished = finish; row.failed = fail; armed = row
      try {
        const response = await request(proxyOrigin + '/mcp', { method: 'POST', headers, body: envelope(firstId), signal: AbortSignal.timeout(15000) })
        row.callerStatus = response.status
        await response.text()
        assert.fail('The caller unexpectedly consumed a complete result')
      } catch (error) {
        if (error.code === 'ERR_ASSERTION') throw error
        row.callerFailure = { name: error.name, message: error.message, cause: error.cause?.code ?? error.cause?.message ?? null }
      }
      await upstreamDone
      assert.ok(row.callerFailure)
      assert.ok(row.deliveredBytes > 0 && row.deliveredBytes < row.upstreamBytes)
      assert.equal(row.first.id, firstId)
      assert.equal(row.first.result._meta['com.runeditrun/decision'].disposition, disposition)
      const firstResult = row.first.result.structuredContent, draftId = firstResult.id
      const stateAfter = await getJson('/api/lodge/state'), after = await snapshot()
      const nativeDraft = stateAfter[rowsName].find(r => r.id === draftId)
      assert.ok(nativeDraft, 'signed-in native state exposes the original draft')
      assert.equal(nativeDraft.status, family === 'proposals' ? 'proposed' : 'draft')
      assert.equal(stateAfter[rowsName].length, beforeState[rowsName].length + 1)
      assert.deepEqual(stateAfter.vacancies, beforeState.vacancies)
      assert.deepEqual(stateAfter.applications, beforeState.applications)
      assert.deepEqual(after.filter(r => !['proposal', 'debrief', 'audit'].includes(r.kind)),
        before.filter(r => !['proposal', 'debrief', 'audit'].includes(r.kind)))
      const storedFirst = await calls(c.agentId, key)
      const review = row.first.result._meta['com.runeditrun/review'] ?? null
      assert.equal(Boolean(review), phase === 'held')
      const reviewsBefore = await getJson('/agents/api/reviews')
      if (review) assert.ok(reviewsBefore.reviews.some(r => r.id === review.id && r.state === 'open'))
      row.sequence.push('signed-in native state confirms one unsent draft')
      await mf.dispose(); mf = null; await start()
      row.sequence.push('Worker disposed and restarted against same D1')
      assert.deepEqual(await snapshot(), after)
      assert.deepEqual(await calls(c.agentId, key), storedFirst)
      const retry = await request(origin + '/mcp', { method: 'POST', headers, body: envelope(retryId) })
      const retryBytes = Buffer.from(await retry.arrayBuffer()), retryBody = parseRpc(retryBytes)
      assert.equal(retry.status, 200, retryBytes.toString())
      assert.equal(retryBody.id, retryId); assert.notEqual(firstId, retryId)
      assert.equal(retryBody.result?.isError, false)
      assert.deepEqual(semantics(retryBody), semantics(row.first))
      assert.deepEqual(retryBody.result.structuredContent, firstResult)
      assert.deepEqual(retryBody.result._meta['com.runeditrun/review'] ?? null, review)
      assert.deepEqual(await snapshot(), after, 'every native record value and revision remains identical')
      const retryState = await getJson('/api/lodge/state')
      assert.equal(retryState[rowsName].length, stateAfter[rowsName].length)
      assert.deepEqual(retryState[rowsName].find(r => r.id === draftId), nativeDraft)
      assert.deepEqual(await getJson('/agents/api/reviews'), reviewsBefore)
      assert.deepEqual(await calls(c.agentId, key), storedFirst)
      const audit = await getJson('/agents/api/audit?limit=500')
      assert.ok(audit.rows.some(a => a.outcome === 'replayed' && a.replay_of === storedFirst.decision_id && a.tool === tool))
      row.sequence.push('fresh RPC id retry returns original semantic outcome without native mutation')
      output.cases.push({ label, phase, tool, idempotencyKey: key, rpcIds: [firstId, retryId],
        sequence: row.sequence, upstream: { status: row.upstreamStatus, bytes: row.upstreamBytes,
          sha256: row.upstreamSha256, bodyHex: row.upstreamBodyHex, encoding: 'hex of exact complete response bytes' },
        downstream: { advertisedBytes: row.upstreamBytes, deliveredBytes: row.deliveredBytes,
          status: row.callerStatus ?? null, failure: row.callerFailure },
        durableBeforeDrop: row.durableBeforeDrop, retry: { status: retry.status, bytes: retryBytes.length,
          bodyHex: retryBytes.toString('hex'), sha256: sha(retryBytes) },
        draft: { id: draftId, state: nativeDraft.status, nativeContent: nativeDraft, contentSha256: sha(canonical(nativeDraft)),
          countBefore: beforeState[rowsName].length, countAfter: stateAfter[rowsName].length,
          countAfterRestartRetry: retryState[rowsName].length }, review,
        nativeRecords: { count: after.length, beforeRetrySha256: sha(canonical(after)),
          afterRetrySha256: sha(canonical(await snapshot())), everyValueAndRevisionEqual: true },
        principal: row.principal, policyRevision: row.policyRevision, policySha256: row.policySha256,
        requestArgumentsSha256: row.requestArgumentsSha256, unchangedCredential: true,
        unchangedAgentSponsorConsentClientPolicy: true, replayAudit: true,
        application: family === 'debriefs' ? fixtures.values.debrief.application : null, pass: true })
      console.log('PROBE BASE-AGENT-012 acceptance-2 ' + label + ': complete upstream HTTP response, partial delivery and caller ' +
        row.callerFailure.name + ' -> same-D1 Worker restart, identical-key new-id retry -> original unsent draft and semantic result; native values and revisions unchanged')
      await save()
    }
  }
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } })
    try {
      // The fixture's native session remains private in memory; no session files.
      const cookies = owner.split('; ').map(pair => {
        const at = pair.indexOf('='); return { name: pair.slice(0, at), value: pair.slice(at + 1), url: origin }
      })
      await context.addCookies(cookies)
      const page = await context.newPage()
      await page.goto(origin + '/app')
      const proposalNav = page.getByRole('button', { name: /^Proposals/ })
      await proposalNav.click()
      await page.getByRole('heading', { name: 'Agent proposals', exact: true }).waitFor()
      if (width === 1440) {
        for (const phase of ['autonomous', 'held']) await page.getByRole('heading', { name: 'Synthetic Lodge response loss ' + phase, exact: true }).waitFor()
        assert.equal(await page.getByRole('button', { name: 'Record decision', exact: true }).count(), 2)
      }
      const proposalShot = 'proposals-' + width + '.png'
      await page.screenshot({ path: new URL(proposalShot, packet).pathname, fullPage: true })
      output.browser.push({ screen: 'native unsent proposals', width, file: proposalShot, inspected: false })
      for (const item of output.cases.filter(row => row.tool === 'lodge.debriefs.prepare')) {
        await page.goto(origin + '/app?application=' + item.application)
        await page.getByRole('tab', { name: 'Scorecards', exact: true }).click()
        const section = page.getByRole('region', { name: 'Debrief brief', exact: true })
        await section.waitFor()
        if (width === 1440) {
          await section.locator('p').filter({ hasText: 'Takeoffs has not been assessed.' }).waitFor()
          await section.getByRole('button', { name: 'Keep this brief', exact: true }).waitFor()
          await section.getByRole('button', { name: 'Discard this brief', exact: true }).waitFor()
          const close = page.getByRole('button', { name: 'Close the application', exact: true })
          await close.focus()
          await page.getByRole('tooltip', { name: 'Close the application', exact: true }).waitFor()
          await close.blur()
          await close.hover()
          await page.getByRole('tooltip', { name: 'Close the application', exact: true }).waitFor()
          await page.mouse.move(200, 40)
        }
        await section.scrollIntoViewIfNeeded()
        const file = 'debrief-' + item.phase + '-' + width + '.png'
        await page.screenshot({ path: new URL(file, packet).pathname, fullPage: true })
        output.browser.push({ screen: 'native unsent debrief ' + item.phase, width, file, inspected: false })
      }
    } finally { await context.close() }
  }
  assert.equal(output.outboundRequests, 0)
  assert.equal(output.cases.length, 4)
  assert.ok(output.cases.every(c => c.pass))
  output.result = 'PASS'
} catch (error) {
  output.result = 'FAIL'; output.error = { name: error.name, message: error.message, stack: error.stack }
  throw error
} finally {
  output.finishedAt = new Date().toISOString()
  await browser?.close()
  if (proxy) await new Promise(done => proxy.close(done))
  await mf?.dispose()
  await rm(temp, { recursive: true, force: true })
  await save()
}
