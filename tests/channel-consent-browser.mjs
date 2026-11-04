import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { businessHarness } from './harness.mjs'
import { seedChannelConsent } from './channel-consent-flow.mjs'
import { iconTooltips } from './icon-tooltips.mjs'

/** Real candidate and employer pages. Behavior is asserted at 1440; proof includes both widths. */
export async function channelConsentPage(browser, { evidence }) {
  await mkdir(evidence, { recursive: true })
  const h = await businessHarness()
  let candidate, employer
  try {
    const f = await seedChannelConsent(h, 318)
    const context = async cookie => {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
      await ctx.addCookies(cookie.split('; ').map(part => ({ name: part.split('=')[0], value: part.slice(part.indexOf('=') + 1), url: h.origin })))
      return ctx
    }
    candidate = await context(f.cookie); employer = await context(h.owner)
    const page = await candidate.newPage(), staff = await employer.newPage(), errors = []
    for (const p of [page, staff]) p.on('pageerror', e => errors.push(e.message))
    const shot = async (p, state) => {
      await iconTooltips(p)
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'channel screen fits the assertion width')
      assert.deepEqual(await p.locator('main').evaluate(el => [...el.querySelectorAll('p,label,button,a,legend')].filter(n => n.checkVisibility()).filter(n => parseFloat(getComputedStyle(n).fontSize) < 13).map(n => n.tagName)), [], 'visible everyday text is at least 13px')
      for (const width of [1440, 390]) {
        await p.setViewportSize({ width, height: 1000 })
        await p.screenshot({ path: evidence + '/channel-consent-' + state + '-' + width + '.png', fullPage: true })
      }
      await p.setViewportSize({ width: 1440, height: 1000 })
    }
    await page.goto(h.origin + '/candidate/receipts/' + f.receipt.id + '/account')
    await page.getByRole('link', { name: 'SMS and WhatsApp preferences', exact: true }).click()
    await page.getByRole('heading', { name: 'SMS and WhatsApp preferences', exact: true }).waitFor()
    assert.equal(await page.locator('input[type=radio]').count(), 0, 'no unreviewed choices are offered')
    await shot(page, 'unreviewed')
    const staffPath = '/candidate/employer/' + f.app.id + '/channels'
    await staff.goto(h.origin + staffPath)
    for (const channel of ['SMS', 'WhatsApp']) {
      const panel = staff.getByRole('region', { name: channel + ' review', exact: true })
      await panel.getByLabel('Named purpose', { exact: true }).fill('Interview coordination')
      await panel.getByLabel('Channel notice', { exact: true }).fill('Optional interview updates on this channel. Refuse or withdraw at any time.')
      await panel.getByLabel('Employer reviewed this purpose, notice and exact language.', { exact: true }).check()
      await panel.getByRole('button', { name: 'Review ' + channel + ' notice', exact: true }).click()
      await staff.getByRole('heading', { name: 'Channel consent settings', exact: true }).waitFor()
    }
    await page.reload()
    await page.getByLabel('Number with country code', { exact: true }).fill('+15550102030')
    await page.getByRole('button', { name: 'Save channel number', exact: true }).click()
    await page.getByRole('button', { name: 'Save SMS choice', exact: true }).waitFor()
    assert.equal(await page.locator('input[type=radio]:checked').count(), 0, 'both choices remain unselected')
    await shot(page, 'unselected')
    const choose = async (channel, consent) => {
      const panel = page.getByRole('region', { name: channel + ' permission', exact: true })
      await panel.getByLabel('Time zone', { exact: true }).fill('America/New_York')
      await panel.getByLabel('Daily contact window starts', { exact: true }).fill('09:00')
      await panel.getByLabel('Daily contact window ends', { exact: true }).fill('17:00')
      await panel.getByLabel(consent ? 'I give permission for this channel and purpose.' : 'I refuse permission for this channel.', { exact: true }).check()
      await panel.getByRole('button', { name: 'Save ' + channel + ' choice', exact: true }).click()
    }
    await choose('SMS', true)
    await page.getByRole('region', { name: 'SMS permission', exact: true }).getByRole('status').filter({ hasText: 'Current local permission' }).waitFor()
    await choose('WhatsApp', false)
    await page.getByRole('region', { name: 'WhatsApp permission', exact: true }).getByRole('status').filter({ hasText: 'refused' }).waitFor()
    await shot(page, 'separate-choices')
    await page.getByRole('button', { name: 'Withdraw SMS permission', exact: true }).click()
    await page.getByRole('region', { name: 'SMS permission', exact: true }).getByRole('status').filter({ hasText: 'withdrawn' }).waitFor()
    await page.getByRole('region', { name: 'SMS permission', exact: true }).getByText('Choice history', { exact: true }).click()
    const history = await page.getByRole('region', { name: 'SMS permission', exact: true }).locator('details').innerText()
    assert.match(history, /consent/); assert.match(history, /withdraw/)
    await shot(page, 'withdrawn')
    await staff.reload()
    await staff.getByRole('region', { name: 'SMS review', exact: true }).getByText(/permission withdrawn/).waitFor()
    assert.match(await staff.getByRole('region', { name: 'WhatsApp review', exact: true }).innerText(), /permission refused/)
    await shot(staff, 'staff-history')
    assert.deepEqual(errors, [])
  } finally { await candidate?.close(); await employer?.close(); await h.close() }
}
