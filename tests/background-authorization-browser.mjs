import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { session, current, api } from './browser-journey.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { authorizationReview } from './background-authorization-flow.mjs'

/** Native built screens: one assertion width, with both candidate proof widths captured. */
export async function backgroundAuthorizationPage(browser, { root, origin, evidence, ownerEmail }) {
  await mkdir(evidence, { recursive: true })
  const owner = await session(browser, root, origin, 'owner', 1440)
  const candidate = await session(browser, root, origin, 'manager', 1440)
  const errors = []
  for (const p of [owner.page, candidate.page]) p.on('pageerror', e => errors.push(e.message))
  const capture = async (page, name) => {
    await iconTooltips(page)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' fits the test width')
    const sizes = await page.locator('main input,main textarea,main button,main p,main label').evaluateAll(nodes => nodes.filter(n => n.checkVisibility()).map(n => parseFloat(getComputedStyle(n).fontSize)))
    assert.ok(sizes.every(n => n >= 13), 'visible form and everyday text is at least 13px')
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.screenshot({ path: evidence + '/background-authorization-' + name + '-' + width + '.png', fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  try {
    const run = (op, body) => api(owner.context, origin, op, body)
    const email = (await current(candidate.context, origin)).actor.email
    let job = await run('vacancy', { title: 'Synthetic background authorization browser', location: 'Denver, CO', manager: ownerEmail, headcount: 1, compensation: { currency: 'USD', min: 7000000, max: 9000000, period: 'year' } })
    await run('rubric', { id: job.id, criteria: [{ name: 'Safety', description: 'A safe work sequence' }] })
    await run('interview-plan', { id: job.id, plan: [{ name: 'Site discussion', stageName: 'Interview' }] })
    const approval = await run('request-vacancy-approval', { id: job.id, approver: ownerEmail })
    await run('decide-approval', { id: approval.id, version: approval.version, decision: 'approved', reason: 'Synthetic reviewed terms' })
    job = await run('publish', { id: job.id })
    const applied = await candidate.context.request.post(origin + '/jobs/' + job.slug, { headers: { origin }, form: { name: 'Synthetic authorization browser applicant', email, noticeVersion: '1', consent: 'yes' } })
    assert.equal(applied.status(), 200)
    const receiptId = (await applied.text()).match(/LDG-[A-F0-9]{8}/)[0], before = await current(owner.context, origin)
    const receipt = before.receipts.find(r => r.id === receiptId), app = before.applications.find(a => a.id === receipt.application)
    const review = authorizationReview(app)
    await owner.page.goto(origin + '/app?settings=background-authorization&application=' + app.id)
    const settings = owner.page.getByRole('region', { name: 'Background authorization settings', exact: true })
    for (const [label, key] of [['Employer disclosure', 'disclosure'], ['Employer authorization', 'authorization'], ['Purpose', 'purpose'], ['Intended check scope', 'checkScope'], ['Reviewed application language', 'language'], ['Employer legal review record', 'legalReview'], ['Retention review record', 'retentionReview']]) await settings.getByLabel(label, { exact: true }).fill(review[key])
    assert.equal(await settings.getByRole('checkbox').isChecked(), false)
    await settings.getByRole('checkbox').check()
    await settings.getByRole('button', { name: 'Review and present authorization', exact: true }).click()
    await owner.page.getByText('Saved.', { exact: true }).waitFor()
    await capture(owner.page, 'employer-settings')
    await candidate.page.goto(origin + '/candidate/receipts/' + receiptId + '/account')
    await candidate.page.getByRole('link', { name: 'Review background-check authorization', exact: true }).click()
    await candidate.page.getByRole('heading', { name: 'Background-check authorization', exact: true }).waitFor()
    assert.equal(await candidate.page.getByRole('checkbox').isChecked(), false)
    assert.match(await candidate.page.locator('main').innerText(), /Local evidence only.*Not submitted to or approved by Checkr/)
    await capture(candidate.page, 'unanswered')
    await candidate.page.getByRole('checkbox').check()
    await candidate.page.getByRole('button', { name: 'Record agreement', exact: true }).click()
    await candidate.page.getByRole('status').filter({ hasText: 'agreed' }).waitFor()
    await capture(candidate.page, 'agreed')
    await candidate.page.getByRole('button', { name: 'Withdraw agreement to version 1', exact: true }).click()
    await candidate.page.getByRole('status').filter({ hasText: 'withdrawn' }).waitFor()
    await capture(candidate.page, 'withdrawn')
    await run('background-authorization-review', { ...review, version: 1, disclosure: 'Synthetic revised browser disclosure.' })
    await candidate.page.reload()
    assert.equal(await candidate.page.getByRole('checkbox').isChecked(), false)
    await candidate.page.getByRole('button', { name: 'Decline authorization', exact: true }).click()
    await candidate.page.getByRole('status').filter({ hasText: 'refused' }).waitFor()
    await capture(candidate.page, 'refused')
    await owner.page.goto(origin + '/app?application=' + app.id)
    await owner.page.getByRole('tab', { name: 'Decisions', exact: true }).click()
    const panel = owner.page.getByRole('region', { name: 'Background authorization', exact: true })
    await panel.getByText('Current response: refused', { exact: true }).waitFor()
    await panel.getByText('Disclosure and authorization version 1', { exact: true }).click()
    await capture(owner.page, 'staff-history')
    const after = await current(owner.context, origin), changed = after.applications.find(a => a.id === app.id)
    assert.deepEqual([changed.stage, changed.history], [app.stage, app.history])
    assert.deepEqual(after.backgroundAuthorizations.records.find(r => r.application === app.id).history.map(e => e.action), ['agreed', 'withdrawn', 'refused'])
    assert.deepEqual(errors, [])
  } finally { await candidate.context.close(); await owner.context.close() }
}
