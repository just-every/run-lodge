import assert from 'node:assert/strict'
import { session, current, api } from './browser-journey.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { parseCalendar } from './candidate-itinerary-flow.mjs'

/** The built human review door and candidate projection; assertions at 1440, screen proof at both widths. */
export async function candidateItineraryPage(browser, { root, origin, evidence, ownerEmail }) {
  const owner = await session(browser, root, origin, 'owner', 1440)
  const candidate = await session(browser, root, origin, 'manager', 1440)
  const { page, context } = owner, run = (op, body) => api(context, origin, op, body)
  const errors = []
  for (const p of [page, candidate.page]) p.on('pageerror', error => errors.push(error.message))
  const capture = async (p, state) => {
    await iconTooltips(p)
    for (const width of [1440, 390]) {
      await p.setViewportSize({ width, height: 1000 })
      await p.screenshot({ path: evidence + '/candidate-itinerary-' + state + '-' + width + '.png', fullPage: true })
    }
    await p.setViewportSize({ width: 1440, height: 1000 })
  }
  try {
    const candidateEmail = (await current(candidate.context, origin)).actor.email
    let job = await run('vacancy', { title: 'Synthetic itinerary workspace', location: 'New York', manager: ownerEmail, headcount: 1, compensation: { currency: 'USD', min: 7000000, max: 9000000, period: 'year' } })
    await run('rubric', { id: job.id, criteria: [{ name: 'Safety', description: 'Explains safe work' }] })
    job = await run('interview-plan', { id: job.id, plan: [{ name: 'Safety conversation', stageName: 'Interview', durationMinutes: 30 }] })
    const approval = await run('request-vacancy-approval', { id: job.id, approver: ownerEmail })
    await run('decide-approval', { id: approval.id, version: approval.version, decision: 'approved', reason: 'Synthetic approved terms' })
    job = await run('publish', { id: job.id })
    const submitted = await candidate.context.request.post(origin + '/jobs/' + job.slug, { headers: { origin }, form: { name: 'Synthetic itinerary applicant', email: candidateEmail, noticeVersion: '1', consent: 'yes' } })
    assert.equal(submitted.status(), 200)
    const receiptId = (await submitted.text()).match(/LDG-[A-F0-9]{8}/)[0]
    const before = await current(context, origin), receipt = before.receipts.find(r => r.id === receiptId), app = before.applications.find(a => a.id === receipt.application)
    const starts = ['2099-03-08T06:30:00.000Z', '2099-03-08T07:30:00.000Z', '2099-03-08T15:00:00.000Z']
    const ivs = []
    for (const [i, start] of starts.entries()) {
      const iv = await run('interview', { application: app.id, planItem: job.plan[0].id, participants: [ownerEmail], slots: [start], durationMinutes: [30, 45, 60][i], location: 'Synthetic room ' + (i + 1) })
      await run('schedule', { interview: iv.id, slot: 0 }); ivs.push(iv)
    }
    const path = '/candidate/receipts/' + receiptId + '/itinerary'
    assert.equal((await candidate.context.request.get(origin + path)).status(), 404, 'new sessions start private')
    await page.goto(origin + '/app?application=' + app.id)
    await page.getByRole('tab', { name: 'Interviews', exact: true }).click()
    await page.getByRole('link', { name: 'Candidate itinerary settings', exact: true }).click()
    const settings = page.getByRole('region', { name: 'Candidate itinerary settings', exact: true })
    await settings.getByText('Itinerary sharing is off.', { exact: true }).waitFor()
    await settings.getByText('Review candidate page labels', { exact: true }).click()
    for (const [i, iv] of ivs.entries()) {
      await settings.locator('[name="share-' + iv.id + '"]').check()
      await settings.locator('[name="title-' + iv.id + '"]').fill('Synthetic session ' + (i + 1))
    }
    await settings.locator('[name="panel-' + ivs[0].id + '-0"]').check()
    await settings.locator('[name="name-' + ivs[0].id + '-0"]').fill('Synthetic approved host')
    await settings.locator('[name="role-' + ivs[0].id + '-0"]').fill('Safety lead')
    await settings.locator('[name="reviewed"]').check()
    await capture(page, 'review')
    await settings.getByRole('button', { name: 'Review and share itinerary', exact: true }).click()
    await settings.getByText('Reviewed sharing is current.', { exact: true }).waitFor()
    await candidate.page.goto(origin + path + '?zone=America%2FNew_York')
    await candidate.page.getByRole('heading', { name: 'Your interview itinerary', exact: true }).waitFor()
    const body = await candidate.page.locator('main').innerText()
    for (const expected of ['1:30 AM EST', '3:30 AM EDT', '11:00 AM EDT', '30 minutes', '45 minutes', '60 minutes', 'Synthetic approved host', 'Safety lead']) assert.ok(body.includes(expected), expected)
    assert.ok(!body.includes(ownerEmail))
    assert.ok(await candidate.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await capture(candidate.page, 'current')
    await candidate.page.getByLabel('Time zone', { exact: true }).fill('America/Los_Angeles')
    await candidate.page.getByRole('button', { name: 'Show times', exact: true }).click()
    assert.match(await candidate.page.locator('main').innerText(), /10:30 PM PST/)
    const download = await candidate.context.request.get(origin + path + '/calendar.ics?zone=America%2FLos_Angeles')
    assert.equal(download.status(), 200)
    const events = parseCalendar(await download.text())
    assert.deepEqual(events.map(e => e.DTEND), ['20990308T070000Z', '20990308T081500Z', '20990308T160000Z'])
    await run('cancel-interview', { interview: ivs[2].id, reason: 'Synthetic internal reason' })
    assert.equal((await candidate.context.request.get(origin + path)).status(), 404)
    await page.reload()
    // Navigation keeps the selected application when opening Settings through its public link.
    await page.goto(origin + '/app?settings=candidate-itinerary&application=' + app.id)
    await settings.getByText('Sources changed. Sharing needs a new review.', { exact: true }).waitFor()
    await capture(page, 'stale')
    await settings.locator('[name="reviewed"]').check()
    await settings.getByRole('button', { name: 'Review and share itinerary', exact: true }).click()
    await settings.getByText('Reviewed sharing is current.', { exact: true }).waitFor()
    await candidate.page.goto(origin + path + '?zone=America%2FLos_Angeles')
    await candidate.page.getByRole('status').filter({ hasText: 'Canceled' }).waitFor()
    await capture(candidate.page, 'cancelled')
    await settings.getByRole('button', { name: 'Disable itinerary sharing', exact: true }).click()
    await settings.getByText('Itinerary sharing is off.', { exact: true }).waitFor()
    assert.equal((await candidate.context.request.get(origin + path)).status(), 404)
    assert.deepEqual(errors, [])
  } catch (error) {
    await page.screenshot({ path: evidence + '/candidate-itinerary-review-error.png', fullPage: true }).catch(() => {})
    throw error
  } finally { await candidate.context.close(); await context.close() }
}
