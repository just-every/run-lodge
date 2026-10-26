import assert from 'node:assert/strict'
import { iconTooltips } from './icon-tooltips.mjs'
import { pathToFileURL } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { start, freePort } from './browser-runtime.mjs'
import { session, api } from './browser-journey.mjs'
import { BUSINESS } from './harness.mjs'
import { browserWidths } from './browser-widths.mjs'

export async function applicationEmailWorkspace(browser, root, origin, evidence) {
 for (const width of browserWidths) {
  const owner = await session(browser, root, origin, 'owner', width)
  try {
   await api(owner.context, origin, 'business', BUSINESS)
   await owner.page.reload()
   await owner.page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'People', exact: true }).click()
   const link = owner.page.getByRole('link', { name: 'Configure acknowledgment and status emails', exact: true })
   await link.waitFor()
   assert.ok(await owner.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
   await iconTooltips(owner.page, evidence + '/application-email-tooltip-' + width + '.png')
   await owner.page.screenshot({ path: evidence + '/application-email-workspace-' + width + '.png', fullPage: true })
   await link.click()
   await owner.page.getByRole('heading', { name: 'Application email settings', exact: true }).waitFor()
  } finally { await owner.context.close() }
 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const { chromium } = await import(process.env.LODGE_PLAYWRIGHT_MODULE || '@playwright/test')
 const evidence = process.env.LODGE_EVIDENCE || '.cache/application-email-proof'
 await mkdir(evidence, { recursive: true })
 const port = await freePort(), server = await start(process.cwd(), port)
 let browser
 try {
  browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  await applicationEmailWorkspace(browser, process.cwd(), server.origin, evidence)
  console.log('Application email workspace entry passed at each viewport')
 } finally { await browser?.close(); await server.close() }
}
