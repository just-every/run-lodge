import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readDevKey, signInAs } from '../src/modules/operator-auth/dev/sign-in-as.mjs'
import { session } from './browser-journey.mjs'

async function shot(page, evidence, name, width) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' fits viewport')
  // Candidate pages use plain text controls; no unlabeled decorative icon system.
  assert.equal(await page.locator('main svg, main [role="img"], main .icon').count(), 0)
  await page.screenshot({ path: join(evidence, `candidate-${name}-${width}.png`), fullPage: true })
}

export async function candidatePage(browser, { root, origin, run, evidence, ownerEmail }) {
  const job = await run('vacancy', { title: 'Residential site coordinator', location: 'Brooklyn, NY', manager: ownerEmail, headcount: 3, description: 'Coordinate safe residential work and clear schedules.', compensation: { currency: 'USD', min: 8000000, max: 10000000, period: 'year' } })
  await run('rubric', { id: job.id, criteria: [{ name: 'Safety', description: 'A practical example of safe site work' }] })
  await run('interview-plan', { id: job.id, plan: [{ name: 'Site walk', stageName: 'Interview' }] })
  const approval = await run('request-vacancy-approval', { id: job.id, approver: ownerEmail })
  await run('decide-approval', { id: approval.id, decision: 'approved', version: approval.version, reason: 'Budget and plan reviewed' })
  const live = await run('publish', { id: job.id })
  const key = await readDevKey(root)
  for (const width of [1440, 390]) {
    const employer = await session(browser, root, origin, 'owner', width)
    const visitor = await browser.newContext({ viewport: { width, height: 1000 } })
    let candidate
    try {
      const page = await visitor.newPage()
      const apply = async (name, email) => {
        await page.goto(origin + '/jobs/' + live.slug)
        await page.getByRole('textbox', { name: 'Full name', exact: true }).fill(name)
        await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email)
        await page.getByRole('checkbox', { name: /I have read privacy notice/ }).check()
        await shot(page, evidence, 'application-' + name.split(' ')[0].toLowerCase(), width)
        await page.getByRole('button', { name: 'Submit application', exact: true }).click()
        await page.getByRole('heading', { name: 'Application received', exact: true }).waitFor()
        const receipt = (await page.textContent('main')).match(/LDG-[0-9A-F]{8}/)[0]
        return { receipt, recovery: await page.locator('[data-recovery-code]').textContent() }
      }
      const email = `candidate-${width}@example.test`
      const alice = await apply('Avery Hudson', email)
      await shot(page, evidence, 'submitted', width)
      await page.getByRole('link', { name: 'Recover a receipt', exact: true }).click()
      await shot(page, evidence, 'recovery-form', width)
      await page.getByRole('textbox', { name: 'Private recovery code', exact: true }).fill(alice.recovery)
      await page.getByRole('button', { name: 'Recover receipt', exact: true }).click()
      await page.getByRole('heading', { name: 'Application received', exact: true }).waitFor()
      assert.ok((await page.textContent('main')).includes(alice.receipt))
      assert.equal(await page.getByRole('link', { name: 'Your privacy requests', exact: true }).count(), 0)
      await shot(page, evidence, 'recovered', width)
      const bob = await apply('Blair Okafor', `other-candidate-${width}@example.test`)
      const signedOut = await page.goto(origin + '/candidate')
      assert.equal(signedOut.status(), 401)
      await page.getByRole('link', { name: /sign in/i }).waitFor()
      await shot(page, evidence, 'signin-required', width)
      const invitation = await employer.context.request.post(origin + '/auth/invite', { headers: { origin }, data: { email, displayName: 'Avery Hudson', role: 'member', returnTo: '/candidate' } })
      assert.equal(invitation.status(), 202, await invitation.text())
      const login = await signInAs({ origin, key, as: email, returnTo: '/candidate' })
      candidate = await browser.newContext({ viewport: { width, height: 1000 } })
      await candidate.addCookies(login.cookies.map(cookie => ({ ...cookie, url: origin })))
      const account = await candidate.newPage()
      await account.goto(origin + '/candidate')
      const receiptLink = account.locator(`a[href="/candidate/receipts/${alice.receipt}"]`)
      await receiptLink.waitFor()
      assert.ok(!(await account.textContent('main')).includes(bob.receipt))
      await shot(account, evidence, 'receipt-list', width)
      await receiptLink.click()
      await account.getByRole('heading', { name: 'Application received', exact: true }).waitFor()
      assert.ok((await account.textContent('main')).includes(alice.receipt))
      await shot(account, evidence, 'own-receipt', width)
      await account.getByRole('link', { name: 'Your privacy requests', exact: true }).click()
      await account.getByRole('heading', { name: 'Your privacy requests', exact: true }).waitFor()
      await account.getByLabel('See a copy of my information', { exact: true }).check()
      await shot(account, evidence, 'access-request', width)
      await account.getByRole('button', { name: 'Send request', exact: true }).click()
      await account.getByRole('heading', { name: 'Your privacy request', exact: true }).waitFor()
      assert.match(await account.textContent('main'), /Verified[\s\S]*Answer due by[\s\S]*Being processed/)
      const statusPath = new URL(account.url()).pathname
      await shot(account, evidence, 'access-status', width)
      const other = await account.goto(origin + '/candidate/receipts/' + bob.receipt)
      assert.equal(other.status(), 404)
      await shot(account, evidence, 'other-receipt-refused', width)
      const otherRequest = await account.goto(origin + '/candidate/receipts/' + bob.receipt + '/requests')
      assert.equal(otherRequest.status(), 404)
      await shot(account, evidence, 'other-requests-refused', width)
      await account.goto(origin + statusPath)
      await account.getByRole('button', { name: 'Sign out', exact: true }).click()
      await account.getByRole('heading', { name: 'Sign in required', exact: true }).waitFor()
      for (const [name, path] of [['ended-receipt', '/candidate/receipts/' + alice.receipt], ['ended-request', statusPath]]) {
        const refusal = await account.goto(origin + path)
        assert.equal(refusal.status(), 401)
        await account.getByRole('link', { name: /sign in/i }).waitFor()
        await shot(account, evidence, name, width)
      }
    } finally { await candidate?.close(); await visitor.close(); await employer.context.close() }
  }
}
