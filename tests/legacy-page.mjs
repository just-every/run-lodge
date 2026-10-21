// MIG-009: the employer's existing embedded careers link opens the mapped role and accepts an application.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { legacyJob } from './legacy-links.mjs'

export async function legacyPage(browser, { lodge, site, run, state, ownerEmail, evidence }) {
  const job = await legacyJob(run, state, ownerEmail, 'Cutover crew lead')
  await run('legacy-link', { source: 'greenhouse', sourceId: 'previous-crew-42', sourceUrl: 'https://boards.greenhouse.io/example/jobs/previous-crew-42', vacancy: job.id })
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } })
    try {
      const page = await context.newPage(), errors = []
      page.on('pageerror', e => errors.push(e.message))
      await page.goto(`${site}/embed-host?lodge=${encodeURIComponent(lodge)}&gh_jid=previous-crew-42&utm_source=old-email`)
      const frame = page.frameLocator('iframe[title="Open roles"]')
      await frame.getByRole('heading', { name: job.title, exact: true }).waitFor()
      await frame.getByLabel('Full name').fill('Cutover Applicant ' + width)
      await frame.getByLabel('Email', { exact: true }).fill(`cutover-${width}@example.test`)
      await frame.getByLabel('I have read privacy notice', { exact: false }).check()
      const overflow = await frame.locator('html').evaluate(el => el.scrollWidth > innerWidth + 1)
      assert.equal(overflow, false, `legacy form fits ${width}`)
      await page.screenshot({ path: join(evidence, `legacy-embed-${width}.png`), fullPage: true })
      await frame.getByRole('button', { name: 'Submit application' }).click()
      await frame.getByRole('heading', { name: 'Application received' }).waitFor()
      const w = await state(), candidate = w.candidates.find(c => c.email === `cutover-${width}@example.test`)
      assert.ok(w.applications.some(a => a.candidate === candidate.id && a.vacancy === job.id && a.campaign.utm_source === 'old-email'))
      await page.screenshot({ path: join(evidence, `legacy-receipt-${width}.png`), fullPage: true })
      await page.goto(lodge + '/jobs/legacy/greenhouse/previous-crew-42')
      await page.getByRole('heading', { name: job.title, exact: true }).waitFor()
      assert.equal(new URL(page.url()).pathname, '/jobs/' + job.slug)
      await page.screenshot({ path: join(evidence, `legacy-hosted-${width}.png`), fullPage: true })
      assert.deepEqual(errors, [])
    } finally { await context.close() }
  }
  // A neutral confidential listing still must not be disclosed by the old link.
  await run('vacancy-privacy', { id: job.id, confidential: true, publicTitle: 'Neutral listing', namedPeople: [] })
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } })
    try {
      const page = await context.newPage()
      assert.equal((await page.goto(lodge + '/jobs/legacy/greenhouse/previous-crew-42')).status(), 404)
      await page.getByRole('link', { name: 'See open roles' }).waitFor()
      assert.ok(!(await page.textContent('body')).includes(job.title))
      assert.equal(await page.locator('html').evaluate(el => el.scrollWidth > innerWidth + 1), false)
      await page.screenshot({ path: join(evidence, `legacy-unavailable-${width}.png`), fullPage: true })
    } finally { await context.close() }
  }
  await run('legacy-link', { source: 'greenhouse', sourceId: 'previous-crew-42', remove: true })
}
