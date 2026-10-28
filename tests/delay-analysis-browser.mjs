import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { api, current, session } from './browser-journey.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { delayDraft } from './delay-analysis-flow.mjs'
import { RANGE, RUBRIC } from './hiring-fixture.mjs'

/** One native review journey at desktop width; capture the changed screens at both release widths. */
export async function delayAnalysisPage(browser, { root, origin, run, evidence, ownerEmail }) {
  if (process.env.LODGE_BROWSER_WIDTH === '390') return
  await mkdir(evidence, { recursive: true })
  const owner = await session(browser, root, origin, 'owner', 1440), { page, context } = owner
  let agentEmail
  let agent
  try {
    const job = await run('vacancy', { title: 'Synthetic delay diagnosis review', location: 'Denver, CO', manager: ownerEmail, headcount: 2, compensation: RANGE })
    await run('rubric', { id: job.id, criteria: RUBRIC })
    await run('interview-plan', { id: job.id, plan: [{ name: 'Work review', stageName: 'Interview' }] })
    const approval = await run('request-vacancy-approval', { id: job.id, approver: ownerEmail })
    await run('decide-approval', { id: approval.id, version: approval.version, decision: 'approved', reason: 'Reviewed headcount' })
    const published = await run('publish', { id: job.id })
    const add = async n => (await run('candidate', { name: 'Synthetic delay case ' + n, email: ['synthetic-lodge-delay-browser-' + n, 'example.test'].join('@'), vacancy: job.id, source: 'Direct', consentBasis: 'manual' })).application
    const first = await add(1), second = await add(2)
    for (const app of [first, second]) await run('move', { application: app.id, to: job.stages[1].id, reason: 'Human reviewed case' })
    const offer = await run('offer', { application: first.id, opening: published.openings[0].id, startDate: '2027-01-01', salary: { currency: 'USD', amount: 9500000, period: 'year' } })
    const requested = await run('request-offer-approval', { id: offer.id, approver: ownerEmail })
    await run('decide-approval', { id: requested.id, version: requested.version, decision: 'approved', reason: 'Reviewed exact terms' })
    await run('offer-outcome', { id: offer.id, outcome: 'declined', reason: 'Recorded response' })
    agentEmail = ['synthetic-lodge-delay-agent-' + job.id.slice(0, 8), 'dev.localhost'].join('@')
    await run('member', { email: agentEmail, name: 'Synthetic delay browser agent', roles: [], agent: true, actsFor: ownerEmail })
    const invitation = await context.request.post(origin + '/api/lodge/invite', { headers: { origin }, data: { email: agentEmail } })
    assert.equal(invitation.status(), 200)
    agent = await session(browser, root, origin, agentEmail, 1440)
    const response = await agent.context.request.get(origin + '/api/lodge/delay-analysis?vacancy=' + job.id)
    assert.equal(response.status(), 200)
    const report = await response.json()
    const body = delayDraft(report, ownerEmail)
    body.summary += ' ' + job.id.slice(0, 8)
    body.sampleLimits = 'Two cases in this browser cohort; incomplete and unfinished histories remain excluded from means.'
    const packet = await api(agent.context, origin, 'propose', body)
    await page.reload()
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^Proposals/ }).click()
    const panel = page.getByRole('region', { name: 'Native delay evidence', exact: true })
    await panel.getByText('Inspect native delay evidence', { exact: true }).click()
    await panel.getByLabel('Delay evidence job').selectOption(job.id)
    await panel.getByRole('button', { name: 'Load delay evidence', exact: true }).click()
    await panel.getByText('2 cases · 2 completed stage intervals', { exact: false }).waitFor()
    const sourceCase = panel.getByText('Source case: Synthetic delay case 1', { exact: true }).locator('..')
    await sourceCase.locator('summary').first().click()
    await sourceCase.getByText('Exact event citation', { exact: true }).first().click()
    const capture = async name => {
      await iconTooltips(page)
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.screenshot({ path: evidence + '/' + name + '-' + width + '.png', fullPage: true })
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    assert.ok((await panel.innerText()).includes('Survey feedback: unknown'))
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await capture('delay-source-drill')
    const draft = page.getByRole('article', { name: 'Delay diagnosis draft', exact: true }).filter({ hasText: body.summary })
    await draft.getByText('Finding citations', { exact: true }).click()
    await draft.getByText('Evidence read for this draft', { exact: true }).click()
    assert.ok((await draft.innerText()).includes('No hiring decision or configuration changes here'))
    assert.ok((await draft.innerText()).includes(report.sources.find(s => s.kind === 'offer').revision))
    await capture('delay-draft-review')
    const before = await current(context, origin)
    await draft.getByLabel('Draft decision').selectOption('rejected')
    await draft.getByLabel('Draft review reason', { exact: true }).fill('Need a larger cohort before a trial')
    await draft.getByRole('button', { name: 'Record draft review', exact: true }).click()
    await draft.getByText('Agent-authored diagnosis draft · rejected', { exact: true }).waitFor()
    const after = await current(context, origin)
    for (const key of ['applications', 'offers', 'vacancies', 'sandboxes']) assert.deepEqual(after[key], before[key])
    await capture('delay-rejected-draft')
    await panel.getByText('Source case: Synthetic delay case 1', { exact: true }).click()
    await sourceCase.getByRole('button', { name: 'Open application history', exact: true }).click()
    await page.getByRole('heading', { name: 'Synthetic delay case 1', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Apply change', exact: true }).count(), 0, 'a diagnosis is not offered as a hiring command')
    await capture('delay-application-history')
    assert.equal(after.proposals.find(p => p.id === packet.id).status, 'rejected')
  } catch (error) {
    await page.screenshot({ path: evidence + '/delay-failure.png', fullPage: true })
    throw error
  } finally { await agent?.context.close(); await context.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import('@playwright/test')
  const { start } = await import('./browser-runtime.mjs')
  const root = process.cwd(), server = await start(root, 8787)
  const browser = await chromium.launch({ executablePath: process.env.LODGE_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
  try {
    const owner = await session(browser, root, server.origin, 'owner', 1440)
    try {
      const w = await current(owner.context, server.origin)
      if (!w.business) await api(owner.context, server.origin, 'business', (await import('./harness.mjs')).BUSINESS)
      await delayAnalysisPage(browser, { root, origin: server.origin, run: (op, body) => api(owner.context, server.origin, op, body), evidence: process.env.LODGE_EVIDENCE, ownerEmail: w.actor.email })
    } finally { await owner.context.close() }
    console.log('Native delay diagnosis browser journey passed at 1440; screenshots captured at 1440 and 390')
  } finally { await browser.close(); await server.close() }
}
