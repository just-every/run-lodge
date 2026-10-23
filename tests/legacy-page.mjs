import { browserWidths } from './browser-widths.mjs'
// MIG-009: existing embedded careers links select the mapped source/job and accept an application.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { legacyJob } from './legacy-links.mjs'

export async function legacyPage(browser, { lodge, site, run, state, ownerEmail, evidence }) {
  // Matching IDs on different sources must never choose the other source's job.
  const oldId = 'previous-crew-42'
  const routes = [
    { source: 'greenhouse', job: await legacyJob(run, state, ownerEmail, 'Cutover crew lead'), query: 'gh_jid=' + oldId },
    { source: 'workable', job: await legacyJob(run, state, ownerEmail, 'Workable crew lead'), query: 'legacy-source=workable&legacy-parameter=wjob&wjob=' + oldId + '&gh_jid=' + oldId },
  ]
  for (const route of routes) {
    const { source, job } = route
    await run('legacy-link', { source, sourceId: oldId, sourceUrl: `https://source.example.test/${source}/${oldId}`, vacancy: job.id })
    for (const width of browserWidths) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } })
      try {
        const page = await context.newPage(), errors = []
        page.on('pageerror', e => errors.push(e.message))
        await page.goto(`${site}/embed-host?lodge=${encodeURIComponent(lodge)}&${route.query}&utm_source=old-${source}`)
        const frame = page.frameLocator('iframe[title="Open roles"]')
        await frame.getByRole('heading', { name: job.title, exact: true }).waitFor()
        await frame.getByLabel('Full name').fill(`Cutover ${source} Applicant ${width}`)
        const email = `cutover-${source}-${width}@example.test`
        await frame.getByLabel('Email', { exact: true }).fill(email)
        await frame.getByLabel('I have read privacy notice', { exact: false }).check()
        assert.equal(await frame.locator('html').evaluate(el => el.scrollWidth > innerWidth + 1), false, `legacy form fits ${width}`)
        await page.screenshot({ path: join(evidence, `legacy-${source}-embed-${width}.png`), fullPage: true })
        await frame.getByRole('button', { name: 'Submit application' }).click()
        await frame.getByRole('heading', { name: 'Application received' }).waitFor()
        const w = await state(), candidate = w.candidates.find(c => c.email === email)
        assert.ok(w.applications.some(a => a.candidate === candidate.id && a.vacancy === job.id && a.campaign.utm_source === 'old-' + source))
        await page.screenshot({ path: join(evidence, `legacy-${source}-receipt-${width}.png`), fullPage: true })
        await page.goto(`${lodge}/jobs/legacy/${source}/${oldId}`)
        await page.getByRole('heading', { name: job.title, exact: true }).waitFor()
        assert.equal(new URL(page.url()).pathname, '/jobs/' + job.slug)
        await page.screenshot({ path: join(evidence, `legacy-${source}-hosted-${width}.png`), fullPage: true })
        if (source === 'workable') {
          // A configured snippet with no old job parameter remains an ordinary job board.
          await page.goto(`${site}/embed-host?lodge=${encodeURIComponent(lodge)}&legacy-source=workable&legacy-parameter=wjob&gh_jid=${oldId}`)
          await frame.getByRole('heading', { name: /^Open roles/ }).waitFor()
          await frame.getByRole('link', { name: job.title, exact: true }).waitFor()
          // Repeated IDs are ambiguous rather than a request to choose the first one.
          await page.goto(`${site}/embed-host?lodge=${encodeURIComponent(lodge)}&legacy-source=workable&legacy-parameter=wjob&wjob=${oldId}&wjob=other`)
          await frame.getByRole('heading', { name: 'This role is not available' }).waitFor()
          assert.ok(!(await frame.locator('body').textContent()).includes(job.title))
          await page.screenshot({ path: join(evidence, `legacy-${source}-ambiguous-${width}.png`), fullPage: true })
        }
        assert.deepEqual(errors, [])
      } finally { await context.close() }
    }
  }
  // Neutral confidential listings cannot be disclosed through any old source's link.
  for (const { source, job, query } of routes) {
    await run('vacancy-privacy', { id: job.id, confidential: true, publicTitle: 'Neutral listing', namedPeople: [] })
    for (const width of browserWidths) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } })
      try {
        const page = await context.newPage()
        assert.equal((await page.goto(`${lodge}/jobs/legacy/${source}/${oldId}`)).status(), 404)
        await page.getByRole('link', { name: 'See open roles' }).waitFor()
        assert.ok(!(await page.textContent('body')).includes(job.title))
        assert.equal(await page.locator('html').evaluate(el => el.scrollWidth > innerWidth + 1), false)
        await page.screenshot({ path: join(evidence, `legacy-${source}-unavailable-${width}.png`), fullPage: true })
        await page.goto(`${site}/embed-host?lodge=${encodeURIComponent(lodge)}&${query}`)
        const frame = page.frameLocator('iframe[title="Open roles"]')
        await frame.getByRole('heading', { name: 'This role is not available' }).waitFor()
        assert.ok(!(await frame.locator('body').textContent()).includes(job.title))
        assert.equal(await frame.locator('html').evaluate(el => el.scrollWidth > innerWidth + 1), false)
        await page.screenshot({ path: join(evidence, `legacy-${source}-embed-unavailable-${width}.png`), fullPage: true })
      } finally { await context.close() }
    }
    await run('legacy-link', { source, sourceId: oldId, remove: true })
  }
}
