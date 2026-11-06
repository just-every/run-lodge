import assert from 'node:assert/strict'
import { createHash, randomUUID, webcrypto } from 'node:crypto'
import { createServer } from 'node:http'
import { createServer as socketServer } from 'node:net'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const root = resolve(process.env.LODGE_ROOT || process.cwd())
const packet = resolve(process.env.LODGE_PACKET || new URL('.', import.meta.url).pathname)
process.chdir(root)
const require = createRequire(join(root, 'package.json'))
const { Miniflare, convertV4MiniflareOptions } = require('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')
const load = path => import(pathToFileURL(join(root, path)))
const { createProtocol } = await load('src/modules/agent-door/conformance/protocol.mjs')
const { autonomousPolicy, heldPolicy, seconds, signJws, accessToken } = await load('src/modules/agent-door/conformance/crypto.mjs')
const { default: initializeOwner } = await load('tests/initialize-agent-owner.mjs')
const { default: initializeAgent } = await load('tests/initialize-agent.mjs')
const { default: prepareFixtures } = await load('tests/agent-phase-fixtures.mjs')
const { chromium } = require('@playwright/test')
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex')
// Escape the at-sign in JSON serialization without changing decoded evidence.
const save = (name, value) => writeFile(join(packet, name), JSON.stringify(value, null, 2).replaceAll('@', '\\u0040') + '\n')
const receipt = { schema: 1, tag: 'sx-lodge-c-f56', clause: 'BASE-AGENT-012', acceptance: 2,
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  builtWorkerSha256: hash(await readFile('dist/server/index.js')), startedAt: new Date().toISOString(),
  runtime: 'production build in workerd, persistent D1, actual loopback HTTP', cases: [], screens: [] }
