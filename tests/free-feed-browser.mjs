import { DOMParser } from '@xmldom/xmldom'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { api, current, session } from './browser-journey.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { BUSINESS } from './harness.mjs'
import { RANGE, RUBRIC } from './hiring-fixture.mjs'

/** Exercise behaviour once at desktop width; capture the changed screens at both release widths. */
export async function freeFeedPage(browser, { root, origin, evidence, ownerEmail }) {
  if (process.env.LODGE_BROWSER_WIDTH === '390') return
  await mkdir(evidence, { recursive: true })
  const { context, page } = await session(browser, root, origin, 'owner', 1440)
  page.setDefaultTimeout(20000)
  const run = (op, body) => api(context, origin, op, body)
  const capture = async name => {
    await iconTooltips(page)
    const small = await page.locator('[aria-label="Free job-board feeds"] :is(p,label,input,select,button,small,summary,a)').evaluateAll(nodes => nodes.filter(n => n.getClientRects().length && parseFloat(getComputedStyle(n).fontSize) < 13).map(n => n.tagName))
    assert.deepEqual(small, [], 'feed text is at least 13px')
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' fits viewport')
      await page.screenshot({ path: `${evidence}/${name}-${width}.png`, fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  try {
    if (!(await current(context, origin)).business) await run('business', BUSINESS)
    ownerEmail ??= (await current(context, origin)).actor.email
    const office = await run('office', { name: 'Feed Denver ' + crypto.randomUUID().slice(0, 8) + ', CO' })
    const title = 'Synthetic native free-feed role ' + office.id.slice(0, 8)
    const job = await run('vacancy', { title, description: 'Maintain safe operations and document every job-related decision. Work with the team to plan clear schedules, communicate progress and review practical safety evidence.', officeId: office.id, manager: ownerEmail, headcount: 1, compensation: RANGE, benefits: 'Health insurance and bonus eligibility.' })
    await run('rubric', { id: job.id, criteria: RUBRIC })
    await run('interview-plan', { id: job.id, plan: [{ name: 'Safety', stageName: 'Interview' }] })
    const approval = await run('request-vacancy-approval', { id: job.id, approver: ownerEmail })
    await run('decide-approval', { id: approval.id, version: approval.version, decision: 'approved', reason: 'Reviewed exact native feed content' })
    await run('publish', { id: job.id })
    await page.reload()
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Vacancies', exact: true }).click()
    await page.getByRole('button', { name: 'Open ' + title, exact: true }).click()
    const postTitle = title + ' Denver post'
    const posts = page.getByRole('region', { name: 'Job posts', exact: true })
    await posts.getByText('Add a post', { exact: true }).click()
    await posts.getByLabel('Post title', { exact: true }).fill(postTitle)
    await posts.getByLabel('On the hosted careers page', { exact: true }).uncheck()
    await posts.getByLabel('In the LinkedIn native feed', { exact: true }).check()
    await posts.getByLabel('In the Indeed native feed', { exact: true }).check()
    await capture('feed-post-destinations')
    await posts.getByRole('button', { name: 'Add post', exact: true }).click()
    await posts.getByText('Change post “' + postTitle + '”', { exact: true }).click()
    await posts.getByRole('button', { name: 'Go live', exact: true }).click()
    const post = (await current(context, origin)).vacancies.find(v => v.id === job.id).posts.at(-1)
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Settings', exact: true }).click()
    const region = page.getByRole('region', { name: 'Free job-board feeds', exact: true })
    const jobSettings = region.locator('details').filter({ has: page.getByText('Feed settings for ' + title, { exact: true }) }).first()
    const postSettings = jobSettings.locator('details').filter({ has: page.getByText('Post: ' + postTitle, { exact: true }) }).first()
    await jobSettings.getByText('Feed settings for ' + title, { exact: true }).click()
    await postSettings.getByText('Post: ' + postTitle, { exact: true }).click()
    const linkedin = postSettings.locator('details').filter({ has: page.locator('summary', { hasText: /^LinkedIn Limited Listings —/ }) }).last()
    await linkedin.locator('summary').first().click()
    await linkedin.getByLabel('Opt this listing into this native feed').check()
    await linkedin.getByLabel('Employer HTTPS website').fill('https://www.example.test')
    await linkedin.getByLabel('Actual LinkedIn Company ID').fill('123456789')
    await linkedin.getByLabel('Public feed contact email').fill(ownerEmail)
    await linkedin.getByLabel('Feed city', { exact: true }).fill('Denver')
    await linkedin.getByLabel('Feed US state abbreviation').fill('CO')
    await linkedin.getByLabel('Feed country code').fill('US')
    await linkedin.getByLabel('Optional credited current member').selectOption(ownerEmail)
    await linkedin.getByLabel('I reviewed this exact content', { exact: false }).check()
    await capture('feed-reviewed-settings')
    await linkedin.getByRole('button', { name: 'Save reviewed feed configuration' }).click()
    await postSettings.getByText('LinkedIn Limited Listings — Ready to serve; listing not confirmed', { exact: true }).waitFor()
    const served = await context.request.get(origin + '/careers/feeds/linkedin.xml')
    assert.equal(served.status(), 200)
    const servedText = await served.text()
    const document = new DOMParser().parseFromString(servedText, 'application/xml')
    const entry = Array.from(document.getElementsByTagName('job')).find(j => j.getElementsByTagName('title')[0].textContent === postTitle)
    assert.ok(entry, 'the selected post is in the served feed')
    const url = entry.getElementsByTagName('applyUrl')[0].textContent
    await page.reload()
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Settings', exact: true }).click()
    await jobSettings.getByText('Feed settings for ' + title, { exact: true }).click()
    await postSettings.getByText('Post: ' + postTitle, { exact: true }).click()
    await postSettings.getByText('LinkedIn Limited Listings — Feed served, listing not confirmed', { exact: true }).waitFor()
    await capture('feed-served-unconfirmed')
    await page.goto(url)
    await page.getByRole('heading', { name: postTitle, exact: true }).waitFor()
    await capture('feed-hosted-apply')
    await page.getByLabel('Full name', { exact: true }).fill('Synthetic Feed Applicant')
    const email = ['synthetic-lodge-feed-' + office.id.slice(0, 8), 'example.test'].join('@')
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel('I have read privacy notice', { exact: false }).check()
    await page.getByRole('button', { name: 'Submit application', exact: true }).click()
    await page.getByRole('heading', { name: 'Application received', exact: true }).waitFor()
    await capture('feed-submission-receipt')
    const w = await current(context, origin), person = w.candidates.find(c => c.email === email)
    const app = w.applications.find(a => a.candidate === person.id)
    assert.equal(app.post, post.id)
    assert.equal(app.source, 'LinkedIn Limited Listing')
    assert.equal(app.credit.who, ownerEmail)
    assert.equal(app.sourceProvenance.verifiedProviderReferral, false)
    console.log('PROBE ATTR-003 settings and hosted application: reviewed opt-in -> served but unconfirmed XML -> declared source and CRM credit on native receipt')
  } catch (error) {
    await page.screenshot({ path: evidence + '/failure.png', fullPage: true })
    console.error('Visible alerts:', await page.getByRole('alert').allTextContents())
    throw error
  } finally { await context.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { start, freePort } = await import('./browser-runtime.mjs')
  const { chromium } = await import('@playwright/test')
  const server = await start(process.cwd(), await freePort())
  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.LODGE_CHROMIUM_EXECUTABLE, args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
    await freeFeedPage(browser, { root: process.cwd(), origin: server.origin, evidence: process.env.LODGE_EVIDENCE ?? '.cache/free-feed-proof' })
  } finally { await browser?.close(); await server.close() }
}
