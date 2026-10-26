import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { browserWidths } from './browser-widths.mjs'
import { bulkInvitationFixture, bulkInvitationMails } from './bulk-invitations-flow.mjs'
import { iconTooltips } from './icon-tooltips.mjs'

/** A real authenticated HTML journey, with provider serialization faked only at the network edge. */
export async function bulkInvitationsPage(browser, evidence) {
  await mkdir(evidence, { recursive: true })
  const outcomes = []
  for (const width of browserWidths) {
    const h = await bulkInvitationFixture(), context = await browser.newContext({ viewport: { width, height: 1000 } })
    await context.addCookies(h.owner.split('; ').map(value => { const i = value.indexOf('='); return { name: value.slice(0, i), value: value.slice(i + 1), url: h.origin } }))
    const page = await context.newPage()
    const screenshot = async name => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' fits ' + width)
      await page.screenshot({ path: evidence + '/' + name + '-' + width + '.png', fullPage: true })
      await iconTooltips(page)
    }
    try {
      const before = await bulkInvitationMails(h)
      await page.goto(h.origin + '/enterprise/invitations')
      await page.getByLabel('Invitation list', { exact: true }).fill(h.source)
      await page.getByRole('button', { name: 'Preview invitations', exact: true }).click()
      await page.getByRole('heading', { name: 'Review invitations', exact: true }).waitFor()
      const preview = page.getByRole('region', { name: 'Invitation preview', exact: true })
      assert.equal(await preview.getByRole('article').count(), 25)
      assert.equal(await preview.getByText('New', { exact: true }).count(), 22)
      assert.equal(await preview.getByText(/Already a member/).count(), 1)
      assert.equal(await preview.getByText(/Refused/).count(), 2)
      const original = await page.locator('form[action="/enterprise/invitations/send"]').evaluate(f => Object.fromEntries(new FormData(f)))
      await screenshot('bulk-invitations-preview')
      await page.getByRole('button', { name: 'Send 22 invitations', exact: true }).click()
      await page.getByRole('heading', { name: 'Invitation results', exact: true }).waitFor()
      const result = page.getByRole('region', { name: 'Invitation results', exact: true })
      assert.equal(await result.getByText('Accepted by mail provider', { exact: true }).count(), 22)
      assert.equal((await bulkInvitationMails(h)).length, before.length + 22)
      const current = await h.state()
      assert.equal(current.members.filter(m => m.email.startsWith('bulk-')).length, 22)
      await screenshot('bulk-invitations-results')
      // Reposting the same reviewed form reaches the same persisted result without provider calls.
      const replay = await context.request.post(h.origin + '/enterprise/invitations/send', { form: original, headers: { origin: h.origin } })
      assert.equal(replay.status(), 200)
      assert.equal((await bulkInvitationMails(h)).length, before.length + 22)
      await page.getByRole('link', { name: 'Review another list', exact: true }).click()
      await page.getByLabel('Invitation list', { exact: true }).fill(h.source)
      await page.getByRole('button', { name: 'Preview invitations', exact: true }).click()
      await page.getByRole('heading', { name: 'Review invitations', exact: true }).waitFor()
      assert.equal(await page.getByRole('region', { name: 'Invitation preview', exact: true }).getByText(/Already a member/).count(), 23)
      assert.equal(await page.getByRole('button', { name: /^Send/ }).count(), 0)
      assert.equal((await bulkInvitationMails(h)).length, before.length + 22)
      await screenshot('bulk-invitations-repeat')
      outcomes.push({ width, rows: 25, flagged: 3, accepted: 22, duplicateInvitations: 0 })
    } finally { await context.close(); await h.close() }
  }
  return outcomes
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import(process.env.LODGE_PLAYWRIGHT_MODULE || '@playwright/test')
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  try { console.log(JSON.stringify({ bulkInvitations: 'passed', outcomes: await bulkInvitationsPage(browser, process.env.LODGE_EVIDENCE || '.cache/bulk-invitations-proof') })) }
  finally { await browser.close() }
}
