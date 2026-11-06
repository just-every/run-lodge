import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { randomUUID, webcrypto, createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

// One-off qualification; imports the candidate's unmodified public-door harness.
const root = process.cwd(), packet = resolve(process.argv[2] ?? new URL('.', import.meta.url).pathname)
const load = path => import(pathToFileURL(join(root, path)).href)
const { businessHarness } = await load('tests/harness.mjs')
const { default: initializeAgent } = await load('tests/initialize-agent.mjs')
const { default: prepareFixtures } = await load('tests/agent-phase-fixtures.mjs')
const { createProtocol, errorCode, APPROVAL } = await load('src/modules/agent-door/conformance/protocol.mjs')
const { autonomousPolicy, seconds, signJws } = await load('src/modules/agent-door/conformance/crypto.mjs')
const { chromium } = await load('node_modules/@playwright/test/index.mjs')
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const receipt = { schema: 1, tag: 'sx-lodge-c-f48', head, started: new Date().toISOString(), cases: [], screens: [], failures: [] }
const surface = JSON.parse(await readFile('agent-surface.json', 'utf8'))
const ring = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const kid = randomUUID(), issuer = 'https://synthetic-lodge-48.invalid', installationId = randomUUID()
const publicKeys = { [kid]: await webcrypto.subtle.exportKey('jwk', ring.publicKey) }
const h = await businessHarness({ bindings: {
  RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId,
  RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify(publicKeys),
} })
let browser
const redact = value => JSON.parse(JSON.stringify(value).replace(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, '[synthetic address omitted]'))
try {
  const request = (url, init = {}) => h.mf.dispatchFetch(url, init)
  const ownerRequest = async (url, init = {}) => {
    const headers = new Headers(init.headers)
    headers.set('Origin', h.origin); headers.set('Cookie', h.owner)
    const response = await request(url, { ...init, headers: Object.fromEntries(headers) })
    assert.ok(response.ok, 'native fixture ' + new URL(url).pathname + ': HTTP ' + response.status)
    return response
  }
  const session = await h.send('/auth/session', undefined, h.owner)
  const email = session.value.operator.email, sub = randomUUID(), iat = seconds()
  const settings = await signJws(ring.privateKey, kid, 'rer-business-settings+jwt', {
    v: 1, iss: issuer, aud: h.origin, sub: installationId, business: 'synthetic-lodge-48',
    email, owner_id: sub, jti: randomUUID(), iat, exp: iat + 300, rev: 1,
    values: {}, logo: null, team: null,
  })
  assert.equal((await h.send('/api/rer/business-settings', { settings })).status, 200)
  const c = createProtocol({ fetch: request, origin: h.origin, surface, points: [],
    signer: { issuer, installationId, kid, privateKey: ring.privateKey },
    person: { email, sub, cookie: h.owner }, business: 'synthetic-lodge-48',
    agentId: randomUUID(), consent: randomUUID(), seq: 0, revision: 0,
  })
  await initializeAgent({ agentId: c.agentId, request: ownerRequest, origin: h.origin, email })
  await c.adopt(autonomousPolicy())
  const fixtures = await prepareFixtures({ request: ownerRequest, origin: h.origin, cookie: h.owner, email, phase: 'autonomous' })
  c.fixtureValues = fixtures.values
  const native = await h.state()
  const app = native.applications.find(row => row.id === fixtures.values.debrief.application)
  assert.equal((await c.mcp('tools/list')).status, 200)
  const inventory = await c.personJson('/agents/api/agents')
  c.sponsor.id = inventory.agents.find(agent => agent.id === c.agentId).sponsor.id
  const snapshot = async () => (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
  const hash = data => createHash('sha256').update(JSON.stringify(data)).digest('hex')
  const facts = name => [{ class: 'standard', facts: { measure: name === 'lodge.jobs.list' ? native.vacancies.length : 1 } }]
  const argsFor = step => {
    const args = c.resolve(step.args)
    if (!surface.tools.find(tool => tool.name === step.tool).readOnly) args.idempotency_key = randomUUID()
    if (step.tool === 'lodge.debriefs.prepare') {
      const row = (native.applications.find(row => row.id === args.application))
      assert.ok(row)
      // Capture the revision from the native inventory, before holding the call.
    }
    return args
  }
  const computed = answer => answer.decision?.classes.map(({ class: cls, facts }) => ({ class: cls, facts }))
  const policy = doWhat => ({ ...autonomousPolicy(), rules: [{ id: 'standard-' + doWhat, class: 'standard', do: doWhat,
    ...(doWhat === 'approval' ? { approver: ['sponsor'], wait: 'PT1H' } : {}) }] })

  await c.adopt(policy('blocked'))
  for (const step of surface.journey) {
    const args = argsFor(step), before = await snapshot(), answer = await c.tool(step.tool, args)
    assert.equal(errorCode(answer), 'policy_blocked', step.tool)
    assert.equal(answer.decision.disposition, 'blocked')
    assert.equal(answer.decision.revision, c.revision)
    assert.deepEqual(computed(answer), facts(step.tool))
    assert.deepEqual(answer.result._meta['com.runeditrun/error'], { code: 'policy_blocked', class: 'standard', rule: 'standard-blocked', revision: c.revision })
    assert.equal(answer.result.structuredContent, undefined)
    assert.deepEqual(JSON.parse(answer.result.content[0].text), { code: 'policy_blocked', class: 'standard', rule: 'standard-blocked', revision: c.revision })
    assert.deepEqual(await snapshot(), before, step.tool + ' blocked changed native records')
    receipt.cases.push({ tool: step.tool, path: 'blocked', status: 'pass', revision: c.revision,
      facts: computed(answer), code: errorCode(answer), before: hash(before), after: hash(await snapshot()), nativeContent: false })
    console.log('PROBE BASE-AGENT-007 blocked ' + step.tool + ': /mcp -> policy_blocked, current facts, no native content or effect')
  }

  await c.adopt(policy('approval'))
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
  const contexts = []
  const approvalPages = new Map()
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } })
    contexts.push(context)
    const page = await context.newPage()
    page.on('pageerror', error => (receipt.browserDiagnostics ??= []).push({ browser: width, pageError: error.message }))
    page.on('console', message => { if (message.type() === 'error') (receipt.browserDiagnostics ??= []).push({ browser: width, console: message.text() }) })
    await page.route('**/*', async route => {
      const incoming = route.request(), url = new URL(incoming.url())
      if (url.origin !== h.origin) return route.abort()
      const nativeHeaders = new Headers(incoming.headers())
      nativeHeaders.set('Origin', h.origin); nativeHeaders.set('Cookie', h.owner)
      const response = await request(url.href, { method: incoming.method(), headers: Object.fromEntries(nativeHeaders), body: incoming.postDataBuffer() ?? undefined })
      if (url.pathname.endsWith('/approve')) receipt.browserDecision = {status: response.status, body: await response.clone().json()}
      const headers = Object.fromEntries(response.headers)
      for (const name of ['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie']) delete headers[name]
      await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) })
    })
    approvalPages.set(width, page)
  }
  const screen = async (page, width, name) => {
    const filename = name + '-' + width + '.png'
    await page.screenshot({ path: join(packet, filename), fullPage: true })
    receipt.screens.push({ file: filename, width, path: new URL(page.url()).pathname,
      horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) })
  }
  const saved = []
  for (const step of surface.journey) {
    const args = argsFor(step)
    if (step.tool === 'lodge.debriefs.prepare') {
      const inv = await c.personJson('/api/lodge/state')
      const dbRow = await h.db.prepare('SELECT revision FROM l_records WHERE kind=? AND id=?').bind('application', args.application).first()
      assert.ok(inv.applications.some(row => row.id === args.application))
      args.expected_revision = dbRow.revision
    }
    const before = await snapshot(), pending = await c.tool(step.tool, args)
    assert.equal(pending.status, 200, step.tool + ' pending status')
    assert.equal(pending.result?.resultType, 'input_required', step.tool + ' pending: ' + JSON.stringify(pending.body))
    assert.equal(pending.result.content, undefined)
    assert.equal(pending.result.structuredContent, undefined)
    assert.equal(pending.decision.disposition, 'approval')
    assert.equal(pending.decision.revision, c.revision)
    assert.deepEqual(computed(pending), facts(step.tool))
    const handle = pending.result._meta[APPROVAL], requestState = pending.result.requestState
    assert.ok(handle.id && requestState)
    assert.equal(new URL(handle.url).origin, h.origin)
    assert.equal(new URL(handle.url).pathname, '/agents/approvals/' + handle.id)
    assert.equal(pending.result.inputRequests.approval.method, 'elicitation/create')
    assert.equal(pending.result.inputRequests.approval.params.mode, 'url')
    assert.equal(pending.result.inputRequests.approval.params.url, handle.url)
    const { approval } = await c.personJson('/agents/api/approvals/' + handle.id)
    assert.equal(approval.revision, c.revision)
    assert.equal(approval.decision_id, pending.decision.id)
    assert.equal(approval.state, 'pending')
    assert.deepEqual(approval.classes, facts(step.tool))
    assert.deepEqual(approval.approvers, ['sponsor'])
    assert.match(approval.summary_sha256, /^[a-f0-9]{64}$/)
    assert.ok(Date.parse(approval.expires_at) > Date.now())
    assert.deepEqual(await snapshot(), before, step.tool + ' pending changed native records')
    for (const [width, page] of approvalPages) {
      await page.goto(handle.url)
      await page.locator('[data-approval-state="pending"]').waitFor()
      if (width === 1440) {
        await page.getByText('Details', { exact: true }).click()
        assert.ok((await page.locator('body').innerText()).includes('Policy version'))
        assert.ok((await page.locator('body').innerText()).includes(String(c.revision)))
      }
      await screen(page, width, step.id + '-pending')
    }
    const page = approvalPages.get(1440)
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    try { await page.locator('[data-approval-state="executed"]').waitFor({ timeout: 15000 }) }
    catch (error) { receipt.browserAfterClick = await page.locator('body').innerText(); receipt.approvalAfterClick = await c.personJson('/agents/api/approvals/' + handle.id); throw error }
    const final = (await c.personJson('/agents/api/approvals/' + handle.id)).approval
    assert.equal(final.state, 'executed', step.tool + ' sponsor execution')
    assert.ok(final.approvals.some(mark => mark.person === c.sponsor.id && mark.ref === 'sponsor'))
    const answer = await c.tool(step.tool, args, { requestState })
    assert.equal(answer.result?.isError, false, step.tool + ' completed retry: ' + JSON.stringify(answer.body))
    assert.equal(answer.result.resultType, 'complete')
    assert.ok(answer.result.structuredContent)
    const linked = answer.result._meta['com.runeditrun/receipt']
    assert.equal(linked.approval_id, handle.id)
    assert.equal(linked.decision_id, pending.decision.id)
    assert.deepEqual(linked.approved_by, [c.sponsor.id])
    assert.deepEqual(computed(answer), facts(step.tool))
    const state = await h.state()
    if (step.id === 'jobs') assert.ok(answer.result.structuredContent.jobs.some(row => row.id === fixtures.values.job.id))
    if (step.id === 'source') assert.equal(answer.result.structuredContent.record.id, fixtures.values.job.id)
    if (step.id === 'drafts') assert.ok(answer.result.structuredContent.records.some(row => row.id === app.id))
    if (step.id === 'proposal') {
      const draft = state.proposals.find(row => row.id === answer.result.structuredContent.id)
      assert.equal(draft.status, 'proposed')
      assert.equal(state.proposals.length, native.proposals.length + 1)
      assert.equal(state.vacancies.length, native.vacancies.length)
    }
    if (step.id === 'debrief') {
      assert.equal(state.debriefs.find(row => row.id === answer.result.structuredContent.id).status, 'draft')
      assert.equal(state.debriefs.length, native.debriefs.length + 1)
      assert.deepEqual(state.applications.find(row => row.id === app.id), app)
    }
    const once = await snapshot(), repeat = await c.tool(step.tool, args, { requestState })
    assert.equal(repeat.result?.isError, false)
    assert.deepEqual(repeat.result.structuredContent, answer.result.structuredContent)
    assert.equal(repeat.result._meta['com.runeditrun/receipt'].id, linked.id)
    assert.deepEqual(await snapshot(), once, step.tool + ' replay duplicated native effect')
    for (const [width, p] of approvalPages) {
      await p.goto(handle.url)
      await p.locator('[data-approval-state="executed"]').waitFor()
      await screen(p, width, step.id + '-executed')
    }
    receipt.cases.push({ tool: step.tool, path: 'approval', status: 'pass', revision: c.revision,
      decision: pending.decision, approvalId: handle.id, expiry: approval.expires_at,
      summarySha256: approval.summary_sha256, facts: computed(pending), nativeContentWhilePending: false,
      pendingBefore: hash(before), pendingAfter: hash(before), receipt: linked,
      resultKeys: Object.keys(answer.result.structuredContent), repeatNativeEffect: false,
      nativeDraftStatus: step.id === 'proposal' ? 'proposed' : step.id === 'debrief' ? 'draft' : null })
    saved.push({ step, args, requestState, answer })
    console.log('PROBE BASE-AGENT-007 approval ' + step.tool + ': /mcp -> pending, sponsor browser approval, native result and linked receipt, repeat adds no effect')
  }
  await h.restart()
  for (const { step, args, requestState, answer } of saved) {
    const before = await snapshot(), again = await c.tool(step.tool, args, { requestState })
    assert.equal(again.result?.isError, false, step.tool + ' restart replay')
    // The inventory is a fresh scoped read, so new drafts may now be visible.
    if (step.id !== 'drafts') assert.deepEqual(again.result.structuredContent, answer.result.structuredContent)
    assert.equal(again.result._meta['com.runeditrun/receipt'].id, answer.result._meta['com.runeditrun/receipt'].id)
    assert.deepEqual(await snapshot(), before)
  }
  receipt.restartReplay = 'pass'
  assert.ok(c.points.every(point => point.ok), JSON.stringify(c.points.filter(point => !point.ok)))
  receipt.protocolPoints = c.points
  // Preserve drafts for native-screen inspection in a separate optional pass.
  if (process.env.LODGE_NATIVE_ORIGIN) {
    const origin = process.env.LODGE_NATIVE_ORIGIN
    const { readDevKey, signInAs } = await load('src/modules/operator-auth/dev/sign-in-as.mjs')
    const login = await signInAs({ origin, key: await readDevKey(root), as: 'owner', returnTo: '/app' })
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } })
      try {
        await context.addCookies(login.cookies.map(cookie => ({ ...cookie, url: origin })))
        const page = await context.newPage()
        await page.route('**/api/lodge/**', async route => {
          const incoming = route.request(), url = new URL(incoming.url())
          const response = await ownerRequest(h.origin + url.pathname + url.search, { method: incoming.method(), headers: incoming.headers(), body: incoming.postDataBuffer() ?? undefined })
          const headers = Object.fromEntries(response.headers)
          for (const key of ['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie']) delete headers[key]
          await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) })
        })
        await page.goto(origin + '/app')
        if (new URL(page.url()).pathname === '/setup') {
          await page.getByRole('checkbox').check()
          await page.getByRole('button', { name: 'Finish setup' }).click()
        }
        const proposals = page.getByRole('button', { name: /^Proposals/ }).first()
        await proposals.click()
        await page.getByRole('heading', { name: 'Agent proposals', exact: true }).waitFor()
        await page.getByRole('button', { name: 'Record decision', exact: true }).waitFor()
        await screen(page, width, 'native-proposal-draft')
        await page.goto(origin + '/app?application=' + app.id)
        await page.getByRole('tab', { name: 'Scorecards', exact: true }).click()
        await page.getByRole('heading', { name: 'Debrief brief', exact: true }).waitFor()
        await page.getByRole('button', { name: 'Keep this brief', exact: true }).waitFor()
        await screen(page, width, 'native-debrief-draft')
      } finally { await context.close() }
    }
    receipt.nativeScreens = 'pass; real app assets with native Worker transport routed to disposable signed Business fixture'
  }
  const proposal = saved.find(row => row.step.id === 'proposal').answer.result.structuredContent.id
  const brief = saved.find(row => row.step.id === 'debrief').answer.result.structuredContent.id
  await h.command('decide-proposal', { id: proposal, decision: 'approved', reason: 'Human reviewed the exact proposed vacancy' })
  assert.equal((await h.state()).vacancies.length, native.vacancies.length + 1)
  await h.command('decide-debrief', { id: brief, decision: 'keep' })
  assert.equal((await h.state()).debriefs.find(row => row.id === brief).status, 'kept')
  receipt.separateNativeDecisions = 'pass; proposal applied and debrief kept only after separate human native commands'
  receipt.status = 'pass'
} catch (error) {
  receipt.status = 'fail'
  receipt.failures.push({ name: error.name, message: String(error.message).slice(0, 4000), stack: String(error.stack).split('\n').slice(0, 6) })
  process.exitCode = 1
} finally {
  await browser?.close()
  await h.close()
  receipt.completed = new Date().toISOString()
  await mkdir(packet, { recursive: true })
  await writeFile(join(packet, 'qualification-receipt.json'), JSON.stringify(redact(receipt), null, 2) + '\n')
  console.log(JSON.stringify(redact({ status: receipt.status, head, cases: receipt.cases.length, failures: receipt.failures })))
}
