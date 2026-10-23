import { browserWidths } from './browser-widths.mjs'
// OFFER-005 through the real screens at 1440 and 390: the candidate's pages in a browser (tests/esign.mjs, with the test
// mail edge, because local `rer dev` captures no mail) and, on the running app, the hiring manager's send and the
// designated signer's countersign and completed panels.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { api, current, session } from './browser-journey.mjs'
import { candidateScreens } from './esign.mjs'

async function fits(page, label) {
 const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }))
 assert.ok(scroll <= width + 1, `${label}: no sideways scrolling (${scroll} > ${width})`)
}

export async function esignPage(browser, { root, origin, run, evidence, ownerEmail }) {
 await candidateScreens(browser, evidence)
 await run('esign-disclosure', { reviewed: true, contactName: 'Example hiring desk', contactEmail: 'hiring@example.test' })
 const body = 'Dear {{candidateName}},\nWe offer {{title}} at {{location}}, {{employmentType}}, from {{startDate}}.\nPay {{pay}}. Bonus {{bonus}}. Equity {{equity}}.\n{{contingencies}}\n{{terms}}'
 const template = await run('offer-template', { name: 'Native signed offer', body, contingencies: 'Subject to the employer-reviewed work authorization requirements.', normalApprover: 'approver@dev.localhost', exceptionApprover: ownerEmail, native: true, countersign: true, signer: ownerEmail, reviewed: true })
 for (const width of browserWidths) {
  const name = width === 1440 ? 'Rowan Eastman' : 'Mina Okafor', email = `native.${width}@example.test`
  const job = await run('vacancy', { title: `Estimator — native signing ${width}`, location: 'Brooklyn, NY', manager: 'manager@dev.localhost', headcount: 1, compensation: { currency: 'USD', min: 6500000, max: 8500000, period: 'year' } })
  await run('rubric', { id: job.id, criteria: [{ name: 'Safety', description: 'Explains safe site operations' }] })
  await run('interview-plan', { id: job.id, plan: [{ name: 'Work review', stageName: 'Interview' }] })
  const asked = await run('request-vacancy-approval', { id: job.id, approver: ownerEmail })
  await run('decide-approval', { id: asked.id, decision: 'approved', version: asked.version, reason: 'Budget approved' })
  await run('publish', { id: job.id })
  const added = await run('candidate', { name, email, source: 'Referral', consentBasis: 'referral', consentNote: 'Agreed to apply', vacancy: job.id })
  const manager = await session(browser, root, origin, 'manager', width), approver = await session(browser, root, origin, 'approver', width), owner = await session(browser, root, origin, 'owner', width)
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

   // The designated signer's own panel. Local `rer dev` captures no mail, so a candidate signature cannot be produced
   // here; the countersign and completed layouts are checked on the real screen with the saved state answered as the
   // API test proves it (the behaviour itself is asserted through the API in tests/esign.mjs).
   const signer = owner.page; signer.on('pageerror', e => errors.push(e.message))
   const answer = async patch => {
    await signer.unroute('**/api/lodge/state')
    await signer.route('**/api/lodge/state', async route => {
     const response = await route.fetch(), state = await response.json()
     state.offers = state.offers.map(o => o.id === offer.id ? patch(o) : o)
     await route.fulfill({ response, json: state })
    })
   }
   await answer(o => ({ ...o, esign: { ...o.esign, status: 'candidate-signed', label: 'signed by candidate, awaiting countersignature', countersign: { required: true, signer: ownerEmail }, signature: { name } } }))
   await signer.goto(origin + '/app?application=' + added.application.id)
   await signer.getByRole('tab', { name: 'Decisions', exact: true }).click()
   const mine = signer.getByRole('region', { name: 'Native signature' })
   await mine.getByText('signed by candidate, awaiting countersignature').waitFor()
   await mine.getByRole('button', { name: 'Countersign for the employer' }).waitFor()
   await fits(signer, 'countersign')
   await signer.screenshot({ path: join(evidence, `OFFER-005-countersign-${width}.png`), fullPage: true })
   await answer(o => ({ ...o, status: 'accepted', esign: { ...o.esign, status: 'completed', label: 'accepted, signed in Lodge (native e-signature)' }, signature: { kind: 'native', label: 'accepted, signed in Lodge (native e-signature)', document: 'x', certificate: 'y', sha256: 'a'.repeat(64) } }))
   await signer.goto(origin + '/app?application=' + added.application.id)
   await signer.getByRole('tab', { name: 'Decisions', exact: true }).click()
   await mine.getByRole('link', { name: 'Signed offer (PDF)' }).waitFor()
   await fits(signer, 'completed')
   await signer.screenshot({ path: join(evidence, `OFFER-005-completed-${width}.png`), fullPage: true })
   assert.deepEqual(errors, [])
  } finally { await owner.context.close(); await approver.context.close(); await manager.context.close() }
 }
}
