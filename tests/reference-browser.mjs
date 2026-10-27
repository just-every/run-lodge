import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { browserWidths } from './browser-widths.mjs'
import { api, current, session } from './browser-journey.mjs'
import { iconTooltips } from './icon-tooltips.mjs'

export async function referencePage(browser, { root, origin, evidence, ownerEmail }) {
  await mkdir(evidence, { recursive: true })
  for (const width of browserWidths) {
    const user = await session(browser, root, origin, 'owner', width)
    const { page, context } = user
    try {
      const run = (op, body) => api(context, origin, op, body)
      const job = await run('vacancy', { title: 'Reference call supervisor ' + width, manager: ownerEmail, headcount: 1, location: 'Denver, CO', compensation: { currency: 'USD', min: 7000000, max: 9000000, period: 'year' } })
      await run('rubric', { id: job.id, criteria: [{ name: 'Safety', description: 'Explains safe work' }] })
      await run('interview-plan', { id: job.id, plan: [{ name: 'Work review', stageName: 'Interview' }] })
      const approval = await run('request-vacancy-approval', { id: job.id, approver: ownerEmail })
      await run('decide-approval', { id: approval.id, decision: 'approved', version: approval.version, reason: 'Approved headcount' })
      await run('publish', { id: job.id })
      const { application: app } = await run('candidate', { name: 'Synthetic Lodge Reference ' + width, email: 'synthetic-lodge-ref-' + width + '@example.test', source: 'Direct', consentBasis: 'manual', vacancy: job.id })
      await page.goto(origin + '/app?application=' + app.id)
      await page.getByRole('tab', { name: 'Decisions', exact: true }).click()
      const panel = page.getByRole('region', { name: 'Phone references', exact: true })
      await panel.getByText('Questionnaire and readers', { exact: true }).click()
      await panel.getByLabel('Reference questions, one per line', { exact: true }).fill('Describe their work on the crew')
      await panel.getByRole('button', { name: 'Save reference questionnaire', exact: true }).click()
      await panel.getByText('Questionnaire version 1', { exact: true }).waitFor()
      await panel.getByText('New call task', { exact: true }).click()
      await panel.getByLabel('Call task note', { exact: true }).fill('Call former supervisor')
      await panel.getByLabel('Call due date', { exact: true }).fill('2026-12-03')
      await panel.getByLabel('Assigned caller').selectOption(ownerEmail)
      await panel.getByRole('button', { name: 'Create call-references task', exact: true }).click()
      await panel.getByText('Record call answers', { exact: true }).click()
      await panel.getByLabel('Referee name', { exact: true }).fill('Synthetic Lodge Referee')
      await panel.getByLabel('Referee relationship', { exact: true }).fill('Former supervisor')
      await panel.getByLabel('Call source evidence', { exact: true }).fill('Employer-provided phone number; call made by the assigned caller')
      await panel.getByLabel('Recorded consent evidence', { exact: true }).fill('Referee verbally agreed to record this work reference')
      await panel.getByLabel("I recorded the referee's consent to this reference", { exact: true }).check()
      await panel.getByLabel('Describe their work on the crew', { exact: true }).fill('Led the safety briefing every shift')
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'reference form fits')
      await iconTooltips(page)
      await page.screenshot({ path: evidence + '/reference-recording-' + width + '.png', fullPage: true })
      await panel.getByRole('button', { name: 'Save manually recorded answers', exact: true }).click()
      await panel.getByText('Manually recorded · answer version 1', { exact: true }).waitFor()
      await panel.getByText('Led the safety briefing every shift', { exact: true }).waitFor()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'reference history fits')
      await iconTooltips(page)
      await page.screenshot({ path: evidence + '/reference-history-' + width + '.png', fullPage: true })
      assert.equal((await current(context, origin)).applications.find(a => a.id === app.id).stage, app.stage)
    } catch (error) {
      await page.screenshot({ path: evidence + '/reference-error-' + width + '.png', fullPage: true })
      console.error('Reference screen failed at width ' + width + ': ' + await page.title())
      throw error
    } finally { await context.close() }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import('@playwright/test')
  const { start } = await import('./browser-runtime.mjs')
  const root = process.cwd(), server = await start(root, 8787)
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
  try {
    const owner = await session(browser, root, server.origin, 'owner', 1440)
    let email
    try {
      const w = await current(owner.context, server.origin)
      email = w.actor.email
      if (!w.business) {
        const { BUSINESS } = await import('./harness.mjs')
        await api(owner.context, server.origin, 'business', BUSINESS)
      }
    } finally { await owner.context.close() }
    await referencePage(browser, { root, origin: server.origin, evidence: process.env.LODGE_EVIDENCE, ownerEmail: email })
    console.log('HIRE-008 phone-reference screens passed at 1440 and 390')
  } finally { await browser.close(); await server.close() }
}
