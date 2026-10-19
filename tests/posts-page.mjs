// ATTR-012 in a browser: the people who run a job add a post with its own title
// and one of the job's approved offices, put it live, and the careers page lists
// the post in place of the job, at each width.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { current, session } from './browser-journey.mjs'

/** A job approved for two offices; at each width a new post goes live through the app and opens from /jobs. */
export async function postsPage(browser, { root, origin, run, offices, evidence }) {
  const job = await run('vacancy', { title: 'Yard hand', officeId: offices[0].id, locations: [offices[1].id], headcount: 2, manager: 'manager@dev.localhost', compensation: { currency: 'USD', min: 4200000, max: 4800000, period: 'year' }, description: 'Load and stack.' })
  await run('rubric', { id: job.id, criteria: [{ name: 'Safety', description: 'Works safely around loaders' }] })
  await run('interview-plan', { id: job.id, plan: [{ name: 'Walk', stageName: 'Interview', durationMinutes: 30 }] })
  const asked = await run('request-vacancy-approval', { id: job.id, approver: 'approver@dev.localhost' })
  const approver = await session(browser, root, origin, 'approver', 1440)
  const version = (await current(approver.context, origin)).approvals.find(x => x.id === asked.id).currentVersion
  await run('decide-approval', { id: asked.id, decision: 'approved', reason: 'Budgeted', version }, approver.context)
  await approver.context.close()
  await run('publish', { id: job.id })
  for (const width of [1440, 390]) {
    const title = `Yard hand — ${offices[1].name} ${width}`
    const owner = await session(browser, root, origin, 'owner', width)
    try {
      const page = owner.page
      await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Vacancies', exact: true }).click()
      await page.getByRole('button', { name: 'Open Yard hand' }).click()
      const posts = page.getByRole('region', { name: 'Job posts' })
      await posts.getByText('Add a post', { exact: true }).click()
      const add = posts.locator('details', { has: page.getByText('Add a post', { exact: true }) })
      await add.getByLabel('Post title').fill(title)
      await add.getByLabel(offices[1].name, { exact: true }).check()
      await add.getByRole('button', { name: 'Add post' }).click()
      await posts.getByText(`Change post “${title}”`).click()
      await posts.locator('details', { has: page.getByText(`Change post “${title}”`) }).getByRole('button', { name: 'Go live' }).click()
      await posts.locator('tr', { hasText: title }).getByText('live', { exact: true }).waitFor()
      const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }))
      assert.ok(scroll <= inner + 1, `job posts at ${width}: no sideways scrolling (${scroll} > ${inner})`)
      await page.screenshot({ path: join(evidence, `job-posts-${width}.png`), fullPage: true })
    } finally { await owner.context.close() }
    const visitor = await browser.newContext({ viewport: { width, height: 1000 } })
    try {
      const page = await visitor.newPage()
      await page.goto(origin + '/jobs')
      assert.equal(await page.getByRole('link', { name: 'Yard hand', exact: true }).count(), 0, 'the job’s own page gives way to its live posts')
      await page.getByRole('link', { name: title, exact: true }).click()
      await page.getByRole('heading', { name: title }).waitFor()
      assert.ok((await page.textContent('main')).includes(offices[1].name), 'the post shows its own office')
      await page.screenshot({ path: join(evidence, `job-post-page-${width}.png`), fullPage: true })
    } finally { await visitor.close() }
  }
}
