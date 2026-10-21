// OFFER-005 through the real screens at 1440 and 390: the hiring manager sends an approved offer, the candidate verifies
// by emailed code on a phone-width page, consents, signs, and the employer's designated signer countersigns.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readdir } from 'node:fs/promises'
import { api, current, session } from './browser-journey.mjs'

/** Messages the dev server's own captured-mail table holds (the local database under .wrangler), newest last. */
async function outbox(root) {
 const { DatabaseSync } = await import('node:sqlite')
 const files = []
 const walk = async dir => { for (const entry of await readdir(dir, { withFileTypes: true })) { if (entry.name === 'node_modules' || entry.name === '.git') continue; const path = join(dir, entry.name); if (entry.isDirectory()) await walk(path); else if (entry.name.endsWith('.sqlite')) files.push(path) } }
 await walk(join(root, '.wrangler')).catch(() => {})
 const found = []
 for (const file of files) {
  const db = new DatabaseSync(file, { readOnly: true })
  try { for (const row of db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence').all()) found.push(JSON.parse(row.message)) } catch { /* another table file */ } finally { db.close() }
 }
 assert.ok(found.length || files.length, 'a local database exists under .wrangler')
 return found
}
const latest = async (root, to, pattern) => (await outbox(root)).filter(m => m.to.includes(to) && pattern.test(m.subject + m.text)).at(-1)

async function fits(page, label) {
 const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }))
 assert.ok(scroll <= width + 1, `${label}: no sideways scrolling (${scroll} > ${width})`)
}

