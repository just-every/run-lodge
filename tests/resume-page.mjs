import { browserWidths } from './browser-widths.mjs'
// DATA-002: genuine PDF.js, Mammoth and UTF-8 decoding through individual and bulk intake pages.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { api, current, session } from './browser-journey.mjs'
import { resumeFiles, unreadableResume } from './resume-fixtures.mjs'
import { resumeLifecyclePage } from './resume-lifecycle-page.mjs'

export async function resumeIntakePage(browser, { root, origin, job, evidence }) {
 for (const width of browserWidths) {
  const owner = await session(browser, root, origin, 'owner', width)
  try {
   const { page, context } = owner, tag = width === 1440 ? 'Wide' : 'Narrow'
   const errors = []; page.on('pageerror', e => errors.push(e.message))
   await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Candidates', exact: true }).click()
   const open = async () => {
    const details = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Resume intake: individual or bulk' }) }).first()
    if (await details.getAttribute('open') === null) await details.locator('summary').first().click()
   }
   await open()
   const intake = page.getByRole('region', { name: 'Resume intake', exact: true })
   await resumeLifecyclePage(browser, { root, origin, owner, intake, open, evidence, width })
   const fileInput = file => ({ name: file.name, mimeType: file.mediaType, buffer: file.bytes })
   const originals = new Map(), committed = []
   const inspectAndCommit = async (file, { correct = false, manual = false } = {}) => {
    const card = intake.getByRole('article', { name: 'Resume review: ' + file.name, exact: true })
    await card.getByRole('button', { name: 'Review corrected details', exact: true }).waitFor()
    const originalHref = await card.getByRole('link', { name: 'Download original: ' + file.name, exact: true }).getAttribute('href')
    const id = originalHref.split('/').at(-1)
    const pendingRow = (await current(context, origin)).resumeIntakes.find(r => r.id === id)
    assert.equal(Date.parse(pendingRow.expiresAt) - Date.parse(pendingRow.uploadedAt), 7 * 86400000)
    assert.equal(await card.locator('time').getAttribute('datetime'), pendingRow.expiresAt)
    originals.set(id, file)
    const original = await context.request.get(origin + originalHref)
    assert.equal(original.status(), 200); assert.deepEqual(await original.body(), file.bytes, 'saved original is unchanged before review')
    if (!manual) {
     await card.getByText('Extracted fields and source passages', { exact: true }).click()
     const w = await current(context, origin), row = w.resumeIntakes.find(r => r.id === id)
     for (const key of ['name', 'email', 'phone']) assert.ok(row.sourceText.includes(row.extraction[key].passage))
     for (const key of ['employment', 'education', 'skills']) assert.ok(row.extraction[key].length && row.extraction[key].every(f => row.sourceText.includes(f.passage)))
     assert.equal(await card.getByLabel('Candidate email', { exact: true }).inputValue(), file.source.split('\n')[1], 'the actual decoder recovered the email')
     assert.ok((await card.getByLabel('Employment').inputValue()).includes('Cedar Supply'))
     assert.ok((await card.getByLabel('Education').inputValue()).includes('North College'))
     await card.getByText(/First line may be a name/).waitFor()
     assert.ok(!JSON.stringify(row.extraction).includes('woman') && !JSON.stringify(row.extraction).includes('Age:'))
    } else {
     await card.getByRole('alert').filter({ hasText: file.name }).waitFor()
     await card.getByLabel('Candidate name', { exact: true }).fill('Manual Intake ' + tag)
     assert.equal(await card.getByLabel('Candidate email', { exact: true }).inputValue(), '')
    }
    if (correct) await card.getByLabel('Candidate name', { exact: true }).fill('Corrected Resume ' + tag)
    await card.getByLabel('Source (where they came from)', { exact: true }).fill('Submitted resume')
    await card.getByLabel('Basis for keeping their details').selectOption('application')
    await card.getByLabel('Note about consent', { exact: true }).fill('Submitted for the listed job')
    const before = await current(context, origin)
    await card.getByRole('button', { name: 'Review corrected details', exact: true }).click()
    const confirm = card.getByRole('region', { name: 'Confirm resume: ' + file.name, exact: true })
    await confirm.getByRole('button', { name: 'Commit reviewed resume' }).waitFor()
    const previewed = await current(context, origin)
    assert.equal(previewed.candidates.length, before.candidates.length, 'review creates no candidate')
    const row = previewed.resumeIntakes.find(r => r.id === id), decisions = row.review.duplicates
    if (decisions.length) {
     for (const d of decisions) {
      await confirm.getByLabel('Decision for ' + d.name).selectOption('existing')
      await confirm.getByLabel('Reason for ' + d.name, { exact: true }).fill('Confirmed the same person against their original resume')
     }
    }
    const previousIntake = decisions.length ? before.resumeIntakes.find(r => r.status === 'committed' && r.candidate === decisions[0].candidate) : null
    if (decisions.length) assert.ok(previousIntake, 'the existing person has an earlier committed original')
    const previousPerson = previousIntake ? (await api(context, origin, 'resume-commit', { id: previousIntake.id })).candidate : null
    await page.screenshot({ path: join(evidence, `DATA-002-review-${file.name.replace(/\W/g, '-')}-${width}.png`), fullPage: true })
    await confirm.getByLabel('I checked the original, corrected the details and decided every duplicate suggestion', { exact: true }).check()
    await confirm.getByRole('button', { name: 'Commit reviewed resume', exact: true }).click()
    await card.waitFor({ state: 'detached' })
    const after = await current(context, origin), saved = after.resumeIntakes.find(r => r.id === id)
    assert.equal(saved.status, 'committed')
    const doc = after.documents.find(d => d.id === id), person = after.candidates.find(c => c.id === saved.candidate)
    assert.ok(doc && after.applications.some(a => a.id === saved.application && a.vacancy === job.id && a.candidate === person.id))
    if (correct) assert.equal(person.name, 'Corrected Resume ' + tag)
    if (decisions.length) {
     assert.equal(after.candidates.length, before.candidates.length, 'duplicate intake reuses a person')
     // Replay exposes the persisted record; workspace resumeText is derived from all readable originals.
     const persisted = (await api(context, origin, 'resume-commit', { id })).candidate
     assert.deepEqual(persisted, previousPerson, 'existing person was not overwritten')
     assert.ok(person.resumeText.includes(before.candidates.find(c => c.id === person.id).resumeText), 'earlier resume passages remain searchable')
     if (row.sourceText) assert.ok(person.resumeText.includes(row.sourceText), 'the newly attached original contributes searchable text')
    }
    committed.push(saved)
    return saved
   }
   // All three types through the individual intake, with the latter two confirmed as the same person.
   const single = resumeFiles('Robin Single ' + tag, `single${width}@example.test`, 'single-' + width, '+1 212 555 ' + width)
   const singleForm = intake.locator('form').filter({ has: page.getByRole('button', { name: 'Upload one resume', exact: true }) })
   for (const [i, file] of single.entries()) {
    await singleForm.getByLabel('Apply reviewed resumes to vacancy').selectOption(job.id)
    await singleForm.getByLabel('One resume (PDF, DOCX or text)', { exact: true }).setInputFiles(fileInput(file))
    await singleForm.getByRole('button', { name: 'Upload one resume', exact: true }).click()
    await inspectAndCommit(file, { correct: i === 0 })
   }
   assert.equal(new Set(committed.map(r => r.candidate)).size, 1)
   assert.equal(new Set(committed.map(r => r.application)).size, 1)
   // A batch contains PDF, DOCX, text and one unreadable PDF, processed independently.
   const batch = [
    resumeFiles('Duplicate Resume ' + tag, `single${width}@example.test`, 'batch-duplicate-' + width, '+1 646 111 ' + width)[0],
    resumeFiles('Morgan Batch ' + tag, `morganbatch${width}@example.test`, 'batch-word-' + width, '+1 646 222 ' + width)[1],
    resumeFiles('Quinn Batch ' + tag, `quinnbatch${width}@example.test`, 'batch-text-' + width, '+1 646 333 ' + width)[2],
    { ...unreadableResume, name: 'unreadable-' + width + '.pdf' },
   ]
   const batchForm = intake.locator('form').filter({ has: page.getByRole('button', { name: 'Upload resume batch', exact: true }) })
   await batchForm.getByLabel('Apply reviewed resumes to vacancy').selectOption(job.id)
   await batchForm.getByLabel('Resume batch (PDF, DOCX or text)', { exact: true }).setInputFiles(batch.map(fileInput))
   await batchForm.getByRole('button', { name: 'Upload resume batch', exact: true }).click()
   await intake.getByRole('article', { name: 'Resume review: ' + batch.at(-1).name, exact: true }).getByRole('button', { name: 'Review corrected details', exact: true }).waitFor()
   // A page reload proves pending originals, decoding results and parse failures are durable.
   await page.reload()
   await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Candidates', exact: true }).click()
   await open()
   assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'resume intake fits the viewport')
   for (const file of batch) await inspectAndCommit(file, { manual: !file.source })
   for (const [id, file] of originals) {
    const response = await context.request.get(origin + '/api/lodge/download/document/' + id)
    assert.equal(response.status(), 200); assert.deepEqual(await response.body(), file.bytes, 'every individual/batch/failed original survives commit')
   }
   const final = await current(context, origin)
   assert.equal(committed.length, 7)
   assert.equal(new Set(committed.map(r => r.candidate)).size, 4)
   for (const saved of committed) assert.ok(final.resumeExtractions.some(r => r.document === saved.id && r.confirmedAt))
   await intake.getByText('Committed resumes', { exact: true }).click()
   await page.screenshot({ path: join(evidence, `DATA-002-committed-${width}.png`), fullPage: true })
   assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'committed resume list fits the viewport')
   assert.deepEqual(errors, [])
   await intake.getByLabel('Keep new uncommitted resumes (days)').fill('30')
   await intake.getByRole('button', { name: 'Save pending resume retention', exact: true }).click()
   await page.getByText('New uploads are kept for 30 days.', { exact: false }).waitFor()
  } catch (error) {
   // Capture only rendered fixture text, never session cookies, sign-in links or request headers.
   await owner.page.screenshot({ path: join(evidence, `DATA-002-failure-${width}.png`), fullPage: true }).catch(() => {})
   const visible = await owner.page.locator('main').innerText().catch(() => 'The app main region was unavailable')
   await writeFile(join(evidence, `DATA-002-failure-${width}.txt`), visible)
   throw error
  } finally { await owner.context.close() }
 }
}
