import assert from 'node:assert/strict'
import { iconTooltips } from './icon-tooltips.mjs'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { applicationEmailFixture, form } from './application-email-flow.mjs'
import { browserWidths } from './browser-widths.mjs'

export async function applicationEmailPage(browser, evidence, { live = false } = {}) {
 const bindings = live ? { MAIL_PROVIDER: 'sendgrid', MAIL_API_KEY: process.env.MAIL_API_KEY, MAIL_FROM: process.env.MAIL_FROM } : { MAIL_PROVIDER: 'sendgrid' }
 if (live) for (const key of ['MAIL_API_KEY', 'MAIL_FROM', 'TEST_MAIL_TO', 'QA_INBOX_RECEIPT_TOKEN']) assert.ok(process.env[key], key + ' is required')
 const results = []
 await mkdir(evidence, { recursive: true })
 for (const width of browserWidths) {
   const h = await applicationEmailFixture({ bindings, liveMail: live, activate: false, ...(live ? {} : { clock: '2026-10-30T14:15:00.000Z' }) })
   const marker = 'Lodge acknowledgment ' + crypto.randomUUID(), started = Date.now()
   let received
   const context = await browser.newContext({ viewport: { width, height: 1000 } })
   await context.addCookies(h.owner.split('; ').map(value => { const i = value.indexOf('='); return { name: value.slice(0, i), value: value.slice(i + 1), url: h.origin } }))
   const page = await context.newPage()
   const screenshot = async name => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' fits ' + width)
    await page.screenshot({ path: evidence + '/' + name + '-' + width + '.png', fullPage: true, mask: [page.locator('[data-recovery-code]')] })
    await iconTooltips(page)
   }
   try {
    await page.goto(h.origin + '/application-emails/settings?vacancy=' + h.job.id)
    await page.getByText('Review installation sending', { exact: true }).click()
    await page.getByLabel('Monitored employer reply-to', { exact: true }).fill('recruiting@example.test')
    await page.getByLabel('Required employer footer', { exact: true }).fill('Example Builders, 10 Main Street, New York. Reply to recruiting@example.test to opt out.')
    await page.getByLabel('The employer monitors this mailbox', { exact: false }).check()
    await page.getByLabel('The employer reviewed this exact footer', { exact: false }).check()
    await screenshot('application-email-sender-review')
    await page.getByRole('button', { name: 'Verify sender and enable installation mail', exact: true }).click()
    await page.getByRole('status').waitFor()
    await page.getByText('Review an email template', { exact: true }).click()
    await page.getByLabel('Application language code').fill('en')
    await page.getByLabel('Subject', { exact: true }).fill(marker + ': {{jobTitle}}')
    await page.getByLabel('Footer in this language', { exact: true }).fill('Example Builders, 10 Main Street, New York. Reply to recruiting@example.test to opt out.')
    await page.getByLabel('Body', { exact: true }).fill('Thank you {{candidateName}}. Your application receipt is {{receiptCode}}.')
    await page.getByRole('button', { name: 'Preview template', exact: true }).click()
    await page.getByRole('heading', { name: 'Exact template preview' }).waitFor()
    await screenshot('application-email-template')
    await page.getByLabel('I, Olive Owner, have reviewed', { exact: false }).check()
    await page.getByRole('button', { name: 'Review and save template', exact: true }).click()
    await page.getByRole('status').waitFor()
    await page.getByText('Configure sending', { exact: true }).click()
    await page.getByLabel('Acknowledge new applications', { exact: true }).check()
    await page.getByRole('button', { name: 'Apply sending settings' }).click()
    await page.getByText('Acknowledgments: On.', { exact: false }).waitFor()
    await screenshot('application-email-settings')
     await page.goto(h.origin + '/jobs/' + h.en.slug)
     await page.getByLabel('Full name', { exact: true }).fill('Jordan Rivera')
     await page.getByLabel('Email', { exact: true }).fill(live ? process.env.TEST_MAIL_TO : 'jordan@example.test')
     await page.getByLabel('Can you work at night?', { exact: false }).selectOption('Weekdays')
     await page.locator('input[name="consent"]').check()
     const values = await page.locator('form[method="post"]').evaluate(f => Object.fromEntries([...new FormData(f).entries()].filter(([, v]) => typeof v === 'string')))
     await screenshot('application-form')
     await page.getByRole('button', { name: 'Submit application', exact: true }).click()
     await page.getByRole('heading', { name: 'Application received', exact: true }).waitFor()
     const text = await page.locator('main').innerText(), code = /LDG-[0-9A-F]{8}/.exec(text)[0]
     const state = await h.state(), application = state.receipts.find(r => r.id === code).application
     received = { values, code, application }
     await screenshot('application-receipt')
     const outcome = state.applicationEmails.find(m => m.application === application)
     if (outcome.status !== 'handed') throw Error('SendGrid result: ' + outcome.status + ': ' + (outcome.reason ?? 'no provider reason'))
     assert.ok(outcome.providerMessageId)
     const replay = await h.send('/jobs/' + h.en.slug, form(values))
     assert.equal(replay.status, 200); assert.ok(replay.text.includes(code))
     assert.equal((await h.state()).applicationEmails.filter(m => m.application === application).length, 1)
     if (live) {
      const receipts = async () => {
       const url = new URL('https://rer-qa-inbox.runeditrun.workers.dev/receipts')
       url.search = new URLSearchParams({ to: process.env.TEST_MAIL_TO, contains: code, since: String(started), limit: '20' })
       const response = await fetch(url, { headers: { authorization: 'Bearer ' + process.env.QA_INBOX_RECEIPT_TOKEN } })
       assert.equal(response.status, 200, 'QA inbox receipt HTTP status')
       return (await response.json()).receipts
      }
      let inbox = []
      for (let i = 0; i < 18; i++) { inbox = await receipts(); if (inbox.length) break; await new Promise(r => setTimeout(r, 5000)) }
      assert.equal(inbox.length, 1, 'exactly one received email after submission replay')
      assert.ok(inbox[0].excerpt.includes(code)); assert.ok(inbox[0].subject.includes(marker))
      assert.equal(inbox[0].auth.dmarc, 'pass')
      await new Promise(r => setTimeout(r, 10000))
      assert.equal((await receipts()).length, 1, 'replay delivered no second email')
      results.push({ providerMessageId: outcome.providerMessageId, receiptId: inbox[0].id, deliveredAt: inbox[0].receivedAt, receiptCode: code, dmarc: inbox[0].auth.dmarc, duplicateCount: 0 })
     }
    await page.goto(h.origin + '/application-emails/settings?vacancy=' + h.job.id)
    await page.getByText('Application acknowledgment · en · version', { exact: false }).first().click()
    await page.getByRole('link', { name: 'Edit this template', exact: true }).first().click()
    await page.getByRole('heading', { name: 'Application email settings', exact: true }).waitFor()
    await page.getByLabel('Preview recipient', { exact: true }).selectOption(received.application)
    await page.getByRole('button', { name: 'Preview template', exact: true }).click()
    await page.getByRole('heading', { name: 'Exact template preview' }).waitFor()
    const preview = page.getByRole('region', { name: 'Exact template preview', exact: true })
    assert.ok((await preview.innerText()).includes(received.code))
    assert.ok((await preview.innerText()).includes(live ? process.env.TEST_MAIL_TO : 'jordan@example.test'))
    await screenshot('application-email-filled-preview')
    await page.goto(h.origin + '/application-emails/application/' + received.application)
    await page.getByText('Handed to provider', { exact: true }).waitFor()
    await screenshot('application-email-outcome')
    await page.goto(h.origin + '/application-emails/settings?vacancy=' + h.job.id)
    await page.getByText('Configure sending', { exact: true }).click()
    await page.getByLabel('Acknowledge new applications', { exact: true }).uncheck()
    await page.getByRole('button', { name: 'Apply sending settings' }).click()
    await page.goto(h.origin + '/jobs/' + h.en.slug)
    await page.getByLabel('Full name', { exact: true }).fill('Taylor Reed ' + width)
    await page.getByLabel('Email', { exact: true }).fill(live ? process.env.TEST_MAIL_TO : 'taylor@example.test')
    await page.getByLabel('Can you work at night?', { exact: false }).selectOption('Weekdays')
    await page.locator('input[name="consent"]').check()
    await page.getByRole('button', { name: 'Submit application', exact: true }).click()
    await page.getByRole('heading', { name: 'Application received', exact: true }).waitFor()
    const disabledCode = /LDG-[0-9A-F]{8}/.exec(await page.locator('main').innerText())[0]
    const current = await h.state(), disabledApplication = current.receipts.find(r => r.id === disabledCode).application
    assert.equal(current.applicationEmails.filter(m => m.application === disabledApplication).length, 0)
    await screenshot('disabled-email-receipt')
    if (!live) {
      await h.command('unpublish', { id: h.job.id, reason: 'Review exact delayed status timing' })
      const previewTiming = async () => {
        await page.goto(h.origin + '/application-emails/settings?vacancy=' + h.job.id)
        await page.getByText('Review status timing', { exact: true }).click()
        await page.getByLabel('Delay in eligible local days', { exact: true }).fill('1')
        await page.getByLabel('Trial stage event time (ISO instant)', { exact: true }).fill('2026-10-30T14:15:00.000Z')
        await page.getByRole('button', { name: 'Preview status timing', exact: true }).click()
        await page.getByRole('heading', { name: 'Status timing preview', exact: true }).waitFor()
        if (width === 1440) {
          const text = await page.getByRole('region', { name: 'Status timing preview' }).innerText()
          assert.ok(text.includes('2026-11-02T15:15:00.000Z')); assert.ok(text.includes('EST'))
          assert.ok(text.includes('Repeated daylight-saving times use the first occurrence'))
          assert.ok(text.includes('Production contact: 0'))
        }
      }
      await previewTiming()
      await screenshot('application-email-timing-preview')
      const activateTiming = async () => {
        await page.getByLabel('I approve this exact reviewed timing for production', { exact: true }).check()
        await page.getByRole('button', { name: 'Activate reviewed timing', exact: true }).click()
        await page.getByRole('status').waitFor()
      }
      await activateTiming()
      await page.getByText('Review status timing', { exact: true }).click()
      await page.getByRole('button', { name: 'Rollback status timing', exact: true }).click()
      await page.getByRole('status').waitFor()
      if (width === 1440) assert.equal((await h.state()).vacancies.find(v => v.id === h.job.id).applicationEmailTiming, null)
      await previewTiming(); await activateTiming()
      await page.getByText('Review an email template', { exact: true }).click()
      await page.locator('select[name="kind"]').selectOption('status')
      const stage = h.job.stages[1].id
      await page.locator('select[name="stage"]').selectOption(stage)
      await page.getByLabel('Application language code').fill('en')
      await page.getByLabel('Subject', { exact: true }).fill('Reviewed delayed update')
      await page.getByLabel('Body', { exact: true }).fill('Thank you {{candidateName}}. We are reviewing your application.')
      await page.getByLabel('Footer in this language', { exact: true }).fill('Example Builders, 10 Main Street, New York. Reply to recruiting@example.test to opt out.')
      await page.getByLabel('Preview recipient', { exact: true }).selectOption(received.application)
      await page.getByRole('button', { name: 'Preview template', exact: true }).click()
      await page.getByRole('heading', { name: 'Exact template preview' }).waitFor()
      await screenshot('application-email-delayed-template')
      await page.getByLabel('I, Olive Owner, have reviewed', { exact: false }).check()
      await page.getByRole('button', { name: 'Review and save template', exact: true }).click()
      await page.getByRole('status').waitFor()
      await h.policy(false, [stage]); await h.command('publish', { id: h.job.id })
      await h.command('move', { application: received.application, to: stage, reason: 'Reviewed stage' })
      await page.goto(h.origin + '/application-emails/application/' + received.application)
      await page.getByText('Pending', { exact: true }).waitFor()
      if (width === 1440) {
        const text = await page.locator('main').innerText()
        assert.ok(text.includes('2026-11-02T15:15:00.000Z')); assert.ok(text.includes('EST'))
      }
      await screenshot('application-email-delayed-outcome')
    }
   } finally { await context.close(); await h.close() }
  }
 return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const { chromium } = await import(process.env.LODGE_PLAYWRIGHT_MODULE || '@playwright/test')
 const browser = await chromium.launch({ headless: true, ...(process.env.LODGE_CHROMIUM ? { executablePath: process.env.LODGE_CHROMIUM } : {}), args: ['--use-mock-keychain', '--password-store=basic', ...(process.env.LODGE_CHROMIUM ? ['--no-sandbox'] : [])] })
 try { console.log(JSON.stringify({ applicationEmailJourney: 'passed', live: process.env.LODGE_LIVE_MAIL === '1', outcomes: await applicationEmailPage(browser, process.env.LODGE_EVIDENCE || '.cache/application-email-proof', { live: process.env.LODGE_LIVE_MAIL === '1' }) })) }
 finally { await browser.close() }
}
