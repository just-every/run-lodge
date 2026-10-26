import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { browserWidths } from './browser-widths.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { weeklyFixture, weeklySubject } from './weekly-report-flow.mjs'

const cookies = (value, origin) => value.split('; ').map(part => { const at = part.indexOf('='); return { name: part.slice(0, at), value: part.slice(at + 1), url: origin } })
export async function weeklyReportPage(browser, evidence) {
  await mkdir(evidence, { recursive: true })
  for (const width of browserWidths) {
    console.log('Weekly report browser journey at width ' + width)
    const h = await weeklyFixture(), context = await browser.newContext({ viewport: { width, height: 1000 } }), errors = []
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    const auth = () => context.addCookies(cookies(h.owner, h.origin))
    const shot = async name => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' fits ' + width)
      await iconTooltips(page)
      await page.screenshot({ path: evidence + '/' + name + '-' + width + '.png', fullPage: true })
    }
    const prepare = async date => {
      await page.goto(h.origin + '/reports/weekly')
      await page.locator('input[name="jobs"]').check()
      await page.getByLabel('Native recipient email addresses, separated by commas', { exact: true }).fill('owner@example.test')
      await page.getByLabel('First delivery date', { exact: true }).fill(date)
      await page.getByLabel('Local delivery time', { exact: true }).fill('09:00')
      await page.getByRole('button', { name: 'Preview weekly report', exact: true }).click()
      await page.getByRole('region', { name: 'Review weekly report', exact: true }).waitFor()
    }
    const enable = async () => {
      await page.getByLabel('I reviewed the recipients, exact cadence, metrics and sender', { exact: true }).check()
      await page.getByLabel('Enable weekly email reports', { exact: true }).check()
      await page.getByRole('button', { name: 'Enable reviewed weekly report', exact: true }).click()
      await page.getByRole('heading', { name: 'Weekly source and funnel reports', exact: true }).waitFor()
    }
    try {
      await auth()
      await page.goto(h.origin + '/analysis')
      await shot('weekly-analysis-entry')
      await page.getByRole('link', { name: 'Weekly source and funnel reports', exact: true }).click()
      await page.getByRole('heading', { name: 'Weekly source and funnel reports', exact: true }).waitFor()
      await shot('weekly-setup')
      await prepare('2026-11-02')
      assert.equal((await h.rows()).length, 0)
      await shot('weekly-preview')
      await enable()
      assert.equal((await h.reportMails()).length, 0)
      await shot('weekly-scheduled')
      await h.tick('2026-11-02T14:00:00.000Z'); await auth(); await page.reload()
      await page.getByText('Accepted by the provider; delivery unconfirmed', { exact: false }).waitFor()
      await shot('weekly-provider-accepted')
      const attempts = (await h.rows())[0].attempts
      await page.goto(h.origin + '/reports/weekly/open/' + attempts[0].id)
      await page.getByRole('heading', { name: 'Private weekly report', exact: true }).waitFor()
      await shot('weekly-private-report')
      await page.goto(h.origin + '/reports/weekly')
      await page.getByRole('button', { name: 'Cancel weekly report', exact: true }).click()
      await page.getByText('canceled · Next date:', { exact: false }).waitFor()
      await shot('weekly-canceled')
      await prepare('2026-11-03'); await enable()
      await h.activate({ replyTo: 'changed-review@example.test' })
      await h.tick('2026-11-03T14:00:00.000Z'); await auth(); await page.reload()
      await page.getByText('Current author, recipient, job access or sender requires fresh review', { exact: true }).waitFor()
      await shot('weekly-withheld')
      assert.deepEqual(errors, [])
    } finally { await context.close(); await h.close() }
    const uncertain = await weeklyFixture({ bindings: { TEST_MAIL_UNCERTAIN_SUBJECT: weeklySubject } }), uncertainContext = await browser.newContext({ viewport: { width, height: 1000 } })
    try {
      await uncertain.enable(); await uncertain.tick('2026-11-02T14:00:00.000Z')
      await uncertainContext.addCookies(cookies(uncertain.owner, uncertain.origin))
      const p = await uncertainContext.newPage(); await p.goto(uncertain.origin + '/reports/weekly')
      await p.getByText('Provider acceptance unconfirmed; human reconciliation required, no automatic resend', { exact: true }).waitFor()
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await iconTooltips(p)
      await p.screenshot({ path: evidence + '/weekly-uncertain-' + width + '.png', fullPage: true })
    } finally { await uncertainContext.close(); await uncertain.close() }
  }
}
