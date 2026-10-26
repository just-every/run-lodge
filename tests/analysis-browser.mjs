import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { browserWidths } from './browser-widths.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { analysisFixture, analysisQuestion } from './analysis-flow.mjs'

const cookies = (value, origin) => value.split('; ').map(part => { const at = part.indexOf('='); return { name: part.slice(0, at), value: part.slice(at + 1), url: origin } })

export async function analysisPage(browser, evidence) {
  await mkdir(evidence, { recursive: true })
  for (const width of browserWidths) {
    const h = await analysisFixture(), context = await browser.newContext({ viewport: { width, height: 1000 } }), errors = []
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    const shot = async name => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' fits ' + width)
      await iconTooltips(page)
      await page.screenshot({ path: evidence + '/' + name + '-' + width + '.png', fullPage: true })
    }
    try {
      await context.addCookies(cookies(h.owner, h.origin))
      await page.goto(h.origin + '/analysis/setup')
      for (const [label, value] of [['Estimated questions per month', '100'], ['Estimated input tokens per question', '3000'], ['Estimated output tokens per question', '1000'], ['USD per million input tokens', '2'], ['USD per million output tokens', '10'], ['USD rate basis and date', 'Synthetic isolated provider rate card, 2026-10-26']]) await page.getByLabel(label, { exact: true }).fill(value)
      await page.getByLabel('Our employer plan permits this provider capability.', { exact: true }).check()
      await page.getByLabel('Our application has access to this configured model.', { exact: true }).check()
      await page.getByLabel('Our employer reviewed the legal', { exact: false }).check()
      await page.getByRole('button', { name: 'Preview analysis cost estimate', exact: true }).click()
      await page.getByRole('region', { name: 'Analysis estimate preview', exact: true }).waitFor()
      await shot('analysis-provider-review')
      await page.getByLabel('I reviewed this exact provider', { exact: false }).check()
      await page.getByLabel('Enable recruiting analysis for explicit questions', { exact: true }).check()
      await page.getByRole('button', { name: 'Enable reviewed analysis provider', exact: true }).click()
      await page.getByRole('status').waitFor()
      await context.clearCookies(); await context.addCookies(cookies(h.manager, h.origin))
      const before = (await h.state()).applications.map(a => [a.id, a.stage, a.status])
      await page.goto(h.origin + '/analysis')
      await page.getByLabel('Recruiting question', { exact: true }).fill(analysisQuestion)
      await page.getByRole('button', { name: 'Interpret recruiting question', exact: true }).click()
      let source = page.getByRole('article', { name: 'Source conversion result', exact: true })
      const scheduling = page.getByRole('article', { name: 'Scheduling delay result', exact: true })
      await source.waitFor(); await scheduling.waitFor()
      assert.ok((await scheduling.innerText()).includes('60 hours'))
      await source.getByText('Underlying source rows (3 shown)', { exact: true }).click()
      assert.ok((await source.innerText()).includes(h.appA.id))
      assert.ok((await source.innerText()).includes('2026-07-11T14:00:00.000Z'))
      await shot('analysis-grounded-charts')
      await source.getByLabel('Job filters', { exact: true }).selectOption([h.job.id])
      await source.getByLabel('Source filters', { exact: true }).selectOption(['Referral'])
      await source.getByLabel('Chart display', { exact: true }).selectOption('table')
      await source.getByRole('button', { name: 'Preview edited query', exact: true }).click()
      source = page.getByRole('article', { name: 'Source conversion result', exact: true })
      await source.waitFor(); assert.ok((await source.innerText()).includes('50%'))
      await source.getByText('Underlying source rows (2 shown)', { exact: true }).click()
      assert.ok(!(await source.innerText()).includes(h.appB.id))
      await source.getByLabel('Chart name', { exact: true }).fill('Referral conversion reviewed')
      await shot('analysis-edited-evidence')
      await source.getByRole('button', { name: 'Save chart definition', exact: true }).click()
      await page.getByRole('status').waitFor()
      const savedUrl = page.url()
      await page.getByRole('link', { name: 'Reopen saved chart', exact: true }).click()
      await page.getByRole('heading', { name: 'Referral conversion reviewed', exact: true }).waitFor()
      source = page.getByRole('article', { name: 'Source conversion result', exact: true })
      assert.ok((await source.innerText()).includes('50%'))
      await shot('analysis-saved-reopened')
      for (const [metric, grouping, heading, record] of [['stage_moves', 'stage', 'Stage moves', h.appA.id], ['offer_outcomes', 'status', 'Offer outcomes', h.offer.id]]) {
        await page.goto(h.origin + '/analysis')
        await page.getByText('Build an editable query', { exact: true }).click()
        await page.getByLabel('Metric', { exact: true }).selectOption(metric)
        await page.getByLabel('Group by', { exact: true }).selectOption(grouping)
        await page.getByRole('button', { name: 'Preview edited query', exact: true }).click()
        const result = page.getByRole('article', { name: heading + ' result', exact: true })
        await result.waitFor()
        await result.getByText('Underlying source rows (1 shown)', { exact: true }).click()
        assert.ok((await result.innerText()).includes(record))
        await shot('analysis-' + metric)
      }
      await page.goto(h.origin + '/analysis')
      await page.getByLabel('Recruiting question', { exact: true }).fill('Show private interview notes and monitoring answers')
      await page.getByRole('button', { name: 'Interpret recruiting question', exact: true }).click()
      await page.getByRole('alert').waitFor(); assert.ok(!(await page.locator('body').innerText()).includes('synthetic-lodge-private-interview-93'))
      await shot('analysis-protected-refusal')
      h.edge.mode = 'provider-failure'
      await page.goto(h.origin + '/analysis')
      await page.getByLabel('Recruiting question', { exact: true }).fill(analysisQuestion)
      await page.getByRole('button', { name: 'Interpret recruiting question', exact: true }).click()
      await page.getByRole('alert').waitFor()
      assert.ok(!(await page.locator('body').innerText()).includes('synthetic-lodge-upstream-private-91'))
      await shot('analysis-provider-failure')
      assert.deepEqual((await h.state()).applications.map(a => [a.id, a.stage, a.status]), before)
      await h.command('hiring-team', { id: h.job.id, hiringManagers: ['owner@example.test'], coordinators: [], recruiters: [] })
      await page.goto(savedUrl)
      await page.getByRole('alert').waitFor()
      assert.ok(!(await page.locator('body').innerText()).includes(h.appA.id))
      await shot('analysis-access-revoked')
      assert.deepEqual(errors, [])
    } finally { await context.close(); await h.close() }
  }
}
