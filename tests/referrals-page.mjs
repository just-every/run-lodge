import assert from 'node:assert/strict'
import { join } from 'node:path'
import { session, current } from './browser-journey.mjs'

async function shot(page, evidence, name, width) {
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }))
  assert.ok(dimensions.scroll <= dimensions.width + 1, `CRM-003 ${name} fits ${width}`)
  await page.screenshot({ path: join(evidence, `referrals-${name}-${width}.png`), fullPage: true })
}
export async function referralsPage(browser, { root, origin, run, evidence, ownerEmail }) {
  const v = await run('vacancy', { title: 'Referral field supervisor', manager: ownerEmail, location: 'Brooklyn, NY', headcount: 3, description: 'Lead occupied residential construction safely.', compensation: { currency: 'USD', min: 8000000, max: 10000000, period: 'year' } })
  await run('rubric', { id: v.id, criteria: [{ name: 'Safety', description: 'Evidence of safe occupied site work' }] })
  await run('interview-plan', { id: v.id, plan: [{ name: 'Site walk', stageName: 'Interview', durationMinutes: 45 }] })
  const approval = await run('request-vacancy-approval', { id: v.id, approver: ownerEmail })
  await run('decide-approval', { id: approval.id, decision: 'approved', version: approval.version, reason: 'Plan reviewed' })
  await run('publish', { id: v.id })
  for (const width of [1440, 390]) {
    const email = `referral-employee-${width}@example.test`
    await run('member', { email, name: 'Referral Employee ' + width, roles: ['employee'] })
    const staff = await session(browser, root, origin, 'owner', width)
    const invited = await staff.context.request.post(origin + '/api/lodge/invite', { headers: { origin }, data: { email } })
    assert.equal(invited.status(), 200, 'the employer invites the employee identity before sign-in')
    const employee = await session(browser, root, origin, email, width)
    try {
      const page = employee.page
      const portal = page.getByRole('region', { name: 'Employee referrals', exact: true })
      await portal.getByRole('heading', { name: 'Employee referrals', exact: true }).waitFor()
      await portal.getByLabel('Send me job opportunity alerts').check()
      await portal.getByRole('button', { name: 'Save referral job alerts', exact: true }).click()
      await portal.getByText(/also emailed to you/).waitFor()
      await portal.getByRole('region', { name: 'Referral job alerts' }).getByText(v.title, { exact: false }).waitFor()
      await shot(page, evidence, 'opted-in', width)
      await portal.getByText('Refer someone for ' + v.title, { exact: true }).click()
      const form = portal.locator('details').filter({ has: page.getByText('Refer someone for ' + v.title, { exact: true }) })
      const name = 'Avery Referral ' + width
      await form.getByLabel('Candidate name', { exact: true }).fill(name)
      await form.getByLabel('Candidate email', { exact: true }).fill(`avery-referral-${width}@example.test`)
      await form.getByLabel('Candidate permission statement', { exact: true }).fill('Avery agreed to this job referral and sharing this resume this morning.')
      await form.getByLabel('Resume', { exact: true }).setInputFiles({ name: 'avery-resume.txt', mimeType: 'text/plain', buffer: Buffer.from('Avery: ten years coordinating safe residential site work.') })
      await form.getByRole('checkbox').check()
      await form.getByRole('button', { name: 'Submit referral', exact: true }).click()
      const own = portal.getByRole('region', { name: 'Referral: ' + name, exact: true })
      await own.getByText('submitted', { exact: true }).waitFor()
      assert.equal((await current(employee.context, origin)).referrals.submissions.filter(x => x.name === name).length, 1)
      await shot(page, evidence, 'submitted', width)
      await staff.page.goto(origin + '/app')
      await staff.page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Vacancies', exact: true }).click()
      await staff.page.getByRole('button', { name: 'Open ' + v.title, exact: true }).click()
      const review = staff.page.getByRole('region', { name: 'Review referral: ' + name, exact: true })
      await review.getByRole('combobox', { name: /^Referral decision/ }).selectOption('accepted')
      await review.getByLabel('Reconciliation reason', { exact: true }).fill('New candidate; permission and resume reviewed.')
      await review.getByRole('button', { name: 'Record referral reconciliation', exact: true }).click()
      await review.getByRole('button', { name: 'Record referral reconciliation', exact: true }).waitFor({ state: 'detached' })
      await review.getByRole('combobox', { name: /^Status visible to employee/ }).selectOption('in progress')
      await Promise.all([staff.page.waitForResponse(r => r.url().endsWith('/api/lodge/command/referral-progress') && r.status() === 200), review.getByRole('button', { name: 'Share referral status', exact: true }).click()])
      await shot(staff.page, evidence, 'reconciliation', width)
      await page.reload()
      await page.getByRole('region', { name: 'Referral: ' + name, exact: true }).getByText('in progress', { exact: true }).waitFor()
      assert.equal((await current(employee.context, origin)).applications?.length ?? 0, 0)
      await shot(page, evidence, 'follow-through', width)
    } finally { await staff.context.close(); await employee.context.close() }
  }
}
