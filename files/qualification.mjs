import assert from 'node:assert/strict'
import {readFile, writeFile, mkdir} from 'node:fs/promises'
import {randomUUID, webcrypto, createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {join, dirname} from 'node:path'
import {execFileSync} from 'node:child_process'

const root = process.env.LODGE_CHECKOUT
assert.ok(root, 'Select the declared product checkout')
process.chdir(root)
const packet = dirname(new URL(import.meta.url).pathname)
const require = createRequire(join(root, 'package.json'))
const {chromium} = require('@playwright/test')
const load = path => import(pathToFileURL(join(root, path)))
const {businessHarness} = await load('tests/harness.mjs')
const {default: initializeAgent} = await load('tests/initialize-agent.mjs')
const {default: prepareFixtures} = await load('tests/agent-phase-fixtures.mjs')
const {createProtocol} = await load('src/modules/agent-door/conformance/protocol.mjs')
const {autonomousPolicy, heldPolicy, seconds, signJws, accessToken} = await load('src/modules/agent-door/conformance/crypto.mjs')
const surface = JSON.parse(await readFile('agent-surface.json', 'utf8'))
const head = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim()
const receipt = {schema: 1, head, clause: 'BASE-AGENT-009', scope: 'acceptance 3 and existing human Mark reviewed',
  clock: '2026-11-04T12:00:00.000Z', phases: [], screens: [], assertions: [], status: 'running'}
let now = '2026-11-01T23:59:00.000Z'
const ring = await webcrypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify'])
const kid = randomUUID(), issuer = 'https://synthetic-lodge-51.invalid', installationId = randomUUID()
const publicKeys = {[kid]: await webcrypto.subtle.exportKey('jwk', ring.publicKey)}
const h = await businessHarness({clock: now, bindings: {
  RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId,
  RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify(publicKeys),
}})
const request = (url, init = {}) => h.mf.dispatchFetch(url, init)
const ownerRequest = async (url, init = {}) => {
  const headers = new Headers(init.headers)
  headers.set('Origin', h.origin); headers.set('Cookie', h.owner)
  const response = await request(url, {...init, headers: Object.fromEntries(headers)})
  assert.ok(response.ok, 'Native fixture HTTP ' + response.status)
  return response
}
let browser
try {
  const session = await h.send('/auth/session', undefined, h.owner)
  const email = session.value.operator.email, sub = randomUUID(), iat = seconds(now)
  const settings = await signJws(ring.privateKey, kid, 'rer-business-settings+jwt', {
    v: 1, iss: issuer, aud: h.origin, sub: installationId, business: 'synthetic-lodge-51',
    email, owner_id: sub, jti: randomUUID(), iat, exp: iat + 300, rev: 1, values: {}, logo: null, team: null,
  })
  assert.equal((await h.send('/api/rer/business-settings', {settings})).status, 200)
  const c = createProtocol({fetch: request, origin: h.origin, surface, points: [], now: () => Date.parse(now),
    signer: {issuer, installationId, kid, privateKey: ring.privateKey}, person: {email, sub, cookie: h.owner},
    business: 'synthetic-lodge-51', agentId: randomUUID(), consent: randomUUID(), seq: 0, revision: 0})
  await initializeAgent({agentId: c.agentId, request: ownerRequest, origin: h.origin, email})
  const fixtures = await prepareFixtures({request: ownerRequest, origin: h.origin, cookie: h.owner, email, phase: 'autonomous'})
  c.fixtureValues = fixtures.values
  const at = async value => { now = value; await h.setTime(now) }
  const humanState = async () => {
    const state = await h.state()
    return Object.fromEntries(['vacancies', 'applications', 'interviews', 'scorecards', 'messages', 'offers', 'candidates'].map(key => [key, state[key]]))
  }
  const originalHiring = await humanState()
  const calls = []
  const callFive = async (phase, policy) => {
    await c.adopt(policy)
    const outcomes = []
    for (const step of surface.journey) {
      const args = c.args(step, new Map())
      const answer = await c.tool(step.tool, args)
      assert.equal(answer.status, 200)
      assert.equal(answer.result?.isError, false, step.tool)
      assert.equal(answer.decision?.disposition, phase === 'held' ? 'review' : 'autonomous')
      calls.push(answer)
      outcomes.push({tool: step.tool, decision: answer.decision.disposition, id: answer.decision.id})
      if (!surface.tools.find(tool => tool.name === step.tool).readOnly) {
        const state = await h.state(), id = answer.result.structuredContent.id
        assert.ok([...state.proposals, ...state.debriefs].some(row => row.id === id && ['proposed', 'draft'].includes(row.status)), 'Only an unsent preparation is saved')
      }
    }
    assert.deepEqual(await humanState(), originalHiring, 'Preparation and reads preserve all hiring decisions and message contents')
    receipt.phases.push({phase, at: now, calls: outcomes})
  }
  for (const [phase, policy] of [['autonomous', autonomousPolicy()], ['held', heldPolicy()]])
    await callFive(phase, policy)
  // Generate enough genuine reads to require more than one audit page.
  for (let minute = 0; minute < 4; minute++) {
    await at('2026-11-04T12:0' + minute + ':00.000Z')
    await c.adopt(autonomousPolicy())
    for (let index = 0; index < 50; index++) {
      const answer = await c.tool('lodge.jobs.list', {})
      assert.equal(answer.result?.isError, false)
      assert.ok(answer.result.structuredContent.jobs.some(job => job.id === fixtures.values.job.id))
      calls.push(answer)
    }
  }
  await at('2026-11-04T12:04:00.000Z')
  await callFive('autonomous', autonomousPolicy())
  await callFive('held', heldPolicy())
  await c.adopt({...autonomousPolicy(), rules: [{id: 'standard', class: 'standard', do: 'blocked'}]})
  assert.equal((await c.tool('lodge.jobs.list', {})).decision.disposition, 'blocked')
  await c.adopt(null)
  assert.equal((await c.tool('lodge.jobs.list', {})).decision.disposition, 'unset')
  await at('2026-11-04T13:00:00.000Z')
  for (const [phase, policy] of [['autonomous', autonomousPolicy()], ['held', heldPolicy()]])
    await callFive(phase, policy)
  await at(receipt.clock)
  // Use an as-of after all in-period calls, before future controls.
  await at('2026-11-04T12:05:00.000Z')
  await c.adopt(heldPolicy())
  const audit = async () => {
    const rows = []; let cursor, pages = 0, differs = 0
    for (;;) {
      const result = await h.send('/agents/api/audit' + (cursor ? '?after=' + encodeURIComponent(cursor) : ''), undefined, h.owner)
      assert.equal(result.status, 200)
      const page = result.value
      pages++; differs += page.differs_from_policy; rows.push(...page.rows)
      if (!page.rows.length) break
      assert.notEqual(page.cursor, cursor, 'Pagination advances')
      cursor = page.cursor
      assert.ok(pages < 20)
    }
    assert.equal(differs, 0)
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length)
    return {rows, pages, differs}
  }
  const baseline = await audit()
  assert.ok(baseline.rows.length > 200)
  assert.ok(baseline.pages >= 3)
  const since = '2026-11-02T00:00:00.000Z', asOf = now
  const eligible = baseline.rows.filter(row => row.at >= since && row.at <= asOf)
  const before = baseline.rows.filter(row => row.at < since), after = baseline.rows.filter(row => row.at > asOf)
  assert.ok(before.length > 0 && after.length > 0)
  const expectedCounts = {}
  for (const row of eligible) for (const item of row.classes) {
    const key = item.class + ':' + row.decision
    expectedCounts[key] = (expectedCounts[key] ?? 0) + 1
  }
  assert.ok(expectedCounts['standard:autonomous'] > 0)
  assert.ok(expectedCounts['standard:review'] > 0)
  const reviews = async () => {
    const response = await h.send('/agents/api/reviews', undefined, h.owner)
    assert.equal(response.status, 200)
    return response.value.reviews
  }
  const heldRows = baseline.rows.filter(row => row.decision === 'review')
  const allReviews = await reviews()
  assert.deepEqual(allReviews.map(row => row.id).sort(), heldRows.map(row => row.review.id).sort())
  assert.ok(allReviews.length > 2)
  const flagged = allReviews.at(-1).id
  assert.equal((await h.send('/agents/api/reviews/' + flagged + '/flag', {}, h.owner)).status, 200)
  const target = allReviews.find(row => row.tool === 'lodge.proposals.prepare').id
  const reviewPath = '/agents/api/reviews/' + target + '/reviewed'
  const safeState = (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
  const beforeRefusals = await reviews()
  const signedOut = await request(h.origin + reviewPath, {method: 'POST', headers: {Origin: h.origin, 'Content-Type': 'application/json'}, body: '{}'})
  assert.ok([401, 403].includes(signedOut.status))
  const agent = await request(h.origin + reviewPath, {method: 'POST', headers: {Origin: h.origin, 'Content-Type': 'application/json', Authorization: 'Bearer ' + await accessToken(c)}, body: '{}'})
  assert.ok([401, 403].includes(agent.status))
  assert.deepEqual(await reviews(), beforeRefusals, 'Refused non-human attempts change no review')
  browser = await chromium.launch({executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox']})
  await mkdir(join(packet, 'screens'), {recursive: true})
  for (const width of [1440, 390]) {
    const context = await browser.newContext({viewport: {width, height: 1000}})
    try {
      const page = await context.newPage()
      await page.route('**/*', async route => {
        const incoming = route.request(), url = new URL(incoming.url())
        if (url.origin !== h.origin) return route.abort()
        const response = await request(url.href, {method: incoming.method(), headers: {...incoming.headers(), Cookie: h.owner}, body: incoming.postDataBuffer() ?? undefined})
        const headers = Object.fromEntries(response.headers)
        for (const name of ['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie']) delete headers[name]
        await route.fulfill({status: response.status, headers, body: Buffer.from(await response.arrayBuffer())})
      })
      const assertPage = async () => {
        await page.goto(h.origin + '/agents')
        await page.getByRole('heading', {name: 'Agents', exact: true}).waitFor()
        const counts = await page.locator('[data-agents-count]').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.class + ':' + node.dataset.decision, Number(node.textContent)])))
        assert.deepEqual(counts, expectedCounts, 'Every displayed class and decision total matches independently paginated audit reads')
        const current = await reviews()
        const expectedIds = current.filter(row => ['open', 'flagged'].includes(row.state)).map(row => row.id).sort()
        const shownIds = await page.locator('[data-review-id]').evaluateAll(nodes => nodes.map(node => node.dataset.reviewId).sort())
        assert.deepEqual(shownIds, expectedIds, 'Exactly the currently eligible open and flagged handles appear')
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        return expectedIds
      }
      const openBefore = await assertPage()
      await page.screenshot({path: join(packet, 'screens', 'agents-' + width + '-before.png'), fullPage: true})
      const chosen = (await reviews()).find(row => row.state === 'open' && ['lodge.proposals.prepare', 'lodge.debriefs.prepare'].includes(row.tool))
      assert.ok(chosen)
      const responsePromise = page.waitForResponse(response => response.url().endsWith('/reviews/' + chosen.id + '/reviewed'))
      await page.locator('[data-review-id="' + chosen.id + '"]').getByRole('button', {name: 'Mark reviewed', exact: true}).click()
      assert.equal((await responsePromise).status(), 200)
      await page.locator('[data-review-id="' + chosen.id + '"]').waitFor({state: 'detached'})
      const marked = (await reviews()).find(row => row.id === chosen.id)
      const original = baseline.rows.find(row => row.review?.id === chosen.id)
      assert.equal(marked.state, 'reviewed')
      assert.equal(marked.marked_by, original.sponsor.id, 'The signed-in human identity is retained')
      assert.equal(marked.marked_at, now, 'The exact fixture time is retained')
      const readback = await audit()
      assert.deepEqual(readback.rows.map(row => row.id), baseline.rows.map(row => row.id), 'Marking retains every audit identity')
      const audited = readback.rows.find(row => row.id === original.id)
      assert.equal(audited.review.id, chosen.id)
      assert.equal(audited.review.by, marked.marked_by)
      const withoutBy = rows => rows.map(row => ({...row, review: row.review ? {...row.review, by: null} : null}))
      assert.deepEqual(withoutBy(readback.rows), withoutBy(baseline.rows), 'All audit fields except review person remain unchanged')
      assert.deepEqual((await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results, safeState, 'Human review changes no hiring record, unsent preparation or draft bytes')
      assert.deepEqual(await humanState(), originalHiring)
      const openAfter = await assertPage()
      assert.deepEqual(openAfter, openBefore.filter(id => id !== chosen.id))
      await page.screenshot({path: join(packet, 'screens', 'agents-' + width + '-after.png'), fullPage: true})
      receipt.screens.push({width, counts: expectedCounts, openBefore, openAfter, marked: {id: marked.id, person: marked.marked_by, at: marked.marked_at}, audit: original.id})
    } finally {await context.close()}
  }
  receipt.audit = {rows: baseline.rows.length, pages: baseline.pages, inPeriod: eligible.length, beforePeriod: before.length, afterAsOf: after.length, since, asOf, counts: expectedCounts, differs: baseline.differs}
  receipt.refusals = {signedOut: signedOut.status, agent: agent.status, unchangedReviewState: true}
  receipt.nativeStateSha256 = createHash('sha256').update(JSON.stringify(safeState)).digest('hex')
  receipt.assertions = ['all five tools under both policies', 'unsent preparations only', 'independent pagination and weekly totals', 'past and future exclusions', 'exact open and flagged handles', 'signed-in human mark and time', 'retained audit identity and human readback', 'unchanged hiring records and draft contents', 'signed-out and agent marks refused']
  assert.ok(c.points.every(point => point.ok))
  receipt.status = 'passed'
  console.log('PROBE BASE-AGENT-009 acceptance3: real MCP calls and paginated audit -> exact weekly counts at 1440 and 390')
  console.log('PROBE BASE-AGENT-009 acceptance4 Mark reviewed: human browser control -> retained person and time, removed open handle, unchanged native records')
  console.log(JSON.stringify(receipt.audit))
} catch (error) {
  receipt.status = 'failed'; receipt.failure = error.message
  throw error
} finally {
  await browser?.close()
  await h.close()
  await writeFile(join(packet, 'qualification-receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
}