export async function esignPage(browser, { root, origin, run, evidence, ownerEmail }) {
 await run('esign-disclosure', { reviewed: true, contactName: 'Example hiring desk', contactEmail: 'hiring@example.test' })
 const body = 'Dear {{candidateName}},\nWe offer {{title}} at {{location}}, {{employmentType}}, from {{startDate}}.\nPay {{pay}}. Bonus {{bonus}}. Equity {{equity}}.\n{{contingencies}}\n{{terms}}'
 const template = await run('offer-template', { name: 'Native signed offer', body, contingencies: 'Subject to the employer-reviewed work authorization requirements.', normalApprover: 'approver@dev.localhost', exceptionApprover: ownerEmail, native: true, countersign: true, signer: ownerEmail, reviewed: true })
 for (const width of [1440, 390]) {
  const name = width === 1440 ? 'Rowan Eastman' : 'Mina Okafor', email = `native.${width}@example.test`
  const job = await run('vacancy', { title: `Estimator — native signing ${width}`, location: 'Brooklyn, NY', manager: 'manager@dev.localhost', headcount: 1, compensation: { currency: 'USD', min: 6500000, max: 8500000, period: 'year' } })
  await run('rubric', { id: job.id, criteria: [{ name: 'Safety', description: 'Explains safe site operations' }] })
  await run('interview-plan', { id: job.id, plan: [{ name: 'Work review', stageName: 'Interview' }] })
  const asked = await run('request-vacancy-approval', { id: job.id, approver: ownerEmail })
  await run('decide-approval', { id: asked.id, decision: 'approved', version: asked.version, reason: 'Budget approved' })
  await run('publish', { id: job.id })
  const added = await run('candidate', { name, email, source: 'Referral', consentBasis: 'referral', consentNote: 'Agreed to apply', vacancy: job.id })
  const manager = await session(browser, root, origin, 'manager', width), approver = await session(browser, root, origin, 'approver', width), owner = await session(browser, root, origin, 'owner', width)
  const phone = await browser.newContext({ viewport: { width, height: 900 } })
  try {
   const errors = []
   const offer = await api(manager.context, origin, 'offer', { application: added.application.id, title: job.title, salary: { currency: 'USD', amount: 7500000, period: 'year' }, startDate: '2026-12-07', terms: 'Forty hours a week.', opening: (await current(manager.context, origin)).vacancies.find(v => v.id === job.id).openings[0].id, offerTemplate: { id: template.id, version: 1 }, location: 'Brooklyn, NY', employmentType: 'full-time', equity: 'No equity granted' })
   const asking = await api(manager.context, origin, 'request-offer-approval', { id: offer.id })
   await api(approver.context, origin, 'decide-approval', { id: asking.id, version: asking.version, decision: 'approved', reason: 'Reviewed exact document' })

   // The hiring manager sends it for native signature from the decisions tab.
   const page = manager.page; page.on('pageerror', e => errors.push(e.message))
   await page.goto(origin + '/app?application=' + added.application.id)
   await page.getByRole('tab', { name: 'Decisions', exact: true }).click()
   const panel = page.getByRole('region', { name: 'Native signature' })
   await panel.getByRole('button', { name: 'Send for native signature' }).click()
   await panel.getByText('out for native signature').waitFor()
   await fits(page, 'sent')
   await page.screenshot({ path: join(evidence, `OFFER-005-sent-${width}.png`), fullPage: true })

   // The candidate, on a phone-width page with no sign-in: code, consent, review, sign.
   const link = (await latest(root, email, /sent you an offer/)).text.match(/(http\S+\/sign\/[0-9a-f]{64})/)[1]
   const sign = await phone.newPage(); sign.on('pageerror', e => errors.push(e.message))
   await sign.goto(link)
   await sign.getByRole('heading', { name: 'Offer for signature' }).waitFor()
   await sign.getByRole('button', { name: 'Email me a code' }).click()
   await sign.getByText(/We emailed a code/).waitFor()
   await fits(sign, 'verify')
   await sign.screenshot({ path: join(evidence, `OFFER-005-verify-${width}.png`), fullPage: true })
   const code = (await latest(root, email, /one-time code/)).text.match(/code is (\d{6})/)[1]
   await sign.getByLabel('Six-digit code').fill(code)
   await sign.getByRole('button', { name: 'Verify' }).click()
   await sign.getByRole('heading', { name: 'Consent to electronic signing' }).waitFor()
   await fits(sign, 'consent')
   await sign.screenshot({ path: join(evidence, `OFFER-005-consent-${width}.png`), fullPage: true })
   await sign.getByLabel(/I have read this and I agree/).check()
   await sign.getByRole('button', { name: 'Agree', exact: true }).click()
   await sign.getByRole('heading', { name: 'Review the offer' }).waitFor()
   assert.ok((await sign.locator('pre.sign-doc').textContent()).includes('USD 75000.00 per year'))
   await fits(sign, 'review')
   await sign.screenshot({ path: join(evidence, `OFFER-005-sign-${width}.png`), fullPage: true })
   await sign.getByLabel('Type your full name').fill(name)
   await sign.getByRole('button', { name: 'Sign', exact: true }).click()
   await sign.getByText(/waits for Example Builders to countersign/).waitFor()
   await fits(sign, 'signed')

   // The designated signer countersigns for the employer; the sealed offer and certificate follow.
   const signer = owner.page; signer.on('pageerror', e => errors.push(e.message))
   await signer.goto(origin + '/app?application=' + added.application.id)
   await signer.getByRole('tab', { name: 'Decisions', exact: true }).click()
   const mine = signer.getByRole('region', { name: 'Native signature' })
   await mine.getByText('signed by candidate, awaiting countersignature').waitFor()
   await fits(signer, 'countersign')
   await signer.screenshot({ path: join(evidence, `OFFER-005-countersign-${width}.png`), fullPage: true })
   await mine.getByRole('button', { name: 'Countersign for the employer' }).click()
   await mine.getByRole('link', { name: 'Signed offer (PDF)' }).waitFor()
   await fits(signer, 'completed')
   await signer.screenshot({ path: join(evidence, `OFFER-005-completed-${width}.png`), fullPage: true })
   const done = (await current(owner.context, origin)).offers.find(o => o.id === offer.id)
   assert.equal(done.status, 'accepted'); assert.equal(done.signature.kind, 'native')
   const pdf = await owner.context.request.get(origin + '/api/lodge/download/document/' + done.signature.document)
   assert.equal(pdf.status(), 200)
   assert.deepEqual(errors, [])
  } finally { await phone.close(); await owner.context.close(); await approver.context.close(); await manager.context.close() }
 }
}
