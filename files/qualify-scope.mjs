import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { randomUUID, webcrypto, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = process.cwd(), packet = resolve(process.argv[2])
const load = path => import(pathToFileURL(join(root, path)).href)
const { createProtocol, errorCode } = await load('src/modules/agent-door/conformance/protocol.mjs')
const { autonomousPolicy, heldPolicy, seconds, signJws, accessToken } = await load('src/modules/agent-door/conformance/crypto.mjs')
const { default: initializeAgent } = await load('tests/initialize-agent.mjs')
const { default: prepareFixtures } = await load('tests/agent-phase-fixtures.mjs')
const require = createRequire(join(root, 'package.json'))
const { chromium } = require('@playwright/test')
const { iconTooltips } = await load('tests/icon-tooltips.mjs')
await mkdir(packet, { recursive: true })
const scratch = join(root, '.cache/sx-lodge-c-f61')
await mkdir(scratch, { recursive: true })
// Keep the existing migrations, owner bootstrap, native fixtures and D1 helper.
// Run its requests against the emitted production Worker and its actual assets.
const source = await readFile(join(root, 'tests/harness.mjs'), 'utf8')
const original = "modules: true, script: bundle.outputFiles[0].text"
assert.equal(source.split(original).length, 2)
let adapted = source.replace(original, "name: 'lodge-scope-qualification', modules: ['index.js', ...(await readdir('dist/server/assets')).filter(name => /\\.(?:js|mjs)$/.test(name)).map(name => 'assets/' + name)].map(name => ({ type: 'ESModule', path: join(process.cwd(), 'dist/server', name) })), modulesRoot: join(process.cwd(), 'dist/server'), assets: { directory: join(process.cwd(), 'dist/client'), binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true } }")
adapted = adapted.replace("const owner = claim ? (await send('/auth/bootstrap', { token: SETUP_TOKEN, displayName: 'Olive Owner' })).cookie : null", "const bootstrap = claim ? await send('/auth/bootstrap', { token: SETUP_TOKEN, displayName: 'Olive Owner' }) : null; const owner = bootstrap?.cookie; if (claim && !owner) throw new Error('Bootstrap HTTP ' + bootstrap.status + ' ' + JSON.stringify(bootstrap.value))")
await writeFile(join(scratch, 'harness-built.mjs'), adapted)
const { businessHarness } = await import(pathToFileURL(join(scratch, 'harness-built.mjs')).href)
const surface = JSON.parse(await readFile('agent-surface.json', 'utf8'))
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const receipt = { schema: 1, tag: 'sx-lodge-c-f61', clause: 'BASE-AGENT-005',
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
  runtime: 'emitted production Worker with persistent disposable D1 and built client assets',
  scope: 'existing action-scope and caller-argument widening slice of acceptance 2',
  sourceDirectory: execFileSync('git', ['rev-parse', 'HEAD:src'], { encoding: 'utf8' }).trim(),
  testsDirectory: execFileSync('git', ['rev-parse', 'HEAD:tests'], { encoding: 'utf8' }).trim(),
  emittedWorkerSha256: createHash('sha256').update(await readFile('dist/server/index.js')).digest('hex'),
  driverSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
  result: 'running', policies: [], browser: [], outboundCalls: 0 }
let h, browser
try {
  const ring = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const kid = randomUUID(), issuer = 'https://synthetic-lodge-61.invalid', installationId = randomUUID()
  const publicKeys = { [kid]: await webcrypto.subtle.exportKey('jwk', ring.publicKey) }
  h = await businessHarness({ bindings: {
    RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId,
    RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify(publicKeys),
  }, outboundService: () => { receipt.outboundCalls++; return new Response('Unexpected provider call refused', { status: 503 }) } })
  const request = (url, init = {}) => h.mf.dispatchFetch(url, init)
  const ownerRequest = async (url, init = {}) => {
    const headers = new Headers(init.headers)
    headers.set('Origin', h.origin); headers.set('Cookie', h.owner)
    const response = await request(url, { ...init, headers: Object.fromEntries(headers) })
    assert.ok(response.ok, 'native fixture request must succeed: ' + new URL(url).pathname + ' HTTP ' + response.status)
    return response
  }
  const completedSetup = await request(h.origin + '/setup', { method: 'POST', redirect: 'manual', headers: { Origin: h.origin, Cookie: h.owner, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'confirm=yes' })
  assert.equal(completedSetup.status, 303)
  const session = await h.send('/auth/session', undefined, h.owner)
  const email = session.value.operator.email, sub = randomUUID(), iat = seconds()
  const settings = await signJws(ring.privateKey, kid, 'rer-business-settings+jwt', {
    v: 1, iss: issuer, aud: h.origin, sub: installationId, business: 'synthetic-lodge-61',
    email, owner_id: sub, jti: randomUUID(), iat, exp: iat + 300, rev: 1, values: {}, logo: null, team: null,
  })
  assert.equal((await h.send('/api/rer/business-settings', { settings })).status, 200)
  const c = createProtocol({ fetch: request, origin: h.origin, surface, points: [],
    signer: { issuer, installationId, kid, privateKey: ring.privateKey },
    person: { email, sub, cookie: h.owner }, business: 'synthetic-lodge-61', agentId: randomUUID(),
    consent: randomUUID(), seq: 0, revision: 0 })
  await initializeAgent({ agentId: c.agentId, request: ownerRequest, origin: h.origin, email })
  const records = async () => (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
  const binding = async () => (await h.db.prepare('SELECT id,name,specialist,sponsor,sponsor_name,revoked FROM agent_door_agents ORDER BY id').all()).results
  const tables = async () => {
    const value = { records: await records(), binding: await binding() }
    for (const table of ['agent_door_calls', 'agent_door_reviews', 'agent_door_approvals', 'agent_door_usage', 'agent_door_events'])
      value[table] = (await h.db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()).results
    return value
  }
  const audits = async () => (await c.personJson('/agents/api/audit')).rows
  const cases = []
  for (const [phase, policy, disposition] of [ ['autonomous', autonomousPolicy(), 'autonomous'], ['held', heldPolicy(), 'review'] ]) {
    await c.adopt(policy)
    const fixtures = await prepareFixtures({ request: ownerRequest, origin: h.origin, cookie: h.owner, email, phase })
    const row = { policy: phase, revision: c.revision, disposition, reads: [], refusals: [], allowed: [] }
    receipt.policies.push(row)
    const readToken = await accessToken(c, { scope: 'lodge:read' })
    const fullToken = await accessToken(c)
    const decode = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    const reduced = decode(readToken), full = decode(fullToken)
    for (const key of ['iss', 'aud', 'sub', 'email', 'act', 'client_id', 'business', 'consent']) assert.deepEqual(reduced[key], full[key])
    assert.equal(reduced.scope, 'lodge:read')
    const beforeRead = await records()
    let inventory
    for (const [name, args] of [ ['lodge.jobs.list', {}], ['lodge.records.read', { kind: 'vacancy', id: fixtures.values.job.id }], ['lodge.proposals.list', {}] ]) {
      const answer = await c.tool(name, args, { token: readToken })
      assert.equal(answer.status, 200); assert.equal(answer.result?.isError, false, 'tool ' + (typeof name === 'undefined' ? tool : name) + ' returned ' + errorCode(answer))
      assert.equal(answer.decision?.disposition, disposition); assert.equal(answer.decision?.revision, c.revision)
      const content = answer.result.structuredContent
      if (name === 'lodge.jobs.list') assert.ok(content.jobs.some(job => job.id === fixtures.values.job.id))
      if (name === 'lodge.records.read') assert.equal(content.record.id, fixtures.values.job.id)
      if (name === 'lodge.proposals.list') { inventory = content; assert.ok(content.records.some(record => record.id === fixtures.values.debrief.application)) }
      row.reads.push({ tool: name, status: answer.status, nonemptyNativeResult: true, disposition, revision: answer.decision.revision })
    }
    assert.deepEqual(await records(), beforeRead)
    const applicationProbe = await c.tool('lodge.records.read', { kind: 'application', id: fixtures.values.debrief.application }, { token: readToken })
    assert.deepEqual(await records(), beforeRead, 'the application source probe changes no native records')
    row.applicationSourceProbe = { tool: 'lodge.records.read', kind: 'application', status: applicationProbe.status,
      isError: applicationProbe.result?.isError, code: errorCode(applicationProbe), noNativeEffect: true,
      observation: 'Existing native application projection returns output_invalid; outside the qualified vacancy-source fixture.' }

    const application = fixtures.values.debrief.application
    const revision = inventory.records.find(record => record.kind === 'application' && record.id === application).revision
    const title = 'Synthetic scope qualification ' + phase
    const proposal = { workflow: 'prepare-vacancy', summary: 'Synthetic scope draft ' + phase,
      intake: 'Prepare a vacancy for explicit native human review.', approver: email,
      changes: [{ op: 'vacancy', input: { title, location: 'Brooklyn, NY', headcount: 1, manager: email, description: 'Prepare estimates from drawings.' } }],
      idempotency_key: randomUUID() }
    const debrief = { ...fixtures.values.debrief, expected_revision: revision, idempotency_key: randomUUID() }
    const claims = [ ['role', { role: 'owner' }], ['scope', { scope: 'lodge:read lodge:prepare' }],
      ['grant', { grant: { resources: ['*'], actions: ['*'], scopes: ['lodge:read', 'lodge:prepare'], budget: { unlimited: true } } }] ]
    // Every widening attempt gets a distinct unused key. Recover the last refused
    // key for each tool with full scope; other refusal keys remain unclaimed.
    const calls = [ ['lodge.proposals.prepare', proposal], ['lodge.debriefs.prepare', debrief] ]
    const beforeRefusals = await tables(), auditBefore = (await audits()).length
    for (const [tool, args] of calls) {
      const claimed = await h.db.prepare('SELECT count(*) AS n FROM agent_door_calls WHERE agent=? AND key=?').bind(c.agentId, args.idempotency_key).first()
      assert.equal(claimed.n, 0)
      for (const [claim, extra] of claims) {
        args.idempotency_key = randomUUID()
        const answer = await c.tool(tool, { ...args, ...extra }, { token: readToken })
        assert.equal(answer.status, 403); assert.equal(errorCode(answer), 'insufficient_scope')
        assert.equal(answer.result, undefined)
        const challenge = answer.headers.get('www-authenticate') ?? ''
        assert.match(challenge, /error="insufficient_scope"/); assert.match(challenge, /scope="lodge:prepare"/)
        assert.deepEqual(await tables(), beforeRefusals, 'scope refusal changes no native value, revision, draft, binding, call claim or review')
        const rows = await audits()
        const audit = rows.at(-1)
        assert.equal(audit.tool, tool); assert.equal(audit.outcome, 'refused'); assert.equal(audit.code, 'insufficient_scope')
        assert.equal(audit.idempotency_key, args.idempotency_key); assert.equal(audit.agent.id, c.agentId)
        assert.equal(audit.consent, c.consent); assert.deepEqual(audit.scopes, ['lodge:read'])
        assert.equal(audit.sponsor.id, beforeRefusals.binding.find(agent => agent.id === c.agentId).sponsor)
        assert.deepEqual(audit.ignored_arguments, [claim]); assert.equal(audit.review, null); assert.equal(audit.approval, null)
        row.refusals.push({ tool, claim, status: answer.status, code: errorCode(answer), challenge,
          noResult: true, unchangedNativeAndDoorState: true, unusedKey: true, auditId: audit.id, auditMatched: true, keySha256: digest(args.idempotency_key) })
      }
    }
    assert.equal((await audits()).length - auditBefore, 6)
    row.refusalSnapshotSha256 = digest(beforeRefusals)
    const beforeWrites = await h.state(), beforeNative = await records(), beforeBindings = await binding()
    const allowedAnswers = []
    for (const [tool, args] of calls) {
      const answer = await c.tool(tool, args, { token: fullToken })
      assert.equal(answer.status, 200); assert.equal(answer.result?.isError, false, 'tool ' + (typeof name === 'undefined' ? tool : name) + ' returned ' + errorCode(answer))
      assert.equal(answer.decision?.disposition, disposition); assert.equal(answer.decision?.revision, c.revision)
      assert.deepEqual(answer.decision.classes.map(item => [item.class, item.rule, item.do]), [['standard', phase === 'held' ? 'standard' : 'all', disposition]])
      const id = answer.result.structuredContent.id
      assert.ok(id)
      const audit = (await audits()).find(value => value.id === answer.decision.id)
      assert.equal(audit.outcome, 'done'); assert.equal(audit.idempotency_key, args.idempotency_key)
      assert.equal(audit.agent.id, c.agentId); assert.equal(audit.consent, c.consent)
      assert.equal(audit.revision, c.revision); assert.equal(audit.decision, disposition)
      const review = answer.result._meta['com.runeditrun/review']
      if (phase === 'held') {
        assert.ok(review?.id); assert.equal(audit.review.id, review.id)
        const visible = (await c.personJson('/agents/api/reviews')).reviews.find(value => value.id === review.id)
        assert.equal(visible.decision_id, answer.decision.id); assert.equal(visible.tool, tool); assert.equal(visible.state, 'open')
        const savedReview = await h.db.prepare('SELECT saved FROM agent_door_reviews WHERE id=?').bind(review.id).first()
        const saved = JSON.parse(savedReview.saved)
        assert.equal(saved.principal.agent.id, c.agentId); assert.equal(saved.principal.consent, c.consent)
      } else { assert.equal(review, undefined); assert.equal(audit.review, null) }
      const savedCall = await h.db.prepare('SELECT outcome FROM agent_door_calls WHERE agent=? AND key=?').bind(c.agentId, args.idempotency_key).first()
      const outcome = JSON.parse(savedCall.outcome)
      assert.equal(outcome.outcome, 'done'); assert.equal(outcome.decision.id, answer.decision.id)
      row.allowed.push({ tool, status: answer.status, recoveredRefusedKey: true, id,
        recoveredClaim: 'grant', keySha256: digest(args.idempotency_key), decisionId: answer.decision.id, revision: answer.decision.revision, disposition,
        reviewId: review?.id ?? null, currentAuditAndPolicyLink: true })
      allowedAnswers.push({ tool, args, id, reviewId: review?.id ?? null })
    }
    const draftReadback = await c.tool('lodge.proposals.list', {}, { token: readToken })
    assert.equal(draftReadback.result?.isError, false)
    assert.ok(draftReadback.result.structuredContent.proposals.some(value => value.id === allowedAnswers[0].id))
    assert.ok(draftReadback.result.structuredContent.debriefs.some(value => value.id === allowedAnswers[1].id))
    row.retainedDraftReadbackWithReadOnlyToken = true
    const afterWrites = await h.state()
    assert.equal(afterWrites.proposals.length, beforeWrites.proposals.length + 1)
    assert.equal(afterWrites.debriefs.length, beforeWrites.debriefs.length + 1)
    const packetDraft = afterWrites.proposals.find(value => value.id === allowedAnswers[0].id)
    const brief = afterWrites.debriefs.find(value => value.id === allowedAnswers[1].id)
    assert.equal(packetDraft.status, 'proposed'); assert.equal(brief.status, 'draft')
    assert.equal(packetDraft.proposedByAgent, true); assert.equal(brief.preparedByAgent, true)
    assert.equal(packetDraft.proposedFor, email); assert.equal(brief.preparedFor, email)
    assert.ok(!afterWrites.vacancies.some(job => job.title === title))
    const afterNative = await records()
    const hiring = rows => rows.filter(row => !['proposal', 'debrief', 'audit'].includes(row.kind))
    assert.deepEqual(hiring(afterNative), hiring(beforeNative), 'all hiring values and revisions remain unchanged')
    assert.deepEqual(await binding(), beforeBindings)
    const finalNative = await records()
    for (const { tool, args, id, reviewId } of allowedAnswers) {
      const replay = await c.tool(tool, args, { token: fullToken })
      assert.equal(replay.result?.isError, false); assert.equal(replay.result?.structuredContent.id, id)
      assert.equal(replay.result._meta['com.runeditrun/review']?.id ?? null, reviewId)
      assert.equal((await audits()).at(-1).outcome, 'replayed')
    }
    assert.deepEqual(await records(), finalNative, 'replay creates no second native draft or audit')
    row.exactlyOneProposalAndDebrief = true; row.unchangedHiringValuesAndRevisions = true
    row.replayNoDuplicate = true; row.bindingUnchanged = true
    cases.push({ phase, application, title, summary: proposal.summary, job: fixtures.values.job.id })
    console.log('PROBE BASE-AGENT-005 acceptance-2 ' + phase + ': three read tools succeed; six widening calls refused; one proposal and debrief recovered; replay creates no duplicate')
  }
  assert.equal(receipt.outboundCalls, 0)
  assert.ok(c.points.every(point => point.ok))
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
  for (const item of cases) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    try {
      await context.addCookies(h.owner.split('; ').map(part => { const at = part.indexOf('='); return { name: part.slice(0, at), value: part.slice(at + 1), url: h.origin } }))
      await context.route('**/*', async route => {
        const incoming = route.request(), url = new URL(incoming.url())
        if (url.origin !== h.origin) return route.abort()
        const response = await request(url.href, { method: incoming.method(), headers: incoming.headers(), body: incoming.postDataBuffer() ?? undefined })
        const headers = Object.fromEntries(response.headers)
        for (const key of ['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie']) delete headers[key]
        await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) })
      })
      const page = await context.newPage()
      const capture = async screen => {
        const tooltips = await iconTooltips(page)
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 1000 })
          await page.screenshot({ path: join(packet, `${item.phase}-${screen}-${width}.png`), fullPage: true })
          receipt.browser.push({ policy: item.phase, screen, width, screenshot: `${item.phase}-${screen}-${width}.png`, visible: true, iconTooltipsCheckedAt1440: tooltips })
        }
        await page.setViewportSize({ width: 1440, height: 1000 })
      }
      await page.goto(h.origin + '/app?job=' + item.job)
      await page.getByRole('heading', { name: (await h.state()).vacancies.find(job => job.id === item.job).title, exact: true }).waitFor()
      await capture('source')
      await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^Proposals/ }).click()
      await page.getByRole('heading', { name: item.summary, exact: true }).waitFor()
      const draft = page.locator('article').filter({ has: page.getByRole('heading', { name: item.summary, exact: true }) })
      await draft.getByText('The exact changes (1)', { exact: true }).click()
      assert.ok((await draft.innerText()).includes(item.title))
      await capture('proposal')
      await page.goto(h.origin + '/app?application=' + item.application)
      await page.getByRole('tab', { name: 'Scorecards', exact: true }).click()
      const brief = page.getByRole('region', { name: 'Debrief brief', exact: true })
      await brief.waitFor()
      assert.ok((await brief.innerText()).includes('Takeoffs has not been assessed.'))
      assert.ok((await brief.innerText()).includes('draft'))
      await capture('debrief')
    } finally { await context.close() }
  }
  assert.equal(receipt.outboundCalls, 0)
  receipt.result = 'pass'
  await writeFile(join(packet, 'application-read-defect.json'), JSON.stringify({ head: receipt.head, runtime: receipt.runtime,
    classification: 'Pre-existing native application projection and shared JSON-output boundary; no runtime repair authorized',
    policies: receipt.policies.map(row => ({ policy: row.policy, ...row.applicationSourceProbe })), outboundCalls: receipt.outboundCalls }, null, 2) + '\n')
} catch (error) {
  receipt.result = 'fail'; receipt.failure = String(error.message).slice(0, 1500)
  throw error
} finally {
  await browser?.close(); await h?.close()
  await writeFile(join(packet, 'runtime-receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
  await rm(scratch, { recursive: true, force: true })
}
