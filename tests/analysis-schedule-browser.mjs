import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { browserWidths } from './browser-widths.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { scheduleFixture } from './analysis-schedule-flow.mjs'

const cookies = (value, origin) => value.split('; ').map(part => { const at = part.indexOf('='); return { name: part.slice(0, at), value: part.slice(at + 1), url: origin } })
export async function analysisSchedulePage(browser, evidence) {
  await mkdir(evidence, { recursive: true })
  for (const width of browserWidths) {
    const h = await scheduleFixture(), context = await browser.newContext({ viewport: { width, height: 1000 } }), errors = []
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    const shot = async name => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' fits ' + width)
      await iconTooltips(page)
      await page.screenshot({ path: evidence + '/' + name + '-' + width + '.png', fullPage: true })
    }
    const prepare = async dueAt => {
      await page.goto(h.origin + '/analysis/schedules/new?chart=' + h.chart.id)
      await page.getByLabel('Future delivery time with UTC offset', { exact: true }).fill(dueAt)
      await page.getByRole('button', { name: 'Preview scheduled delivery', exact: true }).click()
      await page.getByRole('region', { name: 'Review scheduled delivery', exact: true }).waitFor()
    }
    const enable = async () => {
      await page.getByLabel('I reviewed the exact query, English format', { exact: false }).check()
      await page.getByLabel('Enable this one-off scheduled delivery', { exact: true }).check()
      await page.getByRole('button', { name: 'Enable reviewed chart delivery', exact: true }).click()
      await page.getByRole('heading', { name: 'My scheduled chart deliveries', exact: true }).waitFor()
    }
    try {
      await context.addCookies(cookies(h.owner, h.origin))
      await page.goto(h.origin + '/analysis/schedules/new?chart=' + h.chart.id)
      await page.getByRole('heading', { name: 'Schedule chart delivery', exact: true }).waitFor()
      await shot('analysis-schedule-new')
      assert.equal((await h.rows()).length, 0)
      await prepare('2026-10-26T15:00:00.000Z')
      assert.equal((await h.rows()).length, 0, 'UI preview leaves delivery off')
      assert.ok((await page.getByRole('region', { name: 'Review scheduled delivery', exact: true }).innerText()).includes('owner@example.test'))
      await shot('analysis-schedule-review')
      await enable()
      assert.equal((await h.scheduleMails()).length, 0, 'explicit future approval is not an immediate send')
      await page.getByText('pending', { exact: true }).waitFor()
      await shot('analysis-schedule-pending')
      await h.tick('2026-10-26T15:00:00.000Z')
      await page.reload()
      await page.getByText('Accepted by the mail provider; delivery unconfirmed', { exact: true }).waitFor()
      assert.equal((await h.scheduleMails()).length, 1)
      await shot('analysis-schedule-provider-accepted')
      await prepare('2026-10-26T16:00:00.000Z'); await enable()
      await page.getByRole('button', { name: 'Cancel this scheduled delivery', exact: true }).click()
      await page.getByText('canceled', { exact: true }).waitFor()
      await h.tick('2026-10-26T16:00:00.000Z')
      assert.equal((await h.scheduleMails()).length, 1)
      await shot('analysis-schedule-canceled')
      await prepare('2026-10-26T17:00:00.000Z'); await enable()
      await h.activate({ replyTo: 'new-reviewed-reply@example.test' })
      await h.tick('2026-10-26T17:00:00.000Z')
      await page.reload()
      await page.getByText('withheld', { exact: true }).waitFor()
      assert.equal((await h.scheduleMails()).length, 1)
      await shot('analysis-schedule-sender-withheld')
      assert.deepEqual(errors, [])
    } finally { await context.close(); await h.close() }
  }
}
