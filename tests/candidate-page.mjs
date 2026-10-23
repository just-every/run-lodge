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
      const state = await (await employer.context.request.get(origin + '/api/lodge/state')).json()
      const app = state.applications.find(a => state.receipts.some(r => r.id === alice.receipt && r.application === a.id))
      await employer.page.goto(origin + '/app?application=' + app.id)
      const publish = employer.page.getByRole('link', { name: 'Publish candidate progress and request information', exact: true })
      await publish.waitFor()
      const close = employer.page.getByRole('button', { name: 'Close the application', exact: true })
      const tooltip = employer.page.getByRole('tooltip', { name: 'Close the application', exact: true })
      await close.hover()
      assert.equal(await tooltip.evaluate(el => getComputedStyle(el).transitionDelay), '0.3s, 0.3s', 'hover tooltip uses the 300 ms delay')
      await tooltip.waitFor()
      await employer.page.mouse.move(0, 0)
      await close.focus()
      assert.equal(await tooltip.evaluate(el => getComputedStyle(el).transitionDelay), '0s', 'keyboard focus shows the tooltip immediately')
      await tooltip.waitFor()
      await employer.page.screenshot({ path: join(evidence, `candidate-employer-link-${width}.png`), fullPage: true })
      await publish.click()
      await employer.page.getByLabel('Published progress', { exact: true }).selectOption('In review')
      await employer.page.getByLabel('Request additional information (optional)', { exact: true }).fill('When could you start?')
      await shot(employer.page, evidence, 'employer-update', width)
      await employer.page.getByRole('button', { name: 'Publish candidate update', exact: true }).click()
      await employer.page.getByRole('heading', { name: 'When could you start?', exact: true }).waitFor()
      await shot(employer.page, evidence, 'employer-published', width)
      const currentJob = state.vacancies.find(v => v.id === app.vacancy)
      const future = new Date(Date.now() + 10 * 86400000); future.setUTCHours(15, 0, 0, 0)
      const proposed = await run('interview', { application: app.id, planItem: currentJob.plan[0].id, participants: [ownerEmail], slots: [future.toISOString()], durationMinutes: 30, timezone: 'America/New_York' })
      await run('availability', { interview: proposed.id, slots: [0] })
      await employer.page.goto(origin + '/app?application=' + app.id)
      await employer.page.getByRole('tab', { name: 'Interviews', exact: true }).click()
      await employer.page.getByLabel('Share this interview’s title, location and panel-approved times for candidate booking and rescheduling', { exact: true }).check()
      await employer.page.getByRole('button', { name: 'Save candidate booking', exact: true }).click()
      await employer.page.getByRole('button', { name: 'Close the application', exact: true }).focus()
      await employer.page.getByRole('tooltip', { name: 'Close the application', exact: true }).waitFor()
      await employer.page.screenshot({ path: join(evidence, `candidate-employer-booking-${width}.png`), fullPage: true })

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

