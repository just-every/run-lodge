import assert from 'node:assert/strict'
import { browserWidths } from './browser-widths.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { session } from './browser-journey.mjs'
import { RANGE, RUBRIC } from './hiring-fixture.mjs'

/** The shipped workspace, using only native command, page, drill and download doors. */
export async function cohortReportPage(browser, { root, origin, run, evidence, ownerEmail }) {
  const create = async title => {
    const job = await run('vacancy', { title, location: 'New York, NY', headcount: 1, compensation: RANGE, manager: ownerEmail })
    await run('rubric', { id: job.id, criteria: RUBRIC })
    await run('interview-plan', { id: job.id, plan: [{ name: 'Work review', stageName: 'Interview' }] })
    const asked = await run('request-vacancy-approval', { id: job.id, approver: ownerEmail })
    await run('decide-approval', { id: asked.id, version: asked.version, decision: 'approved', reason: 'Reviewed for hiring' })
    return run('publish', { id: job.id })
  }
  const job = await create('Synthetic cohort browser north'), other = await create('Synthetic cohort browser south')
  const add = async (name, vacancy, number) => (await run('candidate', { name, email: 'synthetic-lodge-browser-' + number + '@example.test', source: 'Careers page', consentBasis: 'application', vacancy })).application
  const hired = await add('Synthetic cohort hire', job.id, 1)
  const rejected = await add('Synthetic cohort close', job.id, 2)
  const withdrawn = await add('Synthetic cohort withdrawal', other.id, 3)
  const offer = await run('offer', { application: hired.id, opening: job.openings[0].id, title: job.title, startDate: '2027-01-01', salary: { currency: 'USD', amount: 9500000, period: 'year' } })
  const approval = await run('request-offer-approval', { id: offer.id, approver: ownerEmail })
  await run('decide-approval', { id: approval.id, version: approval.version, decision: 'approved', reason: 'Reviewed offer' })
  await run('offer-outcome', { id: offer.id, outcome: 'accepted', reason: 'Accepted outside Lodge' })
  await run('move', { application: rejected.id, to: 'rejected', closeReason: 'certification', reason: 'Required credential absent' })
  await run('move', { application: withdrawn.id, to: 'withdrawn', closeReason: 'pay', reason: 'Candidate withdrew' })
  for (const width of browserWidths) {
    const owner = await session(browser, root, origin, 'owner', width), page = owner.page, errors = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Overview', exact: true }).click()
      await page.getByRole('button', { name: 'Recruiting cohort report', exact: true }).click()
      const results = page.getByRole('region', { name: 'Cohort results' })
      await results.waitFor()
      await page.getByLabel('Job', { exact: true }).selectOption(job.id)
      await page.getByRole('button', { name: 'Apply cohort filters', exact: true }).click()
      await results.getByText('2 applications · 1 measured hires', { exact: false }).waitFor()
      await page.getByText('Submission dates:', { exact: false }).filter({ hasText: 'Any to Any' }).waitFor()
      if (width === 1440) {
        assert.equal(await results.getByRole('button', { name: 'Synthetic cohort withdrawal', exact: true }).count(), 0)
        assert.ok((await results.innerText()).includes('2 applications · 1 measured hires'))
        const href = await results.getByRole('link', { name: 'Export cohort report', exact: true }).getAttribute('href')
        const downloaded = await owner.context.request.get(origin + href)
        assert.equal(downloaded.status(), 200)
        const data = await downloaded.json()
        assert.deepEqual(data.rows.map(r => r.application).sort(), [hired.id, rejected.id].sort())
        assert.deepEqual(data.reasons.map(r => [r.reason, r.count]), [['certification', 1]])
        assert.equal(data.totals.measuredHires, 1)
        assert.equal(data.rows.find(r => r.application === hired.id).timing, 'Measured')
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'cohort report fits ' + width)
      await iconTooltips(page)
      await page.screenshot({ path: evidence + '/cohort-report-' + width + '.png', fullPage: true })
      await results.getByRole('button', { name: 'Synthetic cohort hire', exact: true }).click()
      await page.getByRole('heading', { name: 'Synthetic cohort hire', exact: true }).waitFor()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'cohort drill fits ' + width)
      await iconTooltips(page)
      await page.screenshot({ path: evidence + '/cohort-drill-' + width + '.png', fullPage: true })
      assert.deepEqual(errors, [])
    } finally { await owner.context.close() }
  }
}
