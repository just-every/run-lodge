import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID, webcrypto, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const root = process.cwd(), packet = resolve(process.argv[2])
const load = path => import(pathToFileURL(resolve(root, path)).href)
const { businessHarness } = await load('tests/harness.mjs')
const { default: initializeAgent } = await load('tests/initialize-agent.mjs')
const { default: prepareFixtures } = await load('tests/agent-phase-fixtures.mjs')
const { createProtocol, errorCode, APPROVAL } = await load('src/modules/agent-door/conformance/protocol.mjs')
const { autonomousPolicy, seconds, signJws } = await load('src/modules/agent-door/conformance/crypto.mjs')
const { chromium } = await load('node_modules/@playwright/test/index.mjs')
const { build } = await load('node_modules/esbuild/lib/main.js')
const { iconTooltips } = await load('tests/icon-tooltips.mjs')
const surface = JSON.parse(await readFile('agent-surface.json', 'utf8'))
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const relevantPaths = ['src/routes/__root.tsx', 'public/lodge.css', 'public/lodge-shell.css', 'public/lodge-pipeline.css', 'src/lodge/agent-door/tools.ts', 'src/lodge/agent-door/context.ts', 'src/lodge/core/store.ts', 'src/modules/agent-door/approvals.ts', 'src/modules/agent-door/approval-execution.ts', 'src/modules/agent-door/pipeline.ts', 'src/modules/agent-door/wire.ts', 'tests/harness.mjs', 'tests/initialize-agent.mjs', 'tests/agent-phase-fixtures.mjs', 'agent-surface.json', 'src/ui/app.tsx', 'src/ui/proposals.tsx', 'src/ui/debriefs.tsx']
const sourceHashes = Object.fromEntries(await Promise.all(relevantPaths.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])))
const report = { tag: 'sx-lodge-c-f50', clause: 'BASE-AGENT-007', head, started: new Date().toISOString(), sourceHashes, cases: [], screens: [], nativeDecisions: [], status: 'running' }
await mkdir(join(packet, 'screens'), { recursive: true })
const ring = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const kid = randomUUID(), issuer = 'https://synthetic-lodge-50.invalid', installationId = randomUUID()
const publicKeys = { [kid]: await webcrypto.subtle.exportKey('jwk', ring.publicKey) }
const h = await businessHarness({ bindings: { RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId, RER_OWNER_CLAIM_PUBLIC_KEYS: JSON.stringify(publicKeys) } })
let browser
try {
  const request = (url, init = {}) => h.mf.dispatchFetch(url, init)
  const ownerRequest = async (url, init = {}) => {
    const headers = new Headers(init.headers)
    headers.set('Origin', h.origin); headers.set('Cookie', h.owner)
    const response = await request(url, { ...init, headers: Object.fromEntries(headers) })
    assert.ok(response.ok, `native request ${new URL(url).pathname}: HTTP ${response.status}`)
    return response
  }
  const session = await h.send('/auth/session', undefined, h.owner)
  const email = session.value.operator.email, sub = randomUUID(), iat = seconds()
  const settings = await signJws(ring.privateKey, kid, 'rer-business-settings+jwt', { v: 1, iss: issuer, aud: h.origin, sub: installationId, business: 'synthetic-lodge-50', email, owner_id: sub, jti: randomUUID(), iat, exp: iat + 300, rev: 1, values: {}, logo: null, team: null })
  assert.equal((await h.send('/api/rer/business-settings', { settings })).status, 200)
  const c = createProtocol({ fetch: request, origin: h.origin, surface, points: [], signer: { issuer, installationId, kid, privateKey: ring.privateKey }, person: { email, sub, cookie: h.owner }, business: 'synthetic-lodge-50', agentId: randomUUID(), consent: randomUUID(), seq: 0, revision: 0 })
  await initializeAgent({ agentId: c.agentId, request: ownerRequest, origin: h.origin, email })
  const fixtures = await prepareFixtures({ request: ownerRequest, origin: h.origin, email, cookie: h.owner, phase: 'autonomous' })
  c.fixtureValues = fixtures.values
  const snapshot = async () => (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
  const executions = async id => (await h.db.prepare("SELECT row FROM agent_door_audit WHERE json_extract(row,'$.decision_id')=? AND json_extract(row,'$.outcome')='done'").bind(id).all()).results.map(row => JSON.parse(row.row))
  const policy = disposition => ({ schema: 'rer-agent-policy/1', catalogue: 'rer-agent-classes/1', rules: [{ id: 'standard-' + disposition, class: 'standard', do: disposition, ...(disposition === 'approval' ? { approver: ['sponsor'], wait: 'PT1H' } : {}) }], spend: { none: true } })
  await c.adopt(autonomousPolicy())
  const inventory = await c.tool('lodge.proposals.list', {})
  assert.equal(inventory.result.isError, false)
  const source = inventory.result.structuredContent.records.find(row => row.kind === 'application' && row.id === fixtures.values.debrief.application)
  assert.ok(source?.revision)
  const inputFor = step => {
    const args = c.args(step, new Map())
    if (step.id === 'proposal') {
      args.summary = 'Synthetic Lodge 50 proposal for separate human review'
      args.changes[0].input.title = 'Synthetic Lodge 50 proposed vacancy'
    }
    if (step.id === 'debrief') args.expected_revision = source.revision
    return args
  }
  // Compile the unchanged complete native App for the disposable Worker browser.
  // Only the host document and local asset transport are supplied by this driver.
  const compiled = await build({ stdin: { contents: "import React from 'react'; import { createRoot } from 'react-dom/client'; import { App } from './src/ui/app.tsx'; createRoot(document.getElementById('root')).render(React.createElement(App));", resolveDir: root, loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic', target: 'es2023', logLevel: 'error', plugins: [{ name: 'vite-asset-url', setup(b) { b.onResolve({ filter: /\?url$/ }, args => ({ path: args.path, namespace: 'asset-url' })); b.onLoad({ filter: /.*/, namespace: 'asset-url' }, () => ({ contents: "export default '/assets/pdf.worker.min-Dkey6ZUl.mjs'", loader: 'js' })) } }] })
  const appScript = compiled.outputFiles[0].contents
  report.browserHost = 'Unchanged complete native App compiled with esbuild; native API, authentication, approvals and D1 are the actual Worker. No projection or tool output is mocked. This is not production SSR qualification.'
  report.appBundleSha256 = createHash('sha256').update(appScript).digest('hex')
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.route('**/*', async route => {
    const incoming = route.request(), url = new URL(incoming.url())
    if (url.origin !== h.origin) return route.abort()
    if (url.pathname === '/app') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/rer-theme.css"><link rel="stylesheet" href="/fonts/fonts.css"><link rel="stylesheet" href="/lodge.css"><link rel="stylesheet" href="/lodge-shell.css"><link rel="stylesheet" href="/lodge-pipeline.css"></head><body><div id="root"></div><script type="module" src="/_qualification-app.js"></script></body></html>' })
    if (url.pathname === '/_qualification-app.js') return route.fulfill({ contentType: 'text/javascript', body: Buffer.from(appScript) })
    const asset = resolve(root, 'public', '.' + url.pathname)
    if (asset.startsWith(resolve(root, 'public') + '/')) {
      try {
        const body = await readFile(asset)
        const type = asset.endsWith('.css') ? 'text/css' : asset.endsWith('.woff2') ? 'font/woff2' : asset.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream'
        return route.fulfill({ contentType: type, body })
      } catch {}
    }
    const headers = new Headers(incoming.headers()); headers.set('Origin', h.origin); headers.set('Cookie', h.owner)
    const response = await request(url.href, { method: incoming.method(), headers: Object.fromEntries(headers), body: incoming.postDataBuffer() ?? undefined })
    const outputHeaders = Object.fromEntries(response.headers)
    for (const name of ['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie']) delete outputHeaders[name]
    await route.fulfill({ status: response.status, headers: outputHeaders, body: Buffer.from(await response.arrayBuffer()) })
  })
  const page = await context.newPage()
  const capture = async name => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    const icons = await iconTooltips(page)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name + ' has no desktop horizontal overflow')
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      const file = 'screens/' + name + '-' + width + '.png'
      await page.screenshot({ path: join(packet, file), fullPage: true })
      report.screens.push({ file, width, iconControls: icons })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  for (const disposition of ['blocked', 'approval']) {
    await c.adopt(policy(disposition))
    for (const step of surface.journey) {
      const args = inputFor(step), before = await snapshot(), nativeBefore = await h.state()
      const expectedMeasure = step.id === 'jobs' ? nativeBefore.vacancies.length : 1
      const answer = await c.tool(step.tool, args)
      assert.equal(answer.status, 200)
      assert.equal(answer.decision.disposition, disposition)
      assert.equal(answer.decision.revision, c.revision)
      assert.deepEqual(answer.decision.classes, [{ class: 'standard', rule: 'standard-' + disposition, do: disposition, facts: { measure: expectedMeasure } }])
      assert.equal(answer.result.structuredContent, undefined, 'withhold all native content')
      assert.deepEqual(await snapshot(), before, 'no native row or native audit changes before authorization')
      const row = { tool: step.tool, disposition, policyRevision: c.revision, computed: answer.decision.classes, noNativeEffectBeforeAuthorization: true, nativeContentWithheld: true }
      if (disposition === 'blocked') {
        assert.equal(errorCode(answer), 'policy_blocked')
        const error = answer.result._meta['com.runeditrun/error']
        assert.equal(error.class, 'standard'); assert.equal(error.rule, 'standard-blocked'); assert.equal(error.revision, c.revision)
        assert.deepEqual(JSON.parse(answer.result.content[0].text), { code: 'policy_blocked', class: 'standard', rule: 'standard-blocked', revision: c.revision })
        row.code = errorCode(answer)
      } else {
        assert.equal(answer.result.resultType, 'input_required')
        assert.equal(answer.result.content, undefined)
        const handle = answer.result._meta[APPROVAL]
        assert.ok(handle?.id)
        assert.equal(new URL(handle.url).origin, h.origin)
        assert.equal(new URL(handle.url).pathname, '/agents/approvals/' + handle.id)
        assert.ok(Date.parse(handle.expires_at) > Date.now())
        assert.equal(answer.result.inputRequests.approval.method, 'elicitation/create')
        assert.equal(answer.result.inputRequests.approval.params.mode, 'url')
        assert.equal(answer.result.inputRequests.approval.params.url, handle.url)
        assert.ok(answer.result.requestState)
        const { approval } = await c.personJson('/agents/api/approvals/' + handle.id)
        assert.equal(approval.decision_id, answer.decision.id)
        assert.equal(approval.revision, c.revision)
        assert.equal(approval.state, 'pending')
        assert.deepEqual(approval.approvers, ['sponsor'])
        assert.deepEqual(approval.classes, [{ class: 'standard', facts: { measure: expectedMeasure } }])
        assert.match(approval.summary_sha256, /^[a-f0-9]{64}$/)
        await page.goto(handle.url)
        await page.locator('[data-approval-state="pending"]').waitFor()
        await page.getByText('Details', { exact: true }).click()
        assert.ok((await page.locator('main').innerText()).includes('Policy version'))
        assert.equal(await page.locator('input[name="revision"]').first().inputValue(), String(c.revision))
        assert.equal(await page.locator('input[name="summary_sha256"]').first().inputValue(), approval.summary_sha256)
        await capture(step.id + '-pending')
        await page.getByRole('button', { name: 'Approve', exact: true }).click()
        await page.locator('[data-approval-state="executed"]').waitFor()
        const decided = (await c.personJson('/agents/api/approvals/' + handle.id)).approval
        assert.equal(decided.approvals.length, 1)
        assert.equal(decided.approvals[0].ref, 'sponsor')
        assert.equal((await executions(answer.decision.id)).length, 1, 'one approval execution')
        await capture(step.id + '-executed')
        const done = await c.tool(step.tool, args, { requestState: answer.result.requestState })
        assert.equal(done.result?.isError, false, 'approved retry supplies native output')
        assert.notEqual(done.result.resultType, 'input_required')
        const receipt = done.result._meta['com.runeditrun/receipt']
        assert.ok(receipt?.id)
        assert.equal(receipt.approval_id, handle.id)
        assert.equal(receipt.decision_id, answer.decision.id)
        assert.ok(receipt.approved_by.includes(decided.approvals[0].person))
        const output = done.result.structuredContent
        const nativeAfter = await h.state()
        if (step.id === 'jobs') assert.deepEqual(output.jobs.map(row => row.id).sort(), nativeBefore.vacancies.map(row => row.id).sort())
        if (step.id === 'source') assert.equal(output.record.id, fixtures.values.job.id)
        if (step.id === 'drafts') assert.ok(output.records.some(row => row.id === source.id && row.revision === source.revision))
        if (step.id === 'proposal') {
          assert.equal(nativeAfter.proposals.filter(row => row.id === output.id && row.status === 'proposed').length, 1)
          assert.ok(!nativeAfter.vacancies.some(row => row.title === args.changes[0].input.title))
          assert.equal(nativeAfter.proposals.length, nativeBefore.proposals.length + 1)
          report.proposalId = output.id
        }
        if (step.id === 'debrief') {
          assert.equal(nativeAfter.debriefs.filter(row => row.id === output.id && row.status === 'draft').length, 1)
          assert.deepEqual(nativeAfter.applications.find(row => row.id === args.application), nativeBefore.applications.find(row => row.id === args.application))
          assert.equal(nativeAfter.debriefs.length, nativeBefore.debriefs.length + 1)
          report.debriefId = output.id
        }
        const afterExecution = await snapshot()
        const retry = await c.tool(step.tool, args, { requestState: answer.result.requestState })
        assert.equal(retry.result.isError, false)
        assert.deepEqual(retry.result.structuredContent, output)
        assert.equal(retry.result._meta['com.runeditrun/receipt'].id, receipt.id)
        assert.deepEqual(await snapshot(), afterExecution, 'retry cannot duplicate the native effect')
        assert.equal((await executions(answer.decision.id)).length, 1)
        const again = await c.personRequest('/agents/api/approvals/' + handle.id + '/approve', { method: 'POST', body: JSON.stringify({ revision: approval.revision, summary_sha256: approval.summary_sha256 }) })
        assert.equal(again.status, 200)
        assert.equal((await executions(answer.decision.id)).length, 1)
        assert.deepEqual(await snapshot(), afterExecution, 'repeated human approval cannot duplicate the native effect')
        Object.assign(row, { pending: true, sponsorBrowserApproved: true, exactRevisionAndSummary: true, urlModeElicitation: true, oneApprovalExecution: true, originalRetryKeyOrStateRetained: true, linkedReceipt: { id: receipt.id, approval_id: receipt.approval_id, decision_id: receipt.decision_id }, repeatedRetryUnchanged: true, repeatedHumanApprovalUnchanged: true })
      }
      row.passed = true
      report.cases.push(row)
      console.log('PROBE BASE-AGENT-007 acceptance-1 ' + step.tool + ' ' + disposition + ': real MCP -> ' + (disposition === 'blocked' ? 'policy_blocked with current facts; native state unchanged' : 'pending without content or effect; sponsor browser approval; native result and linked receipt; one execution'))
    }
  }
  // Authorization to prepare did not apply the proposal or keep the debrief.
  await page.goto(h.origin + '/app')
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^Proposals/ }).click()
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Synthetic Lodge 50 proposal for separate human review', exact: true }) })
  await card.getByRole('button', { name: 'Record decision', exact: true }).waitFor()
  await capture('native-proposal-draft')
  await card.locator('select[name="decision"]').selectOption('approved')
  await card.locator('input[name="reason"]').fill('Separate human review of exact proposed vacancy')
  await card.getByRole('button', { name: 'Record decision', exact: true }).click()
  await page.getByRole('heading', { name: 'Decided', exact: true }).waitFor()
  assert.ok((await h.state()).vacancies.some(row => row.title === 'Synthetic Lodge 50 proposed vacancy'))
  report.nativeDecisions.push({ kind: 'proposal', preparationSavedDraftOnly: true, separateSignedInHumanDecision: true, nativeOutcomeConfirmed: true })
  await page.goto(h.origin + '/app?application=' + encodeURIComponent(fixtures.values.debrief.application))
  await page.getByRole('tab', { name: 'Scorecards', exact: true }).click()
  const brief = page.getByRole('region', { name: 'Debrief brief', exact: true })
  await brief.getByRole('button', { name: 'Keep this brief', exact: true }).waitFor()
  assert.equal((await h.state()).debriefs.find(row => row.id === report.debriefId).status, 'draft')
  await capture('native-debrief-draft')
  const applicationBefore = (await h.state()).applications.find(row => row.id === fixtures.values.debrief.application)
  await brief.getByRole('button', { name: 'Keep this brief', exact: true }).click()
  await brief.getByText('kept', { exact: true }).waitFor()
  const finalNative = await h.state()
  assert.equal(finalNative.debriefs.find(row => row.id === report.debriefId).status, 'kept')
  assert.deepEqual(finalNative.applications.find(row => row.id === fixtures.values.debrief.application), applicationBefore)
  report.nativeDecisions.push({ kind: 'debrief', preparationSavedDraftOnly: true, separateSignedInHumanDecision: true, nativeOutcomeConfirmed: true, applicationUnchanged: true })
  assert.ok(c.points.every(point => point.ok))
  report.protocolPoints = c.points.length
  assert.equal(report.cases.length, 10)
  assert.equal(report.screens.length, 24)
  report.status = 'passed'
  console.log('QUALIFIED 10 standard policy cases; 24 browser captures; 2 separate native human decisions')
  await context.close()
} catch (error) {
  report.status = 'failed'
  report.failure = { name: error.name, message: error.message, stack: error.stack }
  throw error
} finally {
  report.finished = new Date().toISOString()
  await writeFile(join(packet, 'qualification-receipt.json'), JSON.stringify(report, null, 2) + '\n')
  await browser?.close()
  await h.close()
}
