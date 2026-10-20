import assert from 'node:assert/strict'
import { join } from 'node:path'
import { current, session } from './browser-journey.mjs'

/** REVIEW-002: manager configures, reviews, reveals, then returns to blind at both widths. */
export async function blindPage(browser, { root, origin, run, evidence, ownerEmail }) {
 for (const width of [1440, 390]) {
  const v = await run('vacancy', { title: 'Blind inventory lead ' + width, headcount: 2, location: 'Brooklyn, NY', manager: 'manager@dev.localhost', compensation: { currency: 'USD', min: 5000000, max: 7000000, period: 'year' } })
  await run('rubric', { id: v.id, criteria: [{ name: 'Stock control', description: 'A stock control example' }] })
  await run('interview-plan', { id: v.id, plan: [{ name: 'Inventory discussion', stageName: 'Interview' }] })
  const request = await run('request-vacancy-approval', { id: v.id, approver: ownerEmail })
  await run('decide-approval', { id: request.id, version: request.version, decision: 'approved', reason: 'Budgeted opening' })
  await run('publish', { id: v.id })
  const name = 'Robin Carter ' + width, school = 'North College', year = '2020'
  const source = `${name}\nrobin${width}@example.test\n+1 (212) 555-0147\n55 Pine Street\nNorth College, 2020\nInventory planning and forklift inspections`
  const added = await run('candidate', { name, email: `robin${width}@example.test`, phone: '+1 (212) 555-0147', location: '55 Pine Street', source: 'Careers', consentBasis: 'application', vacancy: v.id, resume: { name: 'Robin Carter resume.txt', mediaType: 'text/plain', base64: Buffer.from(source).toString('base64') } })
  await run('candidate', { name: 'Taylor Rowan ' + width, email: `taylor${width}@example.test`, source: 'Careers', consentBasis: 'application', vacancy: v.id })
  const s = await session(browser, root, origin, 'manager', width)
  try {
   const { page, context } = s, errors = []
   page.on('pageerror', e => errors.push(e.message))
   await page.goto(origin + '/app?application=' + added.application.id)
   const values = page.getByRole('region', { name: 'Blind identity values', exact: true })
   await values.locator('summary').click()
   await values.getByLabel('Schools to redact (one per line)').fill(school)
   await values.getByLabel('Graduation years to redact (one per line)').fill(year)
   await values.getByRole('button', { name: 'Save identity redactions', exact: true }).click()
   await page.getByText('Saved.', { exact: true }).waitFor()
   const settings = page.getByRole('region', { name: 'Blind review settings', exact: true })
   await settings.locator('summary').click()
   await settings.getByLabel('Enable blind review', { exact: true }).check()
   await settings.getByRole('group', { name: 'Blind stages' }).getByLabel(v.stages[0].name, { exact: true }).check()
   await settings.getByRole('combobox', { name: /^Reveal stage/ }).selectOption(v.stages[2].id)
   await settings.getByRole('button', { name: 'Save blind review', exact: true }).click()
   await page.getByRole('heading', { name: 'Redacted resume', exact: true }).first().waitFor()
   const w = await current(context, origin), app = w.applications.find(a => a.id === added.application.id), code = app.candidateName
   assert.equal(app.blind, true)
   const queue = page.getByRole('region', { name: 'Review queue', exact: true })
   const panel = page.getByRole('region', { name: 'Application of ' + code, exact: true })
   for (const surface of [queue, panel]) {
    const contents = await surface.innerText()
    for (const hidden of [name, `robin${width}@example.test`, '555-0147', '55 Pine Street', school, year]) assert.ok(!contents.includes(hidden), 'blind text excludes ' + hidden)
    assert.ok(contents.includes('Inventory planning'))
   }
   const fits = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'REVIEW-002 fits viewport')
   await fits(); await page.screenshot({ path: join(evidence, `REVIEW-002-profile-${width}.png`), fullPage: true })
   await panel.getByRole('tab', { name: 'Documents', exact: true }).click()
   await panel.getByRole('region', { name: 'Blind review resume' }).waitFor()
   assert.equal(await panel.getByRole('link', { name: /Download/ }).count(), 0)
   await fits(); await page.screenshot({ path: join(evidence, `REVIEW-002-documents-${width}.png`), fullPage: true })
   await panel.getByRole('tab', { name: 'Overview', exact: true }).click()
   await queue.getByLabel('Why they move on (optional)').fill('Inventory experience merits a discussion')
   await queue.getByRole('button', { name: 'Advance to ' + v.stages[2].name, exact: true }).click()
   await page.getByRole('region', { name: 'Application of ' + name, exact: true }).waitFor()
   await page.getByRole('region', { name: 'Identity reveal history' }).waitFor()
   await fits(); await page.screenshot({ path: join(evidence, `REVIEW-002-revealed-${width}.png`), fullPage: true })
   const revealed = page.getByRole('region', { name: 'Application of ' + name, exact: true })
   await revealed.getByText('Other moves', { exact: true }).click()
   const move = revealed.locator('form').filter({ has: page.getByRole('button', { name: 'Move', exact: true }) })
   await move.getByRole('combobox', { name: /^Move to/ }).selectOption(v.stages[0].id)
   await move.getByLabel('Reason (kept in the history)', { exact: true }).fill('Fresh blind review')
   await move.getByRole('button', { name: 'Move', exact: true }).click()
   await page.getByRole('region', { name: 'Application of ' + code, exact: true }).waitFor()
   await page.getByRole('region', { name: 'Identity reveal history' }).waitFor()
   assert.equal((await current(context, origin)).applications.find(a => a.id === added.application.id).reveals.length, 1)
   await fits(); await page.screenshot({ path: join(evidence, `REVIEW-002-reblinded-${width}.png`), fullPage: true })
   assert.deepEqual(errors, [])
  } catch (error) {
   await s.page.screenshot({ path: join(evidence, `REVIEW-002-failure-${width}.png`), fullPage: true })
   throw error
  } finally { await s.context.close() }
 }
}
