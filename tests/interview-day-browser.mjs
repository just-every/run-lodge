import assert from 'node:assert/strict'
import { browserWidths } from './browser-widths.mjs'
import { session, current } from './browser-journey.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { RANGE, RUBRIC } from './hiring-fixture.mjs'

/** The native Settings and application doors, with draft-only human review. */
export async function interviewDayPage(browser, { root, origin, run, evidence, ownerEmail }) {
  const address = n => ['synthetic-lodge-day-' + n, 'example.test'].join('@')
  const members = [address(1), address(2)]
  for (const [i, email] of members.entries()) await run('member', { email, roles: ['interviewer'], name: ['Synthetic East', 'Synthetic West'][i] })
  let job = await run('vacancy', { title: 'Synthetic interview-day role', location: 'New York', headcount: 1, compensation: RANGE, manager: ownerEmail })
  await run('rubric', { id: job.id, criteria: RUBRIC })
  job = await run('interview-plan', { id: job.id, plan: ['Safety session', 'Work session', 'Team session'].map(name => ({ name, stageName: 'Interview', durationMinutes: 30 })) })
  const approval = await run('request-vacancy-approval', { id: job.id, approver: ownerEmail })
  await run('decide-approval', { id: approval.id, version: approval.version, decision: 'approved', reason: 'Synthetic proof' })
  await run('publish', { id: job.id })
  const app = (await run('candidate', { vacancy: job.id, name: 'Synthetic interview-day applicant', email: address(3), source: 'Careers page', consentBasis: 'application' })).application
  for (const width of browserWidths) {
    const owner = await session(browser, root, origin, 'owner', width), { page } = owner, errors = []
    page.on('pageerror', e => errors.push(e.message))
    const fits = async () => { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'interview day fits ' + width); await iconTooltips(page) }
    try {
      await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Settings', exact: true }).click()
      const settings = page.getByRole('region', { name: 'Interviewer pool settings' })
      await settings.getByLabel('Configure job').selectOption(job.id)
      if (width === 1440 || !(await settings.locator('[name="poolName"]').inputValue())) {
        await settings.getByLabel('Pool name', { exact: true }).fill('Declared safety pool')
        await settings.getByRole('button', { name: 'Add pool member', exact: true }).click()
        for (let i = 0; i < 2; i++) {
          const field = name => settings.locator('[name="' + name + i + '"]')
          await field('member').selectOption(members[i])
          await field('qualifications').fill('safety')
          await field('zone').fill(i ? 'America/Los_Angeles' : 'America/New_York')
          await field('cap').fill('2')
          await field('break').fill('15')
          await field('workStart').fill(i ? '07:00' : '09:00')
          await field('availability').fill(i ? '2027-03-15T07:00, 2027-03-15T14:00' : '2027-03-15T10:00, 2027-03-15T17:00')
          await field('evidence').fill('Employer recorded availability and safety qualification')
        }
        await settings.locator('[name="room0"]').fill('North room')
        await settings.locator('[name="roomAvailability0"]').fill('2027-03-15T10:00, 2027-03-15T17:00')
        await settings.locator('[name="roomEvidence0"]').fill('Employer declared room availability')
        await settings.getByRole('button', { name: 'Save declared pool', exact: true }).click()
        await page.getByText('Saved.', { exact: true }).waitFor()
      }
      await fits()
      await page.screenshot({ path: evidence + '/interview-pool-settings-' + width + '.png', fullPage: true })
      await page.goto(origin + '/app?application=' + app.id)
      await page.getByRole('tab', { name: 'Interviews', exact: true }).click()
      const planner = page.getByRole('region', { name: 'Interview day planner' })
      await planner.getByText('Build draft alternatives', { exact: true }).click()
      await planner.getByLabel('Candidate time zone', { exact: true }).fill('America/New_York')
      await planner.getByLabel('Recorded candidate availability', { exact: true }).fill('2027-03-15T10:00, 2027-03-15T17:00')
      for (let i = 0; i < 3; i++) {
        await planner.locator('[name="requires' + i + '"]').fill('safety')
        await planner.locator('[name="required' + i + '"]').fill(i < 2 ? members[i] : '')
        await planner.locator('[name="starts' + i + '"]').fill('2027-03-15T' + [10, 11, 12][i] + ':00')
        await planner.locator('[name="useRoom' + i + '"]').selectOption('North room')
      }
      await planner.getByRole('button', { name: 'Find draft panels', exact: true }).click()
      const draft = planner.getByRole('article', { name: 'Draft alternatives' }).last()
      await draft.getByText('Awaiting human review', { exact: true }).waitFor()
      if (width === 1440) {
        assert.equal(await draft.getByRole('region', { name: /^Alternative / }).count(), 2)
        assert.ok((await draft.innerText()).includes('7:00 a.m. PDT'), 'Pacific participant sees the correct daylight-saving time')
        assert.ok((await planner.innerText()).includes('Provider and resource availability unverified'))
      }
      await fits()
      await page.screenshot({ path: evidence + '/interview-day-alternatives-' + width + '.png', fullPage: true })
      const before = await current(owner.context, origin)
      await draft.getByRole('button', { name: 'Review draft alternative 1', exact: true }).click()
      await draft.getByText('Draft reviewed', { exact: true }).waitFor()
      if (width === 1440) {
        const after = await current(owner.context, origin)
        assert.deepEqual(after.interviews, before.interviews)
        assert.deepEqual(after.scorecards, before.scorecards)
        assert.deepEqual(after.applications.find(a => a.id === app.id), before.applications.find(a => a.id === app.id))
        assert.ok((await draft.innerText()).includes('No production changes were applied'))
      }
      await fits()
      await page.screenshot({ path: evidence + '/interview-day-reviewed-' + width + '.png', fullPage: true })
      assert.deepEqual(errors, [])
    } catch (e) {
      await page.screenshot({ path: evidence + '/interview-day-failure-' + width + '.png', fullPage: true })
      throw e
    } finally { await owner.context.close() }
  }
}
