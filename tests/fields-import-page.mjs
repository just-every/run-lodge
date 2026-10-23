import { browserWidths } from './browser-widths.mjs'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { current, session } from './browser-journey.mjs'
import { zip } from './zip.mjs'

/** DATA-001: choose a typed mapping, inspect an inert import, and commit the reviewed package. */
export async function fieldsImportPage(browser, { root, origin, evidence }) {
 for (const width of browserWidths) {
  const { context, page } = await session(browser, root, origin, 'owner', width)
  try {
   const w = await current(context, origin)
   const template = w.vacancies.find(v => v.title.startsWith('Typed hiring') && v.customSchema?.some(f => f.importColumn === 'employment_preference'))
   assert.ok(template, 'DATA-001 configured import template exists')
   const suffix = width + '-' + crypto.randomUUID().slice(0, 6), filename = 'typed-fields-' + suffix + '.zip'
   const job = 'typed-job-' + suffix, candidate = 'typed-person-' + suffix
   const bytes = zip([
    { name: 'jobs.csv', bytes: Buffer.from('id,title\n' + job + ',Imported warehouse role\n') },
    { name: 'candidates.csv', bytes: Buffer.from('id,job_id,name,email,stage,employment_preference\n' + candidate + ',' + job + ',Imported warehouse applicant,import-' + suffix + '@example.test,Applied,Permanent\n') },
   ])
   await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Move in', exact: true }).click()
   await page.getByRole('combobox', { name: /^Typed field mapping from job/ }).selectOption(template.id)
   await page.getByLabel('Workable export ZIP').setInputFiles({ name: filename, mimeType: 'application/zip', buffer: bytes })
   await page.getByRole('button', { name: 'Preview package', exact: true }).click()
   await page.getByRole('heading', { name: 'Preview of ' + filename, exact: true }).waitFor()
   assert.ok(!(await current(context, origin)).vacancies.some(v => v.id === 'workable:job:' + job), 'preview writes no hiring records')
   assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'DATA-001 import fits ' + width)
   await page.screenshot({ path: join(evidence, `DATA-001-import-preview-${width}.png`), fullPage: true })
   await page.getByRole('button', { name: 'Commit this exact preview', exact: true }).click()
   await page.getByRole('button', { name: 'Commit this exact preview', exact: true }).waitFor({ state: 'hidden' })
   const imported = await current(context, origin), v = imported.vacancies.find(v => v.id === 'workable:job:' + job)
   assert.ok(v); assert.equal(v.status, 'imported')
   const app = imported.applications.find(a => a.vacancy === v.id), person = imported.candidates.find(c => c.id === app.candidate)
   const field = v.customSchema.find(f => f.name === 'Employment preference')
   assert.equal(person.customValues[field.id], 'Permanent'); assert.equal(app.status, 'imported'); assert.equal(person.consent.talentPool, false)
   await page.screenshot({ path: join(evidence, `DATA-001-import-completed-${width}.png`), fullPage: true })
  } finally { await context.close() }
 }
}
