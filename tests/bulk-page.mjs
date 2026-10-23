import { browserWidths } from './browser-widths.mjs'
// DATA-003 in a browser: the owner selects one applicant on each of two jobs from
// their board views, previews a bulk tag, and applies it; each item's outcome is
// shown and the selection carried across jobs.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { current, session } from './browser-journey.mjs'

export async function bulkPage(browser, { root, origin, run, jobs, evidence, stamp = '' }) {
  for (const width of browserWidths) {
    const people = jobs.map((_, i) => `Bulk Person ${width}-${i + 1}${stamp}`)
    for (const [i, job] of jobs.entries()) await run('candidate', { name: people[i], email: `bulk${width}-${i + 1}${stamp}@example.test`, source: 'Job board', consentBasis: 'application', vacancy: job.id })
    const owner = await session(browser, root, origin, 'owner', width)
    try {
      const page = owner.page
      const bulk = page.locator('details.bulk')
      for (const [i, job] of jobs.entries()) {
        // Wide screens switch jobs from the rail; a phone from the board's job picker.
        if (width > 600) await page.getByRole('region', { name: 'Open jobs' }).getByRole('button', { name: new RegExp('^' + job.title) }).click()
        else {
          if (i === 0) await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Applications', exact: true }).click()
          await page.getByRole('combobox', { name: /^Job/ }).selectOption({ label: job.title })
        }
        await page.getByRole('heading', { level: 1, name: job.title }).waitFor()
        if (!(await bulk.getAttribute('open') !== null)) await bulk.locator('summary').click()
        await bulk.getByLabel('Select ' + people[i], { exact: true }).check()
      }
      await bulk.getByText(`Bulk actions (${jobs.length} selected)`).waitFor()
      await bulk.getByLabel('Bulk action').selectOption('tag')
      await bulk.getByLabel('Tag to add').fill('Fair follow-up ' + width)
      await bulk.getByRole('button', { name: 'Preview' }).click()
      const preview = page.getByRole('region', { name: 'Bulk preview' })
      await preview.getByText(`${jobs.length} ready · 0 refused`).waitFor()
      for (const [i, job] of jobs.entries()) assert.ok((await preview.locator('tr', { hasText: people[i] }).textContent()).includes(job.title))
      const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }))
      assert.ok(scroll <= inner + 1, `bulk preview at ${width}: no sideways scrolling (${scroll} > ${inner})`)
      await page.screenshot({ path: join(evidence, `bulk-preview-${width}.png`), fullPage: true })
      await preview.getByRole('button', { name: `Apply to ${jobs.length}` }).click()
      await page.getByRole('status').filter({ hasText: `${jobs.length} applied · 0 refused` }).waitFor()
      const w = await current(owner.context, origin)
      for (const name of people) assert.deepEqual(w.applications.find(a => a.candidateName === name).tags, ['Fair follow-up ' + width])
    } finally { await owner.context.close() }
  }
}
