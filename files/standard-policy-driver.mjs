import assert from 'node:assert/strict'
import { randomUUID, webcrypto, createHash } from 'node:crypto'
import { readFile, readdir, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { execFileSync } from 'node:child_process'

// One-off qualification only. All credentials are disposable, generated in memory,
// and excluded from the receipt. No provider or deployed Business is contacted.
const root = resolve(process.argv[2]), packet = resolve(process.argv[3])
process.chdir(root)
const require = createRequire(join(root, 'package.json'))
const dep = name => import(pathToFileURL(require.resolve(name)).href)
const from = path => import(pathToFileURL(join(root, path)).href)
const { Miniflare, convertV4MiniflareOptions } = await dep('miniflare')
const { unstable_splitSqlQuery } = await dep('wrangler')
const { chromium } = require('@playwright/test')
const { createProtocol, errorCode, APPROVAL } = await from('src/modules/agent-door/conformance/protocol.mjs')
const { autonomousPolicy, seconds, signJws } = await from('src/modules/agent-door/conformance/crypto.mjs')
const { default: initializeAgent } = await from('tests/initialize-agent.mjs')
const { default: prepareFixtures } = await from('tests/agent-phase-fixtures.mjs')
const { BUSINESS } = await from('tests/harness.mjs')
const surface = JSON.parse(await readFile('agent-surface.json', 'utf8'))
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const receipt = { schema: 1, tag: 'sx-lodge-c-f52', head, runtime: 'built production Worker and D1', started: new Date().toISOString(), policy: [], screens: [], assertions: [] }
const note = (id, data = {}) => { receipt.assertions.push({ id, pass: true, ...data }); console.log('PASS ' + id) }
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const socket = createServer()
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
const port = socket.address().port
await new Promise(resolve => socket.close(resolve))
const origin = 'http://127.0.0.1:' + port
const directory = await mkdtemp(join(tmpdir(), 'lodge-f52-'))
const ring = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const kid = randomUUID(), issuer = 'https://synthetic-lodge-52.invalid', installationId = randomUUID()
const publicKeys = { [kid]: await webcrypto.subtle.exportKey('jwk', ring.publicKey) }
const email = ['synthetic-lodge-52', 'example.invalid'].join(String.fromCharCode(64))
const setupToken = 'synthetic-lodge-52-setup-' + randomUUID()
let outboundCalls = 0
const options = convertV4MiniflareOptions({ host: '127.0.0.1', port, cf: false,
  modules: [{ type: 'ESModule', path: join(root, 'dist/server/index.js') },
    ...(await readdir('dist/server/assets')).filter(f => /\.m?js$/.test(f)).map(f => ({ type: 'ESModule', path: join(root, 'dist/server/assets', f) }))], modulesRoot: join(root, 'dist/server'),
  compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
  outboundService: () => { outboundCalls++; return new Response('Synthetic outbound refusal', { status: 503 }) },
  d1Databases: { DB: 'lodge' }, assets: { directory: join(root, 'dist/client'), binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true } },
  bindings: { AUTH_ORIGIN: origin, AUTH_LOCAL: 'true', OWNER_EMAIL: email,
    SESSION_SECRET: 'synthetic-lodge-52-session-' + randomUUID(), SETUP_TOKEN: setupToken,
    MAIL_PROVIDER: 'development', MAIL_FROM: email,
    RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId,
    RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify(publicKeys) },
})
options.resourcePersistencePath = directory
const mf = new Miniflare(options)
let browser
try {
  const db = await mf.getD1Database('DB')
  for (const file of (await readdir('migrations/core')).filter(f => f.endsWith('.sql')).sort())
    await db.batch(unstable_splitSqlQuery(await readFile('migrations/core/' + file, 'utf8')).map(sql => db.prepare(sql)))
  const request = (url, init = {}) => mf.dispatchFetch(url, { redirect: 'manual', ...init })
  const boot = await request(origin + '/auth/bootstrap', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: setupToken, displayName: 'Synthetic owner' }) })
  assert.ok(boot.status < 400, 'owner bootstrap HTTP ' + boot.status + ' ' + (boot.status < 400 ? '' : (await boot.text()).split(email).join('<synthetic address>').split(setupToken).join('<setup token>')))
  const cookie = boot.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  assert.ok(cookie)
  const ownerRequest = (url, init = {}) => {
    const headers = new Headers(init.headers); headers.set('Origin', origin); headers.set('Cookie', cookie)
    return request(url, { ...init, headers: Object.fromEntries(headers) })
  }
  const json = async path => {
    const r = await ownerRequest(origin + path)
    assert.equal(r.status, 200, path + ' HTTP ' + r.status)
    return r.json()
  }
  const command = async (op, value) => {
    const r = await ownerRequest(origin + '/api/lodge/command/' + op, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
    assert.equal(r.status, 200, op + ' HTTP ' + r.status + ' ' + (r.ok ? '' : await r.text()))
    return r.json()
  }
  const state = () => json('/api/lodge/state')
  await command('business', { ...BUSINESS, name: 'Synthetic Lodge qualification', accommodationContact: email })
  const setup = await ownerRequest(origin + '/setup', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ confirm: 'yes', displayName: 'Synthetic owner' }) })
  assert.equal(setup.status, 303)
  const sub = randomUUID(), iat = seconds()
  const settings = await signJws(ring.privateKey, kid, 'rer-business-settings+jwt', { v: 1, iss: issuer, aud: origin,
    sub: installationId, business: 'synthetic-lodge-52', email, owner_id: sub, jti: randomUUID(), iat, exp: iat + 7200,
    rev: 1, values: {}, logo: null, team: null })
  const adopted = await ownerRequest(origin + '/api/rer/business-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings }) })
  assert.equal(adopted.status, 200)
  const c = createProtocol({ fetch: request, origin, surface, points: [], signer: { issuer, installationId, kid, privateKey: ring.privateKey },
    person: { email, sub, cookie }, business: 'synthetic-lodge-52', agentId: randomUUID(), consent: randomUUID(), seq: 0, revision: 0 })
  await initializeAgent({ agentId: c.agentId, request: ownerRequest, origin, email })
  await c.adopt(autonomousPolicy())
  const fixtures = await prepareFixtures({ request: ownerRequest, origin, cookie, email, phase: 'autonomous' })
  c.fixtureValues = fixtures.values
  const originalSources = await c.tool('lodge.proposals.list', {})
  const applicationRevision = originalSources.result.structuredContent.records.find(r => r.kind === 'application' && r.id === fixtures.values.debrief.application).revision
  assert.equal((await c.mcp('tools/list')).status, 200)
  const inventory = await json('/agents/api/agents')
  c.sponsor.id = inventory.agents.find(a => a.id === c.agentId).sponsor.id
  const originalApplication = (await state()).applications.find(a => a.id === fixtures.values.debrief.application)
  const snapshot = async () => (await db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
  const policy = disposition => ({ schema: 'rer-agent-policy/1', catalogue: 'rer-agent-classes/1',
    rules: [{ id: 'standard-' + disposition, class: 'standard', do: disposition,
      ...(disposition === 'approval' ? { approver: ['sponsor'], wait: 'PT1H' } : {}) }], spend: { none: true } })
  const argsFor = step => {
    const args = c.resolve(step.args)
    if (step.tool === 'lodge.debriefs.prepare') args.expected_revision = applicationRevision
    if (!surface.tools.find(t => t.name === step.tool).readOnly) args.idempotency_key = randomUUID()
    return args
  }
  const decision = (answer, disposition, measure) => {
    assert.equal(answer.decision.disposition, disposition)
    assert.equal(answer.decision.revision, c.revision)
    assert.equal(answer.decision.classes.length, 1)
    const cls = answer.decision.classes[0]
    assert.equal(cls.class, 'standard'); assert.equal(cls.do, disposition)
    assert.equal(cls.rule, 'standard-' + disposition); assert.equal(cls.facts.measure, measure)
  }
  await c.adopt(policy('blocked'))
  for (const step of surface.journey) {
    const args = argsFor(step), before = await snapshot()
    const answer = await c.tool(step.tool, args)
    decision(answer, 'blocked', step.tool === 'lodge.jobs.list' ? (await state()).vacancies.length : 1)
    assert.equal(errorCode(answer), 'policy_blocked')
    assert.equal(answer.result.structuredContent, undefined)
    const content = JSON.parse(answer.result.content[0].text)
    assert.deepEqual(content, { code: 'policy_blocked', class: 'standard', rule: 'standard-blocked', revision: c.revision })
    assert.deepEqual(await snapshot(), before)
    receipt.policy.push({ tool: step.tool, disposition: 'blocked', revision: c.revision, facts: answer.decision.classes[0].facts,
      noContent: true, noNativeEffect: true, beforeDigest: hash(before), afterDigest: hash(await snapshot()) })
    note(step.id + '.blocked')
  }
  // Current computed facts must change with the native job collection, not the prompt.
  await command('vacancy', { title: 'Synthetic current-facts vacancy', location: 'Brooklyn, NY', headcount: 1, manager: email, description: 'Synthetic estimation work.' })
  const beforeCurrent = await snapshot(), updated = await c.tool('lodge.jobs.list', {})
  decision(updated, 'blocked', (await state()).vacancies.length)
  assert.equal(updated.decision.classes[0].facts.measure, 2)
  assert.deepEqual(await snapshot(), beforeCurrent)
  note('jobs.blocked-current-facts', { measure: 2 })

  await c.adopt(policy('approval'))
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
  const browserContext = async width => {
    const context = await browser.newContext({ viewport: { width, height: 1000 } })
    await context.route('**/*', async route => {
      const incoming = route.request(), url = new URL(incoming.url())
      if (url.origin !== origin) return route.abort()
      const response = await ownerRequest(url.href, { method: incoming.method(), headers: { ...incoming.headers(), Origin: origin, Cookie: cookie }, body: incoming.postDataBuffer() ?? undefined })
      const headers = Object.fromEntries(response.headers)
      for (const name of ['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie']) delete headers[name]
      await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) })
    })
    return context
  }
  const screenshot = async (page, name, width) => {
    await page.screenshot({ path: join(packet, name + '-' + width + '.png'), fullPage: true,
      mask: [page.locator('input[type=email]'), page.locator('pre:visible').filter({ hasText: String.fromCharCode(64) }), page.locator('p.target').filter({ hasText: String.fromCharCode(64) })] })
    receipt.screens.push({ name, width, file: name + '-' + width + '.png' })
  }
  const completed = new Map()
  for (const step of surface.journey) {
    const args = argsFor(step), before = await snapshot()
    const pending = await c.tool(step.tool, args)
    assert.equal(pending.status, 200)
    decision(pending, 'approval', step.tool === 'lodge.jobs.list' ? (await state()).vacancies.length : 1)
    assert.equal(pending.result.resultType, 'input_required')
    assert.equal(pending.result.structuredContent, undefined); assert.equal(pending.result.content, undefined)
    assert.equal(typeof pending.result.requestState, 'string')
    const handle = pending.result._meta[APPROVAL], url = new URL(handle.url)
    assert.equal(url.origin, origin)
    assert.equal(url.pathname, '/agents/approvals/' + handle.id)
    assert.equal(pending.result.inputRequests.approval.params.mode, 'url')
    assert.equal(pending.result.inputRequests.approval.params.url, handle.url)
    assert.deepEqual(await snapshot(), before)
    const approval = (await json('/agents/api/approvals/' + handle.id)).approval
    assert.equal(approval.state, 'pending'); assert.equal(approval.revision, c.revision)
    assert.equal(approval.decision_id, pending.decision.id); assert.equal(approval.tool, step.tool)
    assert.deepEqual(approval.approvers, ['sponsor'])
    assert.match(approval.summary_sha256, /^[a-f0-9]{64}$/)
    assert.ok(Date.parse(approval.expires_at) > Date.now())
    assert.equal(approval.classes[0].facts.measure, pending.decision.classes[0].facts.measure)
    // Showing the actual pending page at each width precedes the one browser decision.
    for (const width of [1440, 390]) {
      const context = await browserContext(width)
      try {
        const page = await context.newPage(); await page.goto(handle.url)
        await page.locator('[data-approval-state="pending"]').waitFor()
        assert.equal(await page.locator('input[name=revision]').first().inputValue(), String(c.revision))
        assert.equal(await page.locator('input[name=summary_sha256]').first().inputValue(), approval.summary_sha256)
        if (width === 1440) assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        await screenshot(page, step.id + '-pending', width)
        if (width === 390) {
          const responsePromise = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/' + handle.id + '/approve'))
          await page.getByRole('button', { name: 'Approve', exact: true }).click()
          const approved = await responsePromise
          assert.equal(approved.status(), 200)
          assert.equal((await json('/agents/api/approvals/' + handle.id)).approval.state, 'executed')
          await page.locator('[data-approval-state="executed"]').waitFor()
        }
      } finally { await context.close() }
    }
    const afterHuman = await snapshot()
    const result = await c.tool(step.tool, args, { requestState: pending.result.requestState })
    assert.equal(result.result.isError, false)
    assert.ok(result.result.structuredContent)
    const linked = result.result._meta['com.runeditrun/receipt']
    assert.equal(linked.decision_id, pending.decision.id); assert.equal(linked.approval_id, handle.id)
    assert.deepEqual(linked.approved_by, [c.sponsor.id])
    assert.deepEqual(await snapshot(), afterHuman, 'retry returns the native result without a second native write')
    const replay = await c.tool(step.tool, args, { requestState: pending.result.requestState })
    assert.equal(replay.result.isError, false)
    assert.deepEqual(replay.result.structuredContent, result.result.structuredContent)
    assert.equal(replay.result._meta['com.runeditrun/receipt'].id, linked.id)
    assert.deepEqual(await snapshot(), afterHuman)
    const secondDecision = await c.decideApproval(pending)
    assert.equal(secondDecision.body.approval.state, 'executed')
    assert.deepEqual(await snapshot(), afterHuman)
    const audit = (await db.prepare('SELECT row FROM agent_door_audit').all()).results.map(r => JSON.parse(r.row))
    assert.equal(audit.filter(r => r.tool === step.tool && r.approval?.id === handle.id && r.outcome === 'done').length, 1)
    if (step.tool === 'lodge.jobs.list') assert.deepEqual(result.result.structuredContent.jobs.map(j => j.id).sort(), (await state()).vacancies.map(j => j.id).sort())
    if (step.tool === 'lodge.records.read') {
      const nativeJob = (await state()).vacancies.find(j => j.id === fixtures.values.job.id)
      assert.equal(result.result.structuredContent.record.id, nativeJob.id)
      assert.equal(result.result.structuredContent.record.title, nativeJob.title)
      assert.equal(result.result.structuredContent.record.description, nativeJob.description)
    }
    if (step.tool === 'lodge.proposals.list') assert.ok(result.result.structuredContent.records.some(r => r.id === fixtures.values.debrief.application))
    completed.set(step.id, result.result.structuredContent)
    receipt.policy.push({ tool: step.tool, disposition: 'approval', revision: c.revision, facts: pending.decision.classes[0].facts,
      pendingNoContent: true, pendingNoNativeEffect: true, sameOriginHumanUrl: true, exactRevisionBrowserDecision: true,
      receiptLinked: true, nativeExecutions: 1, replayNoNativeEffect: true, repeatedDecisionNoNativeEffect: true,
      beforeDigest: hash(before), afterDecisionDigest: hash(afterHuman) })
    note(step.id + '.approval-and-replay')
  }
  const proposalId = completed.get('proposal').id, briefId = completed.get('debrief').id
  const drafts = await state(), application = drafts.applications.find(a => a.id === fixtures.values.debrief.application)
  assert.equal(drafts.proposals.find(p => p.id === proposalId).status, 'proposed')
  assert.equal(drafts.debriefs.find(b => b.id === briefId).status, 'draft')
  assert.deepEqual(application, originalApplication, 'tool preparation changes no native application decision')
  assert.ok(!drafts.vacancies.some(j => j.title === 'Estimator'))
  const beforeRefusal = await snapshot()
  for (const name of ['lodge.proposals.apply', 'lodge.debriefs.keep']) assert.equal(errorCode(await c.tool(name, { id: name.includes('proposals') ? proposalId : briefId })), 'tool_not_found')
  assert.deepEqual(await snapshot(), beforeRefusal)
  note('preparations.require-separate-native-human-decisions')
  for (const width of [1440, 390]) {
    const context = await browserContext(width)
    try {
      const page = await context.newPage()
      await page.goto(origin + '/app')
      await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /Proposals/ }).click()
      await page.getByRole('heading', { name: 'Agent proposals', exact: true }).waitFor()
      await page.getByRole('heading', { name: 'Prepare an estimator vacancy for human review', exact: true }).waitFor()
      await screenshot(page, 'native-proposal-draft', width)
      await page.goto(origin + '/app?application=' + application.id)
      await page.getByRole('tab', { name: 'Scorecards', exact: true }).click()
      await page.getByRole('heading', { name: 'Debrief brief', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Keep this brief', exact: true }).waitFor()
      await screenshot(page, 'native-debrief-draft', width)
    } finally { await context.close() }
  }
  await command('decide-proposal', { id: proposalId, decision: 'approved', reason: 'The owner reviewed this exact native vacancy draft.' })
  assert.equal((await state()).proposals.find(p => p.id === proposalId).status, 'applied')
  assert.equal((await state()).vacancies.filter(j => j.title === 'Estimator').length, 1)
  await command('decide-debrief', { id: briefId, decision: 'keep' })
  const decided = await state()
  assert.equal(decided.debriefs.find(b => b.id === briefId).status, 'kept')
  assert.deepEqual(decided.applications.find(a => a.id === application.id), application)
  note('native-human-decisions.complete-with-unchanged-application')
  assert.ok(c.points.every(p => p.ok), 'signed adoption assertions')
  assert.equal(outboundCalls, 0, 'no provider calls')
  receipt.outboundCalls = outboundCalls
  receipt.status = 'passed'; receipt.finished = new Date().toISOString()
} catch (error) {
  receipt.status = 'failed'; receipt.failure = { name: error.name, message: String(error.message).split(email).join('<synthetic address>') }
  throw error
} finally {
  await browser?.close()
  await mf.dispose()
  await rm(directory, { recursive: true, force: true })
  await mkdir(packet, { recursive: true })
  await writeFile(join(packet, 'standard-policy-receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
}
