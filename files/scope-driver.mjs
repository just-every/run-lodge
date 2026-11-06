import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { productionFixture } from './production-fixture.mjs'

const root = resolve(process.argv[2]), packet = resolve(process.argv[3])
await mkdir(packet, { recursive: true })
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const receipt = { schema: 1, tag: 'sx-lodge-c-f62', head, started: new Date().toISOString(),
  fixture: 'emitted production Worker with migrated D1, disposable signed Business and existing owner and agent initializers',
  phases: [], screens: [], status: 'running' }
const f = await productionFixture(root)
try {
  const { c } = f
  const { accessToken, autonomousPolicy, heldPolicy } = await f.load('src/modules/agent-door/conformance/crypto.mjs')
  const { errorCode } = await f.load('src/modules/agent-door/conformance/protocol.mjs')
  const records = () => f.select('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id')
  const bindings = async () => ({
    native: (await records()).filter(row => ['member', 'business'].includes(row.kind)),
    business: await f.select('SELECT * FROM bs_team ORDER BY business_id'),
    owner: await f.select('SELECT owner_id,rev FROM bs_settings'),
    policy: await f.select('SELECT envelope,local_revision,local_paused FROM agent_door_state'),
    agents: await f.select('SELECT id,name,specialist,sponsor,sponsor_name,revoked FROM agent_door_agents ORDER BY id'),
  })
  const tables = ['agent_door_calls', 'agent_door_reviews', 'agent_door_approvals', 'agent_door_usage', 'agent_door_events']
  const shared = async () => Object.fromEntries(await Promise.all(tables.map(async table => [table, await f.select('SELECT * FROM ' + table + ' ORDER BY rowid')])))
  const audits = async () => (await f.select('SELECT row FROM agent_door_audit ORDER BY sequence')).map(row => JSON.parse(row.row))
  const auditFor = async key => (await audits()).filter(row => row.idempotency_key === key)
  const sourceOnly = rows => rows.filter(row => !['proposal', 'debrief', 'audit'].includes(row.kind))
  const phaseScreens = []
  for (const [phase, policy, disposition] of [['autonomous', autonomousPolicy(), 'autonomous'], ['held', heldPolicy(), 'review']]) {
    await c.adopt(policy)
    const fixture = await f.fixtures(phase)
    const phaseReceipt = { phase, policyRevision: c.revision, disposition, reads: [], cases: [] }
    receipt.phases.push(phaseReceipt)
    const seedProposal = await c.tool('lodge.proposals.prepare', {
      workflow: 'prepare-vacancy', summary: 'Synthetic scope seed ' + phase,
      intake: 'Prepare an estimator vacancy for human review.', approver: c.person.email,
      idempotency_key: randomUUID(), changes: [{ op: 'vacancy', input: {
        title: 'Synthetic scope seed ' + phase, location: 'Brooklyn, NY', headcount: 1,
        manager: c.person.email, description: 'Prepare estimates from drawings.',
      } }],
    })
    const seedDebrief = await c.tool('lodge.debriefs.prepare', { ...fixture.values.debrief, idempotency_key: randomUUID() })
    assert.equal(seedProposal.result?.isError, false)
    assert.equal(seedDebrief.result?.isError, false)
    phaseReceipt.seedDrafts = { proposal: seedProposal.result.structuredContent.id, debrief: seedDebrief.result.structuredContent.id }
    const readToken = await accessToken(c, { scope: 'lodge:read' })
    const applicationRead = await c.tool('lodge.records.read', { kind: 'application', id: fixture.values.debrief.application }, { token: readToken })
    const applicationReadFull = await c.tool('lodge.records.read', { kind: 'application', id: fixture.values.debrief.application })
    phaseReceipt.applicationReadObservation = {
      readOnly: { status: applicationRead.status, code: errorCode(applicationRead), isError: applicationRead.result?.isError },
      fullyScoped: { status: applicationReadFull.status, code: errorCode(applicationReadFull), isError: applicationReadFull.result?.isError },
    }
    const readStart = await records(), bindStart = await bindings()
    let inventory
    for (const [tool, args] of [
      ['lodge.jobs.list', {}],
      ['lodge.records.read', { kind: 'vacancy', id: fixture.values.job.id }],
      ['lodge.proposals.list', {}],
    ]) {
      const answer = await c.tool(tool, args, { token: readToken })
      assert.equal(answer.status, 200)
      assert.equal(answer.result?.isError, false, tool + ': ' + JSON.stringify(answer.body.error ?? answer.result?._meta))
      assert.equal(answer.decision?.disposition, disposition)
      assert.equal(answer.decision?.revision, c.revision)
      if (tool === 'lodge.jobs.list') assert.ok(answer.result.structuredContent.jobs.some(row => row.id === fixture.values.job.id))
      if (tool === 'lodge.records.read') assert.equal(answer.result.structuredContent.record.id, fixture.values.job.id)
      if (tool === 'lodge.proposals.list') {
        inventory = answer.result.structuredContent
        assert.ok(inventory.records.some(row => row.id === fixture.values.debrief.application))
        assert.ok(inventory.proposals.some(row => row.id === phaseReceipt.seedDrafts.proposal))
        assert.ok(inventory.debriefs.some(row => row.id === phaseReceipt.seedDrafts.debrief))
      }
      phaseReceipt.reads.push({ tool, status: answer.status, scope: 'lodge:read', disposition, revision: c.revision, nonempty: true })
    }
    assert.deepEqual(await records(), readStart)
    assert.deepEqual(await bindings(), bindStart)
    const revision = inventory.records.find(row => row.kind === 'application' && row.id === fixture.values.debrief.application).revision
    for (const [claim, extra] of [
      ['none', {}], ['role', { role: 'owner' }],
      ['scope', { scope: 'lodge:read lodge:prepare' }],
      ['grant', { grant: { resources: ['*'], actions: ['*'], budget: { unlimited: true } } }],
    ]) for (const tool of ['lodge.proposals.prepare', 'lodge.debriefs.prepare']) {
      const key = randomUUID()
      const title = 'Synthetic Lodge scope proposal ' + phase + ' ' + claim
      const args = tool === 'lodge.proposals.prepare' ? {
        workflow: 'prepare-vacancy', summary: title, intake: 'Prepare an estimator vacancy for human review.',
        approver: c.person.email, idempotency_key: key, changes: [{ op: 'vacancy', input: {
          title, location: 'Brooklyn, NY', headcount: 1, manager: c.person.email, description: 'Prepare estimates from drawings.',
        } }],
      } : { ...fixture.values.debrief, expected_revision: revision, idempotency_key: key }
      const fullArgs = { ...args, ...extra }
      const beforeRecords = await records(), beforeBindings = await bindings(), beforeShared = await shared()
      const beforeState = await f.state(), beforeAudit = await audits(), providerBefore = f.providerCalls
      const denied = await c.tool(tool, fullArgs, { token: readToken })
      assert.equal(denied.status, 403)
      assert.equal(errorCode(denied), 'insufficient_scope')
      assert.match(denied.headers.get('www-authenticate') ?? '', /scope="lodge:prepare"/)
      assert.equal(denied.result, undefined)
      assert.equal(denied.body.error?.data?.code, 'insufficient_scope')
      const refusedRecords = await records()
      assert.deepEqual(refusedRecords, beforeRecords)
      assert.deepEqual(await bindings(), beforeBindings)
      assert.deepEqual(await shared(), beforeShared)
      assert.deepEqual(await f.state(), beforeState)
      assert.equal(f.providerCalls, providerBefore)
      const refusedAudit = (await audits()).slice(beforeAudit.length)
      assert.equal(refusedAudit.length, 1)
      const row = refusedAudit[0]
      assert.equal(row.tool, tool)
      assert.equal(row.outcome, 'refused')
      assert.equal(row.code, 'insufficient_scope')
      assert.equal(row.idempotency_key, key)
      assert.deepEqual(row.scopes, ['lodge:read'])
      assert.deepEqual(row.ignored_arguments, Object.keys(extra).sort())
      assert.equal(row.agent.id, c.agentId)
      assert.equal(row.consent, c.consent)
      assert.ok(row.sponsor.id)
      const allowed = await c.tool(tool, fullArgs)
      assert.equal(allowed.status, 200)
      assert.equal(allowed.result?.isError, false)
      assert.equal(allowed.decision.disposition, disposition)
      assert.equal(allowed.decision.revision, c.revision)
      const id = allowed.result.structuredContent.id
      assert.ok(id)
      const afterRecords = await records(), afterState = await f.state()
      const kind = tool === 'lodge.proposals.prepare' ? 'proposal' : 'debrief'
      const oldDrafts = beforeRecords.filter(row => ['proposal', 'debrief'].includes(row.kind))
      const afterDrafts = afterRecords.filter(row => ['proposal', 'debrief'].includes(row.kind))
      assert.equal(afterDrafts.length, oldDrafts.length + 1)
      assert.ok(afterDrafts.some(row => row.kind === kind && row.id === id))
      for (const old of oldDrafts) assert.deepEqual(afterDrafts.find(row => row.kind === old.kind && row.id === old.id), old)
      assert.deepEqual(sourceOnly(afterRecords), sourceOnly(beforeRecords))
      assert.deepEqual(await bindings(), beforeBindings)
      for (const field of ['vacancies', 'applications', 'approvals', 'scorecards', 'interviews', 'messages', 'offers'])
        assert.deepEqual(afterState[field], beforeState[field], field + ' unchanged by preparation')
      const draft = (kind === 'proposal' ? afterState.proposals : afterState.debriefs).find(row => row.id === id)
      assert.equal(draft.status, kind === 'proposal' ? 'proposed' : 'draft')
      assert.ok(!afterState.vacancies.some(row => row.title === title))
      const succeeded = (await auditFor(key)).find(row => row.outcome === 'done')
      assert.equal(succeeded.id, allowed.decision.id)
      assert.equal(succeeded.revision, c.revision)
      assert.equal(succeeded.decision, disposition)
      assert.equal(succeeded.sponsor.id, row.sponsor.id)
      assert.equal(succeeded.agent.id, c.agentId)
      assert.equal(succeeded.consent, c.consent)
      assert.deepEqual(succeeded.ignored_arguments, Object.keys(extra).sort())
      let reviewId = null
      if (phase === 'held') {
        reviewId = succeeded.review?.id
        assert.ok(reviewId)
        const review = (await f.select('SELECT id,state,saved FROM agent_door_reviews')).find(row => row.id === reviewId)
        assert.equal(review.state, 'open')
        const saved = JSON.parse(review.saved)
        assert.equal(saved.decision_id, succeeded.id)
        assert.equal(saved.tool, tool)
        assert.equal(saved.principal.agent.id, c.agentId)
        assert.equal(saved.principal.person.id, row.sponsor.id)
        assert.deepEqual(saved.reviewers, ['sponsor'])
      } else assert.equal(succeeded.review, null)
      const calls = await f.select('SELECT key,state,outcome FROM agent_door_calls')
      const captured = calls.filter(row => row.key === key)
      assert.equal(captured.length, 1)
      assert.equal(JSON.parse(captured[0].outcome).result.id, id)
      const beforeReplayRecords = await records(), beforeReplayShared = await shared()
      const replay = await c.tool(tool, fullArgs)
      assert.equal(replay.result?.structuredContent.id, id)
      assert.deepEqual(await records(), beforeReplayRecords)
      assert.deepEqual(await shared(), beforeReplayShared)
      assert.equal((await auditFor(key)).at(-1).outcome, 'replayed')
      assert.equal(f.providerCalls, providerBefore)
      phaseReceipt.cases.push({ tool, claim, refusedKey: key, refusal: {
        status: 403, code: 'insufficient_scope', challenge: denied.headers.get('www-authenticate'), resultAbsent: true,
        recordRows: beforeRecords.length, recordsBefore: hash(beforeRecords), recordsAfter: hash(refusedRecords),
        bindingsUnchanged: true, nativeStateUnchanged: true, sharedStateUnchanged: true,
        audit: { id: row.id, tool: row.tool, code: row.code, outcome: row.outcome, scopes: row.scopes,
          ignored_arguments: row.ignored_arguments, agent: row.agent.id, sponsor: row.sponsor.id, consent: row.consent },
      }, positive: { status: 200, nativeDraftId: id, kind, statusLabel: draft.status,
        exactOneNewDraft: true, noNativeDecision: true, sameArgumentsAndKey: true,
        decisionId: succeeded.id, policyRevision: c.revision, disposition, reviewId,
        replaySameDraft: true, providerCalls: f.providerCalls - providerBefore } })
    }
    phaseScreens.push({ phase, application: fixture.values.debrief.application })
  }
  assert.ok(c.points.every(point => point.ok))
  assert.equal(f.providerCalls, 0)
  receipt.providerCalls = 0
  if (process.env.LODGE_SCOPE_BROWSER === '1') {
    const { chromium } = f.require('@playwright/test')
    const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
    try {
      for (const width of [1440, 390]) {
        const context = await browser.newContext({ viewport: { width, height: 1000 } })
        try {
          const page = await context.newPage()
          await page.route('**/*', async route => {
            const incoming = route.request(), url = new URL(incoming.url())
            if (url.origin !== f.origin) return route.abort()
            const response = await f.ownerRequest(url.href, { method: incoming.method(),
              headers: incoming.headers(), body: incoming.postDataBuffer() ?? undefined })
            const headers = Object.fromEntries(response.headers)
            for (const key of ['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie']) delete headers[key]
            await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) })
          })
          const browserErrors = []
          page.on('pageerror', error => browserErrors.push(error.message))
          await page.goto(f.origin + '/app?application=' + phaseScreens.at(-1).application)
          await page.getByRole('tab', { name: 'Scorecards', exact: true }).waitFor()
          const sourceOverview = 'source-' + width + '.png'
          await page.screenshot({ path: join(packet, sourceOverview), fullPage: true })
          receipt.screens.push({ width, screen: 'native application source', file: sourceOverview })
          await page.getByRole('tab', { name: 'Scorecards', exact: true }).click()
          await page.getByRole('region', { name: 'Debrief brief' }).waitFor()
          const sourceFile = 'source-debrief-' + width + '.png'
          await page.screenshot({ path: join(packet, sourceFile), fullPage: true })
          const content = await page.getByRole('region', { name: 'Debrief brief' }).innerText()
          if (width === 1440) {
            assert.ok(content.includes('draft'))
            assert.ok(content.includes('Takeoffs has not been assessed.'))
          }
          receipt.screens.push({ width, screen: 'source and unsent debriefs', file: sourceFile, visibleDraft: true })
          await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Proposals', exact: true }).click()
          await page.getByRole('heading', { name: 'Agent proposals', exact: true }).waitFor()
          if (width === 1440) for (const phase of ['autonomous', 'held']) assert.ok((await page.locator('main').innerText()).includes('Synthetic Lodge scope proposal ' + phase + ' grant'))
          const proposalFile = 'proposals-' + width + '.png'
          await page.screenshot({ path: join(packet, proposalFile), fullPage: true })
          receipt.screens.push({ width, screen: 'unsent native proposals', file: proposalFile, bothPolicies: true })
          assert.deepEqual(browserErrors, [])
        } finally { await context.close() }
      }
    } finally { await browser.close() }
  }
  receipt.status = 'passed'
  receipt.finished = new Date().toISOString()
  console.log(JSON.stringify({ head, status: receipt.status, phases: receipt.phases.length,
    reads: receipt.phases.flatMap(p => p.reads).length, refusals: receipt.phases.flatMap(p => p.cases).length,
    positiveControls: receipt.phases.flatMap(p => p.cases).length, screens: receipt.screens.length, providerCalls: f.providerCalls }))
} catch (error) {
  receipt.status = 'failed'
  receipt.failure = { name: error.name, message: error.message, stack: error.stack }
  throw error
} finally {
  await f.close()
  await writeFile(join(packet, 'scope-receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
}
