import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { api, current, session } from './browser-journey.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { RANGE, RUBRIC } from './hiring-fixture.mjs'

/** Assertions use desktop width; the same changed screens are captured at both release widths. */
export async function coordinationCasePage(browser, { root, origin, run, evidence, ownerEmail }) {
  if (process.env.LODGE_BROWSER_WIDTH === '390') return
  await mkdir(evidence, { recursive: true })
  const { context, page } = await session(browser, root, origin, 'owner', 1440)
  try {
    const job = await run('vacancy', { title: 'Synthetic native feedback cases', location: 'Denver, CO', manager: ownerEmail, headcount: 1, compensation: RANGE })
    await run('rubric', { id: job.id, criteria: RUBRIC })
    await run('interview-plan', { id: job.id, plan: [{ name: 'Feedback review', stageName: 'Interview' }] })
    const approval = await run('request-vacancy-approval', { id: job.id, approver: ownerEmail })
    await run('decide-approval', { id: approval.id, version: approval.version, decision: 'approved', reason: 'Reviewed native job' })
    const published = await run('publish', { id: job.id })
    const candidateName = 'Synthetic feedback browser candidate ' + job.id.slice(0, 8)
    const app = (await run('candidate', { name: candidateName, email: ['synthetic-lodge-case-' + job.id.slice(0, 8), 'example.test'].join('@'), vacancy: job.id, source: 'Direct', consentBasis: 'manual' })).application
    const iv = await run('interview', { application: app.id, planItem: published.plan[0].id, participants: [ownerEmail], slots: ['2000-01-01T12:00:00.000Z'] })
    await run('schedule', { interview: iv.id, slot: 0 })
    await page.reload()
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^Proposals/ }).click()
    const cases = page.getByRole('region', { name: 'Native feedback cases', exact: true })
    const missing = cases.locator('.card').filter({ hasText: candidateName })
    await missing.getByRole('button', { name: 'Open feedback case', exact: true }).click()
    const card = cases.getByRole('article', { name: 'Feedback case for ' + candidateName, exact: true })
    await card.getByText('Review required', { exact: true }).waitFor()
    await card.getByText('Approve human ownership', { exact: true }).click()
    await card.getByLabel('Current human recruiter').selectOption(ownerEmail)
    await card.getByLabel('Next action', { exact: true }).fill('Review missing native feedback with the responsible panellist')
    await card.getByLabel('Deadline with time zone').fill('2099-01-01T12:00:00Z')
    await card.getByRole('button', { name: 'Save reviewed ownership', exact: true }).click()
    await card.getByText('Open', { exact: true }).waitFor()
    const capture = async name => {
      await iconTooltips(page)
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.screenshot({ path: evidence + '/' + name + '-' + width + '.png', fullPage: true })
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    await capture('feedback-case-open')
    const ownership = card.getByText('Review ownership and next action', { exact: true })
    if (!await ownership.evaluate(node => node.parentElement.open)) await ownership.click()
    await card.getByLabel('Deadline with time zone').fill('2000-01-02T12:00:00Z')
    await card.getByRole('button', { name: 'Save reviewed ownership', exact: true }).click()
    await card.getByText('Overdue · unresolved', { exact: true }).waitFor()
    await card.getByRole('button', { name: 'Reconcile native submission', exact: true }).click()
    await card.getByText('Overdue · unresolved', { exact: true }).waitFor()
    assert.equal((await current(context, origin)).coordination.cases.find(c => c.application === app.id).confirmation, null)
    await capture('feedback-case-overdue')
    await card.getByText('Stop this local case', { exact: true }).click()
    await card.getByLabel('Reason for stopping', { exact: true }).fill('Human stopped this local follow-up')
    await card.getByRole('button', { name: 'Stop feedback case', exact: true }).click()
    await card.getByText('Stopped', { exact: true }).waitFor()
    await card.getByText('Progress history', { exact: true }).click()
    assert.ok((await card.innerText()).includes('Human stopped this local follow-up'))
    await capture('feedback-case-stopped')

    const second = await run('interview', { application: app.id, planItem: published.plan[0].id, participants: [ownerEmail], slots: ['2000-01-03T12:00:00.000Z'] })
    await run('schedule', { interview: second.id, slot: 0 })
    let row = await run('coordination-discover', { application: app.id, interview: second.id, panellist: ownerEmail })
    row = (await current(context, origin)).coordination.cases.find(c => c.id === row.id)
    row = await run('coordination-case', { id: row.id, sources: row.sources, action: 'assign', owner: ownerEmail, nextAction: 'Read back actual native submission', deadline: '2099-01-01T12:00:00Z' })
    const before = await current(context, origin)
    await run('scorecard', { application: app.id, interview: second.id, recommendation: 'yes', takeaways: 'Private human feedback remains unreleased', submit: true })
    await page.reload()
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^Proposals/ }).click()
    const confirmed = cases.getByRole('article', { name: 'Feedback case for ' + candidateName, exact: true }).filter({ hasText: 'Confirmed native completion' })
    await confirmed.getByText('Confirmed native completion', { exact: true }).waitFor()
    await confirmed.getByText('Progress history', { exact: true }).click()
    const after = await current(context, origin)
    assert.equal(after.coordination.cases.find(c => c.id === row.id).confirmation.scorecard, app.id + ':' + second.id + ':' + ownerEmail)
    const decisions = view => view.applications.map(({ panel, scorecardSummary, ...application }) => application)
    assert.deepEqual(decisions(after), decisions(before), 'feedback case completion changes no hiring decision or stage history')
    assert.ok(!(await cases.innerText()).includes('Private human feedback remains unreleased'))
    assert.ok((await confirmed.innerText()).includes('completed'))
    await capture('feedback-case-confirmed')
  } catch (error) {
    await page.screenshot({ path: evidence + '/feedback-case-failure.png', fullPage: true })
    throw error
  } finally { await context.close() }
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
      await coordinationCasePage(browser, { root, origin: server.origin, run: (op, body) => api(owner.context, server.origin, op, body), evidence: process.env.LODGE_EVIDENCE, ownerEmail: w.actor.email })
    } finally { await owner.context.close() }
    console.log('Native feedback case browser journey passed at 1440; screens captured at 1440 and 390')
  } finally { await browser.close(); await server.close() }
}
