import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { api, current, session } from './browser-journey.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import prepareFixtures from './agent-phase-fixtures.mjs'
import { readDevKey, signInAs } from '../src/modules/operator-auth/dev/sign-in-as.mjs'

/** The existing human draft and refusal screens, after real native preparations. */
export async function agentRefusalPage(browser, { root, origin, evidence, ownerEmail }) {
  if (process.env.LODGE_BROWSER_WIDTH === '390') return
  await mkdir(evidence, { recursive: true })
  const { context, page } = await session(browser, root, origin, 'owner', 1440)
  let agentContext
  try {
    const address = ['synthetic-lodge-refusal-' + randomUUID(), 'example.invalid'].join('@')
    await api(context, origin, 'member', { email: address, name: 'Synthetic refusal coordinator', agent: true, actsFor: ownerEmail, businessAgentId: randomUUID() })
    const invited = await context.request.post(origin + '/api/lodge/invite', { headers: { origin }, data: { email: address } })
    assert.equal(invited.status(), 200)
    const login = await signInAs({ origin, key: await readDevKey(root), as: address })
    agentContext = await browser.newContext()
    await agentContext.addCookies(login.cookies.map(cookie => ({ ...cookie, url: origin })))
    const request = async (url, init = {}) => {
      const response = await context.request.fetch(url, { method: init.method ?? 'GET', headers: { origin, ...init.headers }, data: init.body })
      return { ok: response.ok(), status: response.status(), json: () => response.json() }
    }
    const fixtures = await prepareFixtures({ request, origin, email: ownerEmail, phase: 'autonomous' })
    const proposal = { workflow: 'prepare-vacancy', approver: ownerEmail,
      summary: 'Synthetic unsent refusal recovery ' + fixtures.values.job.id, intake: 'Prepare an estimator vacancy for human review.',
      changes: [{ op: 'vacancy', input: { title: 'Synthetic refusal recovery estimator', location: 'Brooklyn, NY', headcount: 1, manager: ownerEmail, description: 'Prepare estimates from drawings.' } }],
    }
    const prepare = async (op, input) => {
      const response = await agentContext.request.post(origin + '/api/lodge/command/' + op, { headers: { origin }, data: input })
      return { status: response.status(), value: await response.json() }
    }
    const before = await current(context, origin)
    for (const [op, input, code, status] of [
      ['propose', { ...proposal, changes: [] }, 'native_refused', 400],
      ['debrief', { ...fixtures.values.debrief, application: 'synthetic-lodge-missing' }, 'record_unavailable', 404],
    ]) {
      const answer = await prepare(op, input)
      assert.equal(answer.status, status)
      assert.equal(answer.value.code, code)
    }
    assert.deepEqual(await current(context, origin), before, 'refusals preserve the human workspace')
    const proposed = await prepare('propose', proposal), prepared = await prepare('debrief', fixtures.values.debrief)
    assert.equal(proposed.status, 200)
    assert.equal(prepared.status, 200)
    const after = await current(context, origin)
    assert.equal(after.proposals.find(row => row.id === proposed.value.id).status, 'proposed')
    assert.equal(after.debriefs.find(row => row.id === prepared.value.id).status, 'draft')
    assert.deepEqual(after.applications, before.applications)
    assert.deepEqual(after.vacancies, before.vacancies, 'preparation never applies the vacancy')
    const capture = async name => {
      await iconTooltips(page)
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.screenshot({ path: evidence + '/' + name + '-' + width + '.png', fullPage: true })
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    await page.reload()
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^Proposals/ }).click()
    await page.getByRole('heading', { name: proposal.summary, exact: true }).waitFor()
    await capture('unsent-proposal')
    await page.goto(origin + '/app?application=' + fixtures.values.debrief.application)
    await page.getByRole('tab', { name: 'Scorecards', exact: true }).click()
    const brief = page.getByRole('region', { name: 'Debrief brief', exact: true })
    await brief.getByText('draft', { exact: true }).waitFor()
    await capture('debrief-draft')
    await brief.getByText('Edit the brief', { exact: true }).click()
    const statement = brief.getByRole('textbox', { name: /^Brief statement 1: Nobody assessed/ })
    await statement.fill('Synthetic overall recommendation')
    await brief.getByRole('button', { name: 'Save the brief', exact: true }).click()
    await brief.getByRole('alert').getByText('a brief carries no combined score or recommendation', { exact: false }).waitFor()
    assert.equal((await current(context, origin)).debriefs.find(row => row.id === prepared.value.id).statements[0].text, fixtures.values.debrief.statements[0].text)
    await capture('debrief-refused-edit')
  } finally { await agentContext?.close(); await context.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import('@playwright/test')
  const { start, freePort } = await import('./browser-runtime.mjs')
  const root = process.cwd(), server = await start(root, await freePort())
  const browser = await chromium.launch({ executablePath: process.env.LODGE_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
  try {
    const owner = await session(browser, root, server.origin, 'owner', 1440)
    let ownerEmail
    try {
      const { BUSINESS } = await import('./harness.mjs')
      await api(owner.context, server.origin, 'business', BUSINESS)
      ownerEmail = (await current(owner.context, server.origin)).actor.email
    } finally { await owner.context.close() }
    await agentRefusalPage(browser, { root, origin: server.origin, evidence: process.env.LODGE_EVIDENCE ?? '.cache/agent-refusal', ownerEmail })
    console.log('Native refusal and unsent draft screens passed at 1440 and 390')
  } finally { await browser.close(); await server.close() }
}
