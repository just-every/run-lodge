import { browserWidths } from './browser-widths.mjs'
// MIG-008 on the real screen at 1440 and 390: after the Workable kit's import (made through its own screen), the owner prepares a live job, previews the
// mapped cutover on the Move in screen, approves that exact preview and sees the moved people on the live job.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { current, session } from './browser-journey.mjs'

async function fits(page, label) {
 const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }))
 assert.ok(scroll <= width + 1, `${label}: no sideways scrolling (${scroll} > ${width})`)
}

export async function cutoverPage(browser, { root, origin, run, evidence }) {
 for (const [width, imported, people] of [[1440, 'Site supervisor', ['Dana Whitfield', 'Lee Moreno']], [390, 'Estimator', ['Kai Ito', 'Lee Moreno']]].filter(([width]) => browserWidths.includes(width))) {
  const title = `${imported} (live ${width})`
  const job = await run('vacancy', { title, location: 'Brooklyn, NY', headcount: 2, manager: 'manager@dev.localhost', compensation: { currency: 'USD', min: 6500000, max: 8500000, period: 'year' } })
  await run('rubric', { id: job.id, criteria: [{ name: 'Safety', description: 'Explains safe site operations' }] })
  await run('interview-plan', { id: job.id, plan: [{ name: 'Walk', stageName: 'Interview', durationMinutes: 30 }] })
  const s = await session(browser, root, origin, 'owner', width)
  try {
   const errors = []; s.page.on('pageerror', e => errors.push(e.message))
   const page = s.page
   await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Move in', exact: true }).click()
   const card = page.getByRole('region', { name: 'Cutover' })
   await card.getByLabel('Imported job').selectOption({ label: imported })
   await card.getByLabel('Live job').selectOption({ label: `${title} (draft)` })
   const stageLabels = await card.getByText(/^Source stage “/).allTextContents()
   assert.ok(stageLabels.length >= 2, 'one mapping per source stage')
   for (const label of stageLabels) {
    const name = label.match(/“(.+)”/)[1]
    await card.getByLabel(label).selectOption({ label: name === 'Phone screen' ? 'Screen' : name === 'Interview' ? 'Interview' : 'Applied' })
   }
   await card.getByRole('button', { name: 'Preview cutover' }).click()
   const preview = page.getByRole('region', { name: 'Cutover preview' })
   await preview.getByText(/2 to move/).waitFor()
   for (const name of people) await preview.getByText(name).waitFor()
   await fits(page, 'cutover preview')
   await page.screenshot({ path: join(evidence, `MIG-008-preview-${width}.png`), fullPage: true })
   await preview.getByRole('button', { name: 'Approve this cutover' }).click()
   await card.getByText(/undone|live/).first().waitFor()
   const w = await current(s.context, origin)
   const live = w.applications.filter(a => a.vacancy === job.id)
   assert.equal(live.length, 2); assert.ok(live.every(a => a.status === 'active' && a.activated))
   assert.deepEqual(live.map(a => a.candidateName).sort(), [...people].sort())
   await fits(page, 'cutover done')
   await page.screenshot({ path: join(evidence, `MIG-008-done-${width}.png`), fullPage: true })
   assert.deepEqual(errors, [])
  } finally { await s.context.close() }
 }
}
