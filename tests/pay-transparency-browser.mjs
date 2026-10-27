import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { browserWidths } from './browser-widths.mjs'
import { api, current, session } from './browser-journey.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { BUSINESS } from './harness.mjs'

export async function payWorkspace(browser, root, origin, evidence) {
  await mkdir(evidence, { recursive: true })
  const runId = crypto.randomUUID().slice(0, 8)
  for (const width of browserWidths) {
    const { context, page } = await session(browser, root, origin, 'owner', width)
    const run = (op, body) => api(context, origin, op, body)
    const shot = async name => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' fits viewport')
      await iconTooltips(page)
      await page.screenshot({ path: `${evidence}/${name}-${width}.png`, fullPage: true })
    }
    try {
      await run('business', BUSINESS)
      const email = (await current(context, origin)).actor.email
      const denver = await run('office', { name: 'Denver ' + runId + ' ' + width + ', CO' })
      const nyc = await run('office', { name: 'New York City ' + runId + ' ' + width + ', NY' })
      await page.reload()
      await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'People', exact: true }).click()
      const rules = page.getByRole('region', { name: 'Pay transparency rules' })
      await rules.getByLabel('State or city', { exact: true }).fill('Colorado')
      await rules.getByLabel('Legal review date').fill('2026-01-15')
      await rules.getByLabel('Benefits and bonus text required').check()
      await rules.getByLabel('Salary-history ban', { exact: true }).check()
      await rules.getByRole('button', { name: 'Save reviewed rule' }).click()
      await rules.getByText('Colorado', { exact: true }).waitFor()
      await shot('pay-rules')
      await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Vacancies', exact: true }).click()
      await page.getByText('New vacancy', { exact: true }).click()
      await page.getByLabel('Job title', { exact: true }).fill('Pay proof supervisor ' + runId + ' ' + width)
      await page.locator('select[name="officeId"]').selectOption(denver.id)
      await page.getByLabel(nyc.name, { exact: true }).check()
      await page.getByLabel('Headcount', { exact: true }).fill('1')
      await page.getByLabel('Minimum pay', { exact: true }).fill('60000')
      await page.getByLabel('Maximum pay', { exact: true }).fill('80000')
      await page.getByLabel('Minimum for ' + denver.name, { exact: true }).fill('60000')
      await page.getByLabel('Maximum for ' + denver.name, { exact: true }).fill('80000')
      await page.getByLabel('Minimum for ' + nyc.name, { exact: true }).fill('70000')
      await page.getByLabel('Maximum for ' + nyc.name, { exact: true }).fill('90000')
      await page.getByLabel('Benefits and bonus description').fill('Health insurance; annual bonus eligibility.')
      await shot('pay-terms')
      await page.getByRole('button', { name: 'Create vacancy', exact: true }).click()
      await page.getByRole('heading', { name: 'Pay proof supervisor ' + runId + ' ' + width, exact: true }).waitFor()
      const job = (await current(context, origin)).vacancies.find(v => v.title === 'Pay proof supervisor ' + runId + ' ' + width)
      assert.deepEqual(job.payRanges.map(r => [r.officeId, r.compensation.min, r.compensation.max]), [[denver.id, 6000000, 8000000], [nyc.id, 7000000, 9000000]])
      await run('rubric', { id: job.id, criteria: [{ name: 'Safety', description: 'Describes safe operations' }] })
      await run('interview-plan', { id: job.id, plan: [{ name: 'Safety review', stageName: 'Interview' }] })
      const asked = await run('request-vacancy-approval', { id: job.id, approver: email })
      await page.reload()
      await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Approvals', exact: true }).click()
      const approval = page.locator('#approval-' + asked.id)
      await approval.getByText('Benefits and bonus', { exact: true }).waitFor()
      assert.ok((await approval.innerText()).includes('$70,000–$90,000'))
      await approval.locator('select[name="decision"]').selectOption('approved')
      await approval.getByLabel('Reason', { exact: true }).fill('Reviewed good-faith pay')
      await shot('pay-approval')
      await approval.getByRole('button', { name: 'Record decision', exact: true }).click()
      await approval.waitFor({ state: 'detached' })
      const published = await run('publish', { id: job.id })
      await page.goto(origin + '/jobs/' + published.slug)
      await page.getByText('Health insurance; annual bonus eligibility.', { exact: false }).waitFor()
      await shot('pay-public-job')
      const postJob = await run('job-post', { vacancy: job.id, title: 'Denver pay proof ' + width, locations: [denver.id], destinations: ['careers', 'embed', 'api'] })
      const post = postJob.posts.at(-1)
      await run('post-status', { vacancy: job.id, post: post.id, status: 'live' })
      await page.goto(origin + '/jobs/' + post.slug)
      assert.ok((await page.locator('main').innerText()).includes('$60,000–$80,000'))
      assert.ok(!(await page.locator('main').innerText()).includes('$70,000–$90,000'))
      await shot('pay-public-post')
      const { spanishText } = await import('./languages-driver.mjs')
      const spanishTitle = 'Supervisor de Denver ' + runId + ' ' + width
      const spanishJob = await run('job-post', { vacancy: job.id, title: spanishTitle, language: 'es', locations: [denver.id], destinations: ['careers', 'api'], translation: { ...spanishText({ id: 'synthetic-lodge-question' }), benefits: 'Seguro médico; posibilidad de bono anual.' } })
      const spanish = spanishJob.posts.at(-1)
      await page.goto(origin + '/app')
      await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Vacancies', exact: true }).click()
      await page.getByRole('button', { name: 'Open Pay proof supervisor ' + runId + ' ' + width, exact: true }).click()
      await page.getByText('Change post “' + spanishTitle + '”', { exact: true }).click()
      await page.getByText('Spanish translation for “' + spanishTitle + '”', { exact: true }).click()
      const translatedBenefits = page.getByLabel('Spanish benefits and bonus description', { exact: false })
      await translatedBenefits.fill('Seguro médico; posibilidad de bono anual.')
      await shot('pay-benefits-translation')
      await page.getByLabel('The employer has reviewed these translations', { exact: false }).check()
      await page.getByRole('button', { name: 'Save reviewed translation', exact: true }).click()
      await page.getByText('Saved.', { exact: true }).waitFor()
      await run('post-status', { vacancy: job.id, post: spanish.id, status: 'live' })
      await page.goto(origin + '/jobs/' + spanish.slug)
      await page.getByText('Seguro médico; posibilidad de bono anual.', { exact: false }).waitFor()
      await shot('pay-spanish-post')
      await run('pay-rules', { rules: [] })
    } catch (error) {
      await page.screenshot({ path: `${evidence}/failure-${width}.png`, fullPage: true })
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
    await payWorkspace(browser, process.cwd(), server.origin, process.env.LODGE_EVIDENCE || '.cache/pay-proof')
    console.log('ATTR-004 settings, approved terms and public job and post screens passed at 1440 and 390')
  } finally { await browser?.close(); await server.close() }
}