// Real server-rendered account pages and real D1; only the outbound mail edge is replaced.
export async function candidateAccountPage(browser, { evidence }) {
  const { candidateFixture, latestMail } = await import('./candidate-flow.mjs')
  for (const width of [1440, 390]) {
    const { h, alice, bob, cookie } = await candidateFixture()
    const context = await browser.newContext({ viewport: { width, height: 1000 } })
    try {
      await context.addCookies(cookie.split('; ').map(part => ({ name: part.split('=')[0], value: part.slice(part.indexOf('=') + 1), url: h.origin })))
      const page = await context.newPage(), path = alice.path + '/account'
      await h.command('candidate-progress', { application: alice.app.id, progress: 'Interviewing', message: 'We would like to meet you.', request: 'When could you start?' })
      await page.goto(h.origin + path)
      await page.getByRole('status').getByText('Interviewing', { exact: true }).waitFor()
      await page.getByLabel('Your answer', { exact: true }).fill('Two weeks after notice.')
      await shot(page, evidence, 'account-answer', width)
      await page.getByRole('button', { name: 'Send answer', exact: true }).focus()
      await page.keyboard.press('Enter')
      await page.getByText('Your answer: Two weeks after notice.', { exact: true }).waitFor()
      await page.getByLabel('Preferred contact', { exact: true }).selectOption('none')
      await page.getByLabel('You may contact me about other suitable roles.', { exact: true }).uncheck()
      await page.getByRole('button', { name: 'Save contact preferences', exact: true }).click()
      await shot(page, evidence, 'account-preferences', width)
      assert.equal(await page.getByLabel('Preferred contact', { exact: true }).inputValue(), 'none')
      const newEmail = 'account-browser-new@example.test'
      await page.getByLabel('New email', { exact: true }).fill(newEmail)
      await page.getByRole('button', { name: 'Verify new email', exact: true }).click()
      await page.getByRole('heading', { name: 'Check your new email', exact: true }).waitFor()
      await shot(page, evidence, 'email-sent', width)
      const mail = await latestMail(h, newEmail)
      await page.goto(mail.text.match(/http:\/\/\S+/)[0])
      await page.getByRole('heading', { name: 'Confirm your new email', exact: true }).waitFor()
      await shot(page, evidence, 'email-confirm', width)
      await page.getByRole('button', { name: 'Confirm email change', exact: true }).click()
      await page.getByText(newEmail, { exact: true }).waitFor()
      await shot(page, evidence, 'email-verified', width)
      assert.equal((await page.goto(h.origin + bob.path + '/account')).status(), 404)
      await shot(page, evidence, 'account-other-refused', width)
      await page.goto(h.origin + path)
      await page.getByLabel('I want to withdraw this application.', { exact: true }).check()
      await shot(page, evidence, 'withdraw-confirm', width)
      await page.getByRole('button', { name: 'Withdraw application', exact: true }).click()
      await page.getByRole('status').getByText('Withdrawn', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Send answer', exact: true }).count(), 0)
      await shot(page, evidence, 'withdrawn', width)
    } finally { await context.close(); await h.close() }
  }
}

export async function candidateBookingPage(browser, { evidence }) {
  const { bookingFixture } = await import('./candidate-flow.mjs')
  for (const width of [1440, 390]) {
    const { h, cookie, bob, interview, path, slots } = await bookingFixture()
    const context = await browser.newContext({ viewport: { width, height: 1000 } })
    try {
      await context.addCookies(cookie.split('; ').map(part => ({ name: part.split('=')[0], value: part.slice(part.indexOf('=') + 1), url: h.origin })))
      const page = await context.newPage()
      await page.goto(h.origin + path)
      await page.getByRole('heading', { name: 'Your interview', exact: true }).waitFor()
      await page.getByLabel('Interview time', { exact: true }).selectOption(slots[0])
      await shot(page, evidence, 'booking-choose', width)
      await page.getByRole('button', { name: 'Book interview', exact: true }).focus()
      await page.keyboard.press('Enter')
      await page.getByRole('status').getByText(/Booked:/).waitFor()
      await shot(page, evidence, 'booking-confirmed', width)
      await page.getByLabel('Interview time', { exact: true }).selectOption(slots[1])
      await shot(page, evidence, 'reschedule-choose', width)
      await page.getByRole('button', { name: 'Reschedule interview', exact: true }).click()
      assert.equal((await h.state()).interviews.find(iv => iv.id === interview.id).start, slots[1])
      assert.equal(await page.getByLabel('Interview time', { exact: true }).inputValue(), slots[1], 'the selected time stays aligned with the confirmed booking')
      await shot(page, evidence, 'rescheduled', width)
      assert.equal((await page.goto(h.origin + bob.path + '/interviews/' + interview.id)).status(), 404)
      await shot(page, evidence, 'booking-other-refused', width)
      await h.command('cancel-interview', { interview: interview.id, reason: 'Employer canceled' })
      await page.goto(h.origin + path)
      await page.getByRole('status').getByText('Canceled', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Reschedule interview', exact: true }).count(), 0)
      await shot(page, evidence, 'booking-canceled', width)
    } finally { await context.close(); await h.close() }
  }
}
