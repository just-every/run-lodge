import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { api, current, session } from './browser-journey.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { structuredListings } from './office-job-posting-flow.mjs'
import { BUSINESS } from './harness.mjs'

/** Real review forms and resulting public state; assertions at 1440, screen proof at both widths. */
export async function officeJobPostingPage(browser, { root, origin, evidence }) {
  await mkdir(evidence, { recursive: true })
  const owner = await session(browser, root, origin, 'owner', 1440)
  let manager, publicContext
  const { context, page } = owner, run = (op, body) => api(context, origin, op, body)
  const errors = [], external = []
  const listen = p => { p.on('pageerror', error => errors.push(error.message)); p.on('request', req => { if (/^https?:/.test(req.url()) && new URL(req.url()).origin !== origin) external.push(req.url()) }) }
  const capture = async (p, name) => {
    await iconTooltips(p)
    for (const width of [1440, 390]) {
      await p.setViewportSize({ width, height: 1000 })
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' fits viewport ' + width)
      await p.screenshot({ path: `${evidence}/office-job-posting-${name}-${width}.png`, fullPage: true })
    }
    await p.setViewportSize({ width: 1440, height: 1000 })
  }
  listen(page)
  try {
    if (!(await current(context, origin)).business) await run('business', BUSINESS)
    const initial = await current(context, origin), ownerEmail = initial.actor.email
    const tag = crypto.randomUUID().slice(0, 8)
    const managerEmail = ['manager', 'dev.localhost'].join('@')
    const existingManager = initial.members?.find(m => m.email === managerEmail)
    if (!existingManager) await run('member', { email: managerEmail, name: 'Synthetic office manager', roles: ['manager'] })
    const office = await run('office', { name: 'Synthetic Denver office ' + tag })
    const level = await run('permission-level', { name: 'Synthetic listing settings ' + crypto.randomUUID().slice(0, 8), permissions: ['settings'] })
    await run('member-org', { email: managerEmail, grantOffices: [office.id], grantLevels: { [office.id]: level.id } })
    let job = await run('vacancy', { title: 'Synthetic reviewed listing ' + tag, officeId: office.id, manager: ownerEmail, headcount: 1, employmentType: 'full-time', compensation: { currency: 'USD', min: 6000000, max: 8000000, period: 'year' }, description: 'Coordinate safe operations.' })
    await run('rubric', { id: job.id, criteria: [{ name: 'Safety', description: 'Explains safe work' }] })
    await run('interview-plan', { id: job.id, plan: [{ name: 'Safety discussion', stageName: 'Interview' }] })
    const asked = await run('request-vacancy-approval', { id: job.id, approver: ownerEmail })
    await run('decide-approval', { id: asked.id, version: asked.version, decision: 'approved', reason: 'Synthetic approved terms' })
    await run('publish', { id: job.id })
    job = await run('job-post', { vacancy: job.id, title: 'Synthetic Denver supervisor ' + tag, description: 'Lead safe operations in Denver.', locations: [office.id], destinations: ['careers'] })
    const post = job.posts.at(-1)
    await run('post-status', { vacancy: job.id, post: post.id, status: 'live' })
    const openReview = async p => {
      await p.goto(origin + '/app?settings=job-posting')
      await p.getByText('Review listing “' + post.title + '”', { exact: true }).click()
      return p.locator('[id="job-posting-' + post.id + '"]')
    }
    let form = await openReview(page)
    await form.getByText('Structured listing off', { exact: true }).waitFor()
    await form.getByLabel('Employer name', { exact: false }).fill(initial.business?.name ?? BUSINESS.name)
    await form.getByLabel('Employer website', { exact: true }).fill('https://employer.example.test/')
    await form.getByLabel('Original posting date', { exact: true }).fill('2026-01-01')
    await form.getByLabel('Listing expiry date', { exact: true }).fill('2099-12-31')
    await form.locator('select[name="employmentType"]').selectOption('full-time')
    for (const [label, value] of [['Street address', '100 Synthetic Street'], ['City', 'Denver'], ['State or region', 'CO'], ['Postal code', '80202'], ['Country code', 'US']]) await form.getByLabel(label, { exact: true }).fill(value)
    await form.getByLabel('The employer reviewed', { exact: false }).check()
    await capture(page, 'review')
    await form.getByRole('button', { name: 'Review and publish structured listing', exact: true }).click()
    await form.getByText('Structured listing published', { exact: true }).waitFor()
    const saved = (await current(context, origin)).vacancies.find(v => v.id === job.id).jobPostingSettings.find(x => x.post === post.id)
    assert.equal(saved.review.reviewedBy, ownerEmail)
    assert.equal(saved.review.metadata.addresses[0].streetAddress, '100 Synthetic Street')
    manager = await session(browser, root, origin, 'manager', 1440); listen(manager.page)
    form = await openReview(manager.page)
    await form.getByLabel('The employer reviewed', { exact: false }).check()
    await form.getByRole('button', { name: 'Review and publish structured listing', exact: true }).click()
    await form.getByText('Last review by ' + managerEmail, { exact: false }).waitFor()
    assert.equal((await current(context, origin)).vacancies.find(v => v.id === job.id).jobPostingSettings.find(x => x.post === post.id).review.reviewedBy, managerEmail)
    publicContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const publicPage = await publicContext.newPage(); listen(publicPage)
    await publicPage.goto(origin + '/jobs/' + post.slug)
    await publicPage.getByRole('heading', { name: post.title, exact: true }).waitFor()
    assert.deepEqual(structuredListings(await publicPage.content()).map(p => [p.title, p.description, p.employmentType, p.baseSalary.value.minValue, p.baseSalary.value.maxValue]), [[post.title, 'Lead safe operations in Denver.', 'FULL_TIME', 60000, 80000]])
    const text = await publicPage.locator('main').innerText()
    for (const expected of ['Full-time', '$60,000–$80,000', '100 Synthetic Street', '2026-01-01', '2099-12-31']) assert.ok(text.includes(expected), expected)
    assert.ok(!text.includes(managerEmail))
    await capture(publicPage, 'published')
    await run('member-org', { email: managerEmail, grantOffices: [] })
    await publicPage.reload()
    assert.deepEqual(structuredListings(await publicPage.content()), [])
    await publicPage.getByRole('heading', { name: post.title, exact: true }).waitFor()
    assert.ok(!(await publicPage.locator('main').innerText()).includes(managerEmail))
    await capture(publicPage, 'withheld')
    const ownerForm = await openReview(page)
    await ownerForm.getByText('Structured listing withheld', { exact: true }).waitFor()
    await capture(page, 'state')
    assert.deepEqual(errors, [], 'review and public pages have no runtime errors')
    assert.deepEqual(external, [], 'no browser provider request')
    await run('close-vacancy', { id: job.id, reason: 'Synthetic browser proof complete' })
    await run('member-org', { email: managerEmail, department: existingManager?.departmentId, office: existingManager?.officeId, grantDepartments: existingManager?.grantDepartments ?? [], grantOffices: existingManager?.grantOffices ?? [], grantLevels: existingManager?.grantLevels ?? {} })
    console.log('PROBE ATTR-015 4: actual owner and office-manager review form -> saved readback and accurate public listing; changed screens captured at 1440 and 390; Google admission unclaimed')
  } catch (error) {
    await page.screenshot({ path: evidence + '/office-job-posting-failure.png', fullPage: true })
    console.error('Review alerts:', await page.getByRole('alert').allTextContents())
    throw error
  } finally { await publicContext?.close(); await manager?.context.close(); await context.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { start, freePort } = await import('./browser-runtime.mjs')
  const { chromium } = await import('@playwright/test')
  const server = await start(process.cwd(), await freePort())
  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.LODGE_CHROMIUM_EXECUTABLE, args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
    await officeJobPostingPage(browser, { root: process.cwd(), origin: server.origin, evidence: process.env.LODGE_EVIDENCE ?? '.cache/office-job-posting-proof' })
  } finally { await browser?.close(); await server.close() }
}
