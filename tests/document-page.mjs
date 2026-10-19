// DATA-006: real files read beside an editable scorecard and from the review queue.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { session } from './browser-journey.mjs'
import { readerFiles } from './document-fixtures.mjs'

export async function documentsPage(browser, { root, origin, run, evidence, ownerEmail }) {
 const job = await run('vacancy', { title: 'Distribution team lead', location: 'Brooklyn, NY', headcount: 1, manager: 'manager@dev.localhost', compensation: { currency: 'USD', min: 6000000, max: 8000000, period: 'year' } })
 await run('rubric', { id: job.id, criteria: [{ name: 'Safe operations', description: 'Explains safe loader operations' }] })
 await run('interview-plan', { id: job.id, plan: [{ name: 'Operations', stageName: 'Interview' }] })
 const requested = await run('request-vacancy-approval', { id: job.id, approver: ownerEmail })
 await run('decide-approval', { id: requested.id, decision: 'approved', version: requested.version, reason: 'Budget approved' })
 await run('publish', { id: job.id })
 const added = await run('candidate', { name: 'Avery Brooks', email: 'avery.reader@example.test', source: 'Referral', consentBasis: 'referral', consentNote: 'Agreed to hiring review', vacancy: job.id })
 const documents = []
 for (const f of readerFiles()) documents.push(await run('document', { application: added.application.id, name: f.name, mediaType: f.mediaType, kind: f.kind, base64: f.bytes.toString('base64') }))
 const restricted = await run('document', { application: added.application.id, name: 'work-authorization.txt', mediaType: 'text/plain', kind: 'right-to-work', base64: Buffer.from('Restricted work authorization original').toString('base64') })
 for (const width of [1440, 390]) {
  await run('assign-reviewers', { application: added.application.id, reviewers: ['interviewer@dev.localhost'] })
  const s = await session(browser, root, origin, 'interviewer', width)
  try {
   const { page } = s
   const errors = []; page.on('pageerror', e => errors.push(e.message))
   await page.goto(origin + '/app?application=' + added.application.id)
   await page.getByRole('tab', { name: 'Scorecards', exact: true }).click()
   const reader = page.getByRole('region', { name: 'Application of Avery Brooks' }).getByRole('region', { name: 'Inline documents' })
   await page.getByLabel('Key take-aways').fill('Ask about the inspection schedule')
   for (const doc of documents) {
    await reader.getByLabel('Read a document').selectOption(doc.id)
    if (doc.mediaType.startsWith('image/')) {
     await reader.getByRole('img').waitFor()
     assert.ok(await reader.getByRole('img').evaluate(img => img.complete && img.naturalWidth > 0), 'image decoded inline')
    } else {
     await reader.getByLabel('Search in document').fill('forklift')
     await reader.locator('mark').first().waitFor()
     assert.ok((await reader.locator('mark').first().textContent()).toLowerCase().includes('forklift'))
     if (doc.mediaType === 'application/pdf') assert.ok(await reader.getByRole('img').evaluate(img => img.complete && img.naturalWidth > 1), 'PDF genuinely rendered')
     if (doc.name.endsWith('.docx')) assert.ok(await reader.locator('.word-reading strong').count(), 'Word structure rendered')
    }
    assert.equal(await page.getByLabel('Key take-aways').inputValue(), 'Ask about the inspection schedule', 'reading leaves editable scorecard intact')
    await reader.getByRole('link', { name: 'Download original: ' + doc.name }).waitFor()
   }
   await reader.getByLabel('Read a document').selectOption(documents[0].id)
   await reader.getByLabel('Search in document').fill('forklift')
   await reader.locator('mark').first().waitFor()
   await page.screenshot({ path: join(evidence, `DATA-006-scorecard-${width}.png`), fullPage: true })
   assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'scorecard reader fits viewport')
   // The same document is readable from the REVIEW-001 queue.
   await page.goto(origin + '/app?job=' + job.id)
   const queue = page.getByRole('region', { name: 'Review queue' })
   for (const doc of documents) {
    await queue.getByLabel('Read a document').selectOption(doc.id)
    if (doc.mediaType.startsWith('image/')) {
     await queue.getByRole('img').waitFor()
     assert.ok(await queue.getByRole('img').evaluate(img => img.complete && img.naturalWidth > 0))
    } else {
     await queue.getByLabel('Search in document').fill('forklift')
     await queue.locator('mark').first().waitFor()
    }
   }
   await queue.getByLabel('Read a document').selectOption(documents[1].id)
   await queue.getByLabel('Search in document').fill('forklift')
   await queue.locator('mark').waitFor()
   await page.screenshot({ path: join(evidence, `DATA-006-queue-${width}.png`), fullPage: true })
   assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'queue reader fits viewport')
   await s.context.setOffline(true)
   await queue.getByRole('alert').waitFor()
   assert.equal(await queue.locator('.word-reading').count(), 0, 'network loss clears the mounted bytes')
   await s.context.setOffline(false)
   await queue.getByLabel('Read a document').selectOption('')
   await queue.getByLabel('Read a document').selectOption(documents[1].id)
   await queue.getByLabel('Search in document').waitFor()
   // Remove the grant while the document remains mounted, with no page refresh.
   await run('assign-reviewers', { application: added.application.id, reviewers: [] })
   await queue.getByRole('alert').waitFor()
   assert.equal(await queue.locator('.word-reading').count(), 0, 'revocation clears already mounted document content')
   assert.equal((await s.context.request.get(origin + '/api/lodge/view/document/' + documents[1].id)).status(), 404)
   assert.equal((await s.context.request.get(origin + '/api/lodge/download/document/' + documents[1].id)).status(), 404)
   assert.equal((await s.context.request.get(origin + '/api/lodge/view/document/' + restricted.id)).status(), 404)
   assert.deepEqual(errors, [])
  } finally { await s.context.close() }
 }
 await run('member', { email: 'admin@dev.localhost', name: 'Avery Hiring Admin', roles: ['admin'] })
 for (const width of [1440, 390]) {
 const owner = await session(browser, root, origin, 'admin', width)
 try {
  await owner.page.goto(origin + '/app?application=' + added.application.id)
  await owner.page.getByRole('tab', { name: 'Documents', exact: true }).click()
  await owner.page.getByRole('region', { name: 'Application of Avery Brooks' }).getByLabel('Read a document').selectOption(restricted.id)
  await owner.page.getByText('Restricted work authorization original', { exact: true }).waitFor()
  await owner.page.screenshot({ path: join(evidence, `DATA-006-restricted-${width}.png`), fullPage: true })
  const audit = await owner.context.request.get(origin + '/api/lodge/audit')
  const events = await audit.json()
  assert.ok(JSON.stringify(events).includes('document-viewed') && JSON.stringify(events).includes(restricted.id), 'restricted inline view audited')
 } finally { await owner.context.close() }
 }
}
