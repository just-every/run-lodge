import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { chromium } from '@playwright/test'
import { session, current, api } from './browser-journey.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { start } from './browser-runtime.mjs'
const address = n => ['synthetic-lodge-' + n, 'example.test'].join('@')

/** Native UI proof uses a synthetic fragment; installed-extension proof has its own required journey. */
export async function prospectCapturePage(browser, { root, origin, evidence }) {
  if (process.env.LODGE_BROWSER_WIDTH === '390') return
  await mkdir(evidence, { recursive: true })
  const { page, context } = await session(browser, root, origin, 'owner', 1440)
  try {
    let w = await current(context, origin)
    if (!w.business) { await api(context, origin, 'business', (await import('./harness.mjs')).BUSINESS); w = await current(context, origin) }
    const initial = { captureId: randomUUID(), name: 'Synthetic native review prospect ' + randomUUID().slice(0, 8), email: address(randomUUID()), sourceURL: 'https://ordinary.example.test/biography', headline: '<b>Untrusted headline stays text</b>' }
    const url = () => origin + '/app?capture=1#lodge-capture=' + encodeURIComponent(JSON.stringify(initial))
    const screenshot = async name => {
      for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await page.screenshot({ path: join(evidence, name + '-' + width + '.png'), fullPage: true }) }
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    const begin = async () => {
      await page.goto('about:blank'); await page.goto(url()); await page.getByRole('heading', { name: 'Review prospect', exact: true }).waitFor()
      assert.equal(new URL(page.url()).hash, '')
      assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), initial.name)
      await page.getByLabel('Basis for keeping their details').selectOption('talent-pool')
      await page.getByLabel('Consent basis evidence', { exact: true }).fill('Explicit recorded agreement to future role contact')
      await page.getByLabel('They agreed to contact about other roles', { exact: true }).check()
      return page.getByRole('button', { name: 'Check duplicates', exact: true })
    }
    let check = await begin()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'review form fits at assertion width')
    await iconTooltips(page); await screenshot('prospect-review-fields')
    await check.click(); await page.getByRole('heading', { name: 'Duplicate review', exact: true }).waitFor()
    assert.ok(await page.getByText('No matches within your current contact authority.', { exact: true }).isVisible())
    assert.equal(await page.locator('article b').count(), 0, 'untrusted content remains inert')
    await page.getByRole('button', { name: 'Cancel capture', exact: true }).click()
    assert.equal((await current(context, origin)).candidates.some(c => c.email === initial.email), false)
    check = await begin(); await check.click(); await page.getByRole('heading', { name: 'Duplicate review', exact: true }).waitFor()
    await page.getByLabel('I reviewed the details, consent basis and every visible duplicate', { exact: true }).check()
    await screenshot('prospect-review-confirmation')
    await page.getByRole('button', { name: 'Confirm prospect', exact: true }).click()
    await page.getByRole('heading', { name: 'Prospect saved', exact: true }).waitFor()
    const person = (await current(context, origin)).candidates.find(c => c.email === initial.email)
    assert.ok(person)
    assert.equal(person.prospectCaptures[0].sourceURL, initial.sourceURL)
    await screenshot('prospect-review-saved')
    check = await begin(); await check.click()
    await page.getByRole('alert').getByText(/already confirmed/).waitFor()
    assert.equal((await current(context, origin)).candidates.filter(c => c.email === initial.email).length, 1)
  } finally { await context.close() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.cwd(), server = await start(root, 8787)
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
  try { await prospectCapturePage(browser, { root, origin: server.origin, evidence: process.env.LODGE_EVIDENCE ?? '.cache/prospect-proof' }); console.log('Native prospect review passed at 1440; changed screens captured at 1440 and 390') }
  finally { await browser.close(); await server.close() }
}