const port = await new Promise(resolve => { const s = socketServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const origin = 'http://127.0.0.1:' + port
const dir = await mkdtemp(join(tmpdir(), 'sx-lodge-f56-'))
const config = JSON.parse(await readFile('dist/server/wrangler.json', 'utf8'))
const files = async path => (await Promise.all((await readdir(path, { withFileTypes: true })).map(async item => item.isDirectory() ? files(join(path, item.name)) : [join(path, item.name)]))).flat()
const build = resolve('dist/server'), entry = resolve(build, config.main)
const types = { '.js': 'ESModule', '.mjs': 'ESModule', '.cjs': 'CommonJS', '.wasm': 'CompiledWasm', '.bin': 'Data', '.txt': 'Text', '.html': 'Text', '.sql': 'Text' }
const modules = [entry, ...(await files(build)).filter(path => path !== entry && types[extname(path)])].map(path => ({ type: types[extname(path)], path }))
const ring = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const kid = randomUUID(), issuer = 'https://synthetic-lodge-56.invalid', installationId = randomUUID(), sub = randomUUID()
const publicKeys = { [kid]: await webcrypto.subtle.exportKey('jwk', ring.publicKey) }
const email = ['synthetic-lodge-56', 'example.invalid'].join(String.fromCharCode(64))
const setupToken = 'synthetic-lodge-56-setup-' + randomUUID()
const options = { host: '127.0.0.1', port, cf: false, unsafeLocalExplorer: false,
  resourcePersistencePath: dir, name: 'app', modules, modulesRoot: build,
  compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
  d1Databases: { DB: 'lodge-f56' },
  assets: { directory: resolve('dist/client'), binding: 'ASSETS', routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: true } },
  bindings: { ...config.vars, AUTH_ORIGIN: origin, AUTH_LOCAL: 'true', OWNER_EMAIL: email,
    SESSION_SECRET: 'synthetic-lodge-56-session-' + randomUUID(), SETUP_TOKEN: setupToken,
    MAIL_PROVIDER: 'development', MAIL_FROM: email,
    RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId,
    RER_OWNER_CLAIM_APP_ORIGIN: origin, RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify(publicKeys) } }
let mf, db, browser, owner, restartCount = 0
const start = async () => { mf = new Miniflare(convertV4MiniflareOptions(options)); await mf.ready; db = await mf.getD1Database('DB'); restartCount++ }
const request = (url, init = {}) => fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30000) })
const ownerRequest = async (url, init = {}) => {
  const headers = new Headers(init.headers); headers.set('Origin', origin); headers.set('Cookie', owner)
  const response = await request(url, { ...init, headers: Object.fromEntries(headers) })
  if (new URL(url).pathname.startsWith('/api/lodge/command/')) assert.ok(response.ok, 'native fixture ' + new URL(url).pathname + ': HTTP ' + response.status + ' ' + await response.clone().text())
  return response
}
const json = async response => { assert.equal(response.status, 200); return response.json() }
const state = async () => json(await ownerRequest(origin + '/api/lodge/state'))
const snapshot = async () => (await db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
const auditCount = async () => (await db.prepare('SELECT COUNT(*) AS n FROM agent_door_audit').first()).n
const wire = (name, args, id) => JSON.stringify({ jsonrpc: '2.0', id, method: ['tools','call'].join('/'), params: { name, arguments: args } })
const semantic = result => ({ structuredContent: result.structuredContent, content: result.content, isError: result.isError,
  review: result._meta?.['com.runeditrun/review'], receipt: result._meta?.['com.runeditrun/receipt'] })

try {
  await start()
  for (const file of (await readdir('migrations/core')).filter(name => name.endsWith('.sql')).sort())
    await db.batch(unstable_splitSqlQuery(await readFile(join('migrations/core', file), 'utf8')).map(sql => db.prepare(sql)))
  const bootstrap = await initializeOwner({ request, origin, claim: { path: '/auth/bootstrap', token: setupToken },
    displayName: 'Synthetic Lodge owner', email, returnTo: '/app' })
  assert.equal(bootstrap.status, 303)
  owner = bootstrap.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  assert.ok(owner)
  await bootstrap.body?.cancel()
  const iat = seconds()
  const settings = await signJws(ring.privateKey, kid, 'rer-business-settings+jwt', {
    v: 1, iss: issuer, aud: origin, sub: installationId, business: 'synthetic-lodge-56', email,
    owner_id: sub, jti: randomUUID(), iat, exp: iat + 300, rev: 1, values: {}, logo: null, team: null })
  assert.equal((await request(origin + '/api/rer/business-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings }) })).status, 200)
  const c = createProtocol({ fetch: request, origin, surface: JSON.parse(await readFile('agent-surface.json', 'utf8')),
    points: [], signer: { issuer, installationId, kid, privateKey: ring.privateKey }, person: { email, sub, cookie: owner },
    business: 'synthetic-lodge-56', agentId: randomUUID(), consent: randomUUID(), seq: 0, revision: 0 })
  await initializeAgent({ agentId: c.agentId, request: ownerRequest, origin, email })
  for (const [phase, policy, disposition] of [['autonomous', autonomousPolicy(), 'autonomous'], ['held', heldPolicy(), 'review']]) {
    await c.adopt(policy)
    const fixture = await prepareFixtures({ request: ownerRequest, origin, email, cookie: owner, phase })
    const inventory = await c.tool('lodge.proposals.list', {})
    const source = inventory.result.structuredContent.records.find(row => row.kind === 'application' && row.id === fixture.values.debrief.application)
    for (const kind of ['proposals', 'debriefs']) {
      const name = 'lodge.' + kind + '.prepare', key = 'synthetic-lodge-56-' + randomUUID()
      const title = 'Synthetic Lodge transport ' + phase
      const args = kind === 'proposals' ? { workflow: 'prepare-vacancy', summary: 'Synthetic Lodge lost-response ' + phase,
        intake: 'Prepare a vacancy draft only.', approver: email,
        changes: [{ op: 'vacancy', input: { title, location: 'Brooklyn, NY', headcount: 1, manager: email, description: 'Prepare estimates from drawings.' } }],
        idempotency_key: key } : { ...fixture.values.debrief, expected_revision: source.revision, idempotency_key: key }
      const token = await accessToken(c)
      const headers = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', Origin: origin,
        'MCP-Protocol-Version': '2025-11-25', 'Mcp-Method': ['tools','call'].join('/'), 'Mcp-Name': name, Authorization: 'Bearer ' + token }
      const firstId = randomUUID(), retryId = randomUUID()
      const before = await state(), rowsBefore = await snapshot()
      let upstream, driverError
      const proxy = createServer(async (incoming, downstream) => {
        try {
          const chunks = []; for await (const chunk of incoming) chunks.push(chunk)
          const body = Buffer.concat(chunks).toString('utf8')
          assert.equal(body, wire(name, args, firstId))
          const response = await request(origin + '/mcp', { method: 'POST', headers, body })
          const raw = await response.text(), message = JSON.parse(raw)
          assert.equal(response.status, 200)
          assert.equal(message.id, firstId)
          assert.equal(message.result?.isError, false)
          assert.equal(message.result._meta['com.runeditrun/decision'].disposition, disposition)
          const recorded = await db.prepare('SELECT state,outcome,decision_id FROM agent_door_calls WHERE agent=? AND key=?').bind(c.agentId, key).first()
          assert.equal(recorded.state, 'done')
          assert.equal(JSON.parse(recorded.outcome).result.id, message.result.structuredContent.id)
          upstream = { status: response.status, type: response.headers.get('content-type'), bytes: Buffer.byteLength(raw), sha256: hash(raw), raw, message,
            durable: { state: recorded.state, outcomeSha256: hash(recorded.outcome), decisionId: recorded.decision_id } }
          const partial = Buffer.from(raw).subarray(0, Math.floor(Buffer.byteLength(raw) / 2))
          downstream.writeHead(response.status, { 'Content-Type': upstream.type, 'Content-Length': upstream.bytes, Connection: 'close' })
          downstream.write(partial)
          setTimeout(() => downstream.destroy(), 50)
        } catch (error) { driverError = error; downstream.destroy() }
      })
      await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
      let callerFailure, deliveredBytes = 0
      try {
        const response = await request('http://127.0.0.1:' + proxy.address().port + '/mcp', { method: 'POST', headers, body: wire(name, args, firstId) })
        const reader = response.body.getReader(), delivered = []
        while (true) { const part = await reader.read(); if (part.done) break; delivered.push(Buffer.from(part.value)); deliveredBytes += part.value.length }
        JSON.parse(Buffer.concat(delivered).toString('utf8'))
      } catch (error) { callerFailure = { name: error.name, message: error.message, cause: error.cause?.code || null } }
      finally { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)) }
      if (driverError) throw driverError
      assert.ok(upstream)
      assert.ok(callerFailure, 'the caller must fail to receive a complete result')
      assert.ok(deliveredBytes > 0 && deliveredBytes < upstream.bytes)
      const first = upstream.message.result, draftId = first.structuredContent.id
      const afterDelivery = await state(), savedRows = await snapshot(), sharedAudits = await auditCount()
      const draft = afterDelivery[kind].find(row => row.id === draftId)
      assert.ok(draft)
      assert.equal(draft.status, kind === 'proposals' ? 'proposed' : 'draft')
      assert.equal(afterDelivery[kind].length, before[kind].length + 1)
      assert.deepEqual(afterDelivery.vacancies, before.vacancies)
      assert.deepEqual(afterDelivery.applications, before.applications)
      assert.ok(!afterDelivery.vacancies.some(row => row.title === title))
      assert.notDeepEqual(savedRows, rowsBefore)
      const review = first._meta?.['com.runeditrun/review']
      assert.equal(Boolean(review?.id), phase === 'held')
      const reviewRows = await db.prepare('SELECT id,state FROM agent_door_reviews ORDER BY id').all()
      const preserved = { agent: c.agentId, sponsor: sub, consent: c.consent, client: 'rer-agent-conformance', revision: c.revision,
        policyDigest: hash(c.document), tokenDigest: hash(token), argsDigest: hash(args), keyDigest: hash(key), d1DirectoryDigest: hash(dir) }
      await mf.dispose(); mf = undefined
      await start()
      assert.deepEqual(await snapshot(), savedRows, 'fresh Worker reopened the same native D1 records')
      const retryResponse = await request(origin + '/mcp', { method: 'POST', headers, body: wire(name, args, retryId) })
      assert.equal(retryResponse.status, 200)
      const replayRaw = await retryResponse.text(), replay = JSON.parse(replayRaw)
      assert.equal(replay.id, retryId)
      assert.notEqual(firstId, retryId)
      assert.equal(replay.result?.isError, false)
      assert.deepEqual(semantic(replay.result), semantic(first))
      assert.deepEqual(replay.result._meta?.['com.runeditrun/review'], review)
      const afterRetry = await state(), replayRows = await snapshot()
      assert.deepEqual(afterRetry[kind].find(row => row.id === draftId), draft)
      assert.equal(afterRetry[kind].length, afterDelivery[kind].length)
      assert.deepEqual(replayRows, savedRows, 'all native values and revisions remain unchanged')
      assert.deepEqual((await db.prepare('SELECT id,state FROM agent_door_reviews ORDER BY id').all()).results, reviewRows.results)
      const replayAudit = await db.prepare('SELECT row FROM agent_door_audit ORDER BY sequence DESC LIMIT 1').first()
      assert.equal(JSON.parse(replayAudit.row).replay_of, upstream.durable.decisionId)
      const proof = { phase, tool: name, unchangedIdentity: preserved, originalRpcId: firstId, retryRpcId: retryId,
        upstream, callerFailure, deliveredBytes, restartNumber: restartCount - 1,
        retry: { status: retryResponse.status, raw: replayRaw, message: replay, sha256: hash(replayRaw) },
        draft, countBefore: before[kind].length, countAfterDrop: afterDelivery[kind].length, countAfterRetry: afterRetry[kind].length,
        nativeRecordCount: savedRows.length, nativeRowsSha256: hash(savedRows), retryNativeRowsSha256: hash(replayRows),
        review, reviewRowsSha256: hash(reviewRows.results), sharedAuditCountBeforeRetry: sharedAudits, sharedAuditCountAfterRetry: await auditCount(),
        originalOutcomeReturned: true, unchangedDraft: true, unchangedNativeValuesAndRevisions: true, noSecondDraft: true }
      receipt.cases.push(proof)
      await save('RECEIPT.json', receipt)
      console.log('PROBE BASE-AGENT-012 acceptance-2 ' + phase + ' ' + name + ': complete durable upstream, incomplete downstream, fresh Worker retry -> original draft and review, no second effect')
    }
  }
  assert.equal(receipt.cases.length, 4)
  browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addCookies(owner.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: origin })))
  const page = await context.newPage(); page.setDefaultTimeout(30000)
  const browserErrors = []; page.on('pageerror', error => browserErrors.push(error.message))
  await page.goto(origin + '/app'); await page.getByRole('navigation', { name: 'Workspace' }).waitFor()
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^Proposals/ }).click()
  await page.getByRole('heading', { name: 'Agent proposals', exact: true }).waitFor()
  for (const proof of receipt.cases.filter(item => item.tool === 'lodge.proposals.prepare'))
    await page.getByRole('heading', { name: proof.draft.summary, exact: true }).waitFor()
  const capture = async name => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      const filename = name + '-' + width + '.png'
      await page.screenshot({ path: join(packet, filename), fullPage: true })
      receipt.screens.push({ name, width, filename, sha256: hash(await readFile(join(packet, filename))) })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  await capture('proposal-drafts')
  // Follow the existing pipeline and candidate drawer; no invented display.
    const debrief = receipt.cases.findLast(item => item.tool === 'lodge.debriefs.prepare')
  const native = await state(), application = native.applications.find(row => row.id === debrief.draft.application)
  await page.goto(origin + '/app?application=' + encodeURIComponent(application.id))
  await page.getByRole('tab', { name: 'Scorecards', exact: true }).click()
  await page.getByRole('region', { name: 'Debrief brief', exact: true }).waitFor()
  await capture('debrief-draft')
  await context.close()
  assert.deepEqual(browserErrors, [])
  receipt.browserErrors = browserErrors
  receipt.ok = true; receipt.processExitCodeBeforeCleanup = process.exitCode ?? 0; receipt.completedAt = new Date().toISOString()
  await save('RECEIPT.json', receipt)
  console.log('RESULT 4 lost-response cases passed; existing proposal and debrief screens captured at 1440 and 390')
} catch (error) {
  receipt.ok = false; receipt.failure = { name: error.name, message: error.message, stack: error.stack }
  await save('RECEIPT.json', receipt)
  throw error
} finally { await browser?.close(); await mf?.dispose(); await rm(dir, { recursive: true, force: true }); console.log('DRIVER_CLEANUP processExitCode=' + (process.exitCode ?? 0)) }
