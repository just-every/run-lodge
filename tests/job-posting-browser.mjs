import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { browserWidths } from './browser-widths.mjs'
import { api, current, session } from './browser-journey.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { BUSINESS } from './harness.mjs'

export async function jobPostingPage(browser, { root, origin, evidence }) {
  await mkdir(evidence, { recursive: true })
  const runId = crypto.randomUUID().slice(0, 8)
  for (const width of browserWidths) {
    const { context, page } = await session(browser, root, origin, 'owner', width)
    try {
      const run = (op, body) => api(context, origin, op, body)
      await run('business', BUSINESS)
      const email = (await current(context, origin)).actor.email
      const office = await run('office', { name: 'Synthetic Denver ' + runId + ' ' + width + ', CO' })
      let job = await run('vacancy', { title: 'Structured data role ' + runId + ' ' + width, description: 'Run safe sites and train staff.', officeId: office.id, manager: email, employmentType: 'part-time', headcount: 1, compensation: { currency: 'USD', min: 1950, max: 2575, period: 'hour' } })
      await run('rubric', { id: job.id, criteria: [{ name: 'Safety', description: 'Describe relevant work' }] })
      await run('interview-plan', { id: job.id, plan: [{ name: 'Discussion', stage: job.stages[1].id }] })
      const asked = await run('request-vacancy-approval', { id: job.id, approver: email })
      await run('decide-approval', { id: asked.id, decision: 'approved', reason: 'Reviewed exact terms', version: asked.version })
      await run('publish', { id: job.id })
      job = await run('job-post', { vacancy: job.id, title: job.title + ' careers', description: 'Run safe sites and train staff.', locations: [office.id], destinations: ['careers'] })
      const post = job.posts.at(-1)
      await run('post-status', { vacancy: job.id, post: post.id, status: 'live' })
      await page.reload()
      await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Vacancies', exact: true }).click()
      await page.getByRole('button', { name: 'Open ' + job.title, exact: true }).click()
      await page.getByText('Change post “' + post.title + '”', { exact: true }).click()
      await page.getByText('Google job structured data for “' + post.title + '”', { exact: true }).click()
      await page.getByLabel('The employer reviewed these current sources', { exact: false }).check()
      await page.getByLabel('Employer website (HTTPS)', { exact: true }).fill('https://synthetic-lodge.example/employer')
      await page.getByLabel('Actual original posting date', { exact: true }).fill('2026-01-15')
      await page.getByLabel('Application closing date', { exact: true }).fill('2099-12-31')
      await page.getByLabel('Street address for ' + office.name, { exact: true }).fill('100 Synthetic Street')
      await page.getByLabel('City for ' + office.name, { exact: true }).fill('Denver')
      await page.getByLabel('State for ' + office.name, { exact: true }).fill('CO')
      await page.getByLabel('Postal code for ' + office.name, { exact: true }).fill('80202')
      await page.getByRole('button', { name: 'Save structured data review', exact: true }).click()
      await page.getByText('Employer review recorded;', { exact: false }).waitFor()
      await iconTooltips(page)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'review fits viewport')
      await page.screenshot({ path: `${evidence}/structured-review-${width}.png`, fullPage: true })
      await page.goto(origin + '/jobs/' + post.slug)
      const data = await page.locator('script[type="application/ld+json"]').textContent()
      const posting = JSON.parse(data)
      assert.equal(posting.title, await page.locator('h1').textContent())
      assert.equal(posting.description, '<p>Run safe sites and train staff.</p>')
      assert.equal(posting.baseSalary.value.minValue, 19.5)
      assert.equal(posting.baseSalary.value.maxValue, 25.75)
      assert.ok((await page.locator('main').innerText()).includes('$19.50–$25.75'))
      assert.ok((await page.locator('main').innerText()).includes('Part-time'))
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'listing fits viewport')
      await page.screenshot({ path: `${evidence}/structured-public-${width}.png`, fullPage: true })
      await run('post-status', { vacancy: job.id, post: post.id, status: 'paused' })
      await page.reload()
      assert.equal(await page.locator('script[type="application/ld+json"]').count(), 0)
    } catch (error) {
      await page.screenshot({ path: `${evidence}/structured-failure-${width}.png`, fullPage: true })
      console.error('Visible errors:', await page.getByRole('alert').allTextContents())
      throw error
    } finally { await context.close() }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { start, freePort } = await import('./browser-runtime.mjs')
  const { chromium } = await import('@playwright/test')
  const server = await start(process.cwd(), await freePort())
  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.LODGE_CHROMIUM_EXECUTABLE, args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
    await jobPostingPage(browser, { root: process.cwd(), origin: server.origin, evidence: process.env.LODGE_EVIDENCE || '.cache/structured-proof' })
    console.log('ATTR-002 structured review and native listing browser proof passed')
  } finally { await browser?.close(); await server.close() }
}
