import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { command, freePort, fresh, start } from './browser-runtime.mjs'
import { api, session } from './browser-journey.mjs'
import { browserWidths } from './browser-widths.mjs'
import { iconTooltips } from './icon-tooltips.mjs'

/** The changed Settings entry points in the actual built app, using native local sign-in. */
export async function enterpriseAppPage(browser, evidence) {
  const clone = await fresh(); let server
  await mkdir(evidence, { recursive: true })
  try {
    await command(clone.root, ['install'])
    const port = await freePort()
    await command(clone.root, ['setup', '--owner-email', 'owner@example.test', '--port', String(port), '--non-interactive'])
    server = await start(clone.root, port)
    for (const width of browserWidths) {
      const owner = await session(browser, clone.root, server.origin, 'owner', width), page = owner.page
      try {
        if (await page.getByRole('heading', { name: 'Welcome to Lodge', exact: true }).count()) {
          await page.getByLabel('Business name').fill('Fieldwork Builders')
          await page.getByLabel('Accommodation contact', { exact: false }).fill('adjustments@example.test')
          await page.getByLabel('Applicant privacy notice', { exact: false }).fill('We assess applications for this role and keep the hiring record for one year.')
          await page.getByRole('button', { name: 'Save business settings', exact: true }).click()
          await page.getByRole('heading', { name: 'Fieldwork Builders', exact: true }).waitFor()
        }
        await api(owner.context, server.origin, 'member', { email: 'casey@example.test', name: 'Casey Compliance', roles: ['compliance'] })
        await api(owner.context, server.origin, 'member', { email: 'morgan@example.test', name: 'Morgan Recruiter', roles: ['manager'] })
        await page.reload()
        const people = page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'People', exact: true })
        await people.waitFor({ state: 'visible' })
        await people.click()
        await page.getByRole('heading', { name: 'People and settings', exact: true }).waitFor()
        await page.getByLabel('Compliance reviewer', { exact: true }).check()
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        await iconTooltips(page, evidence + '/settings-tooltip-' + width + '.png')
        await page.screenshot({ path: evidence + '/people-settings-' + width + '.png', fullPage: true })
        await page.getByRole('link', { name: 'Invite people in bulk', exact: true }).click()
        await page.getByRole('heading', { name: 'Invite people in bulk', exact: true }).waitFor()
        await page.screenshot({ path: evidence + '/bulk-entry-' + width + '.png', fullPage: true })
      } finally { await owner.context.close() }
    }
  } finally { await server?.close(); await rm(clone.root, { recursive: true, force: true }) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const browser = await chromium.launch({ headless: true, ...(process.env.LODGE_CHROMIUM ? { executablePath: process.env.LODGE_CHROMIUM } : {}), args: ['--use-mock-keychain', '--password-store=basic'] })
  try { await enterpriseAppPage(browser, process.env.LODGE_EVIDENCE ?? '.cache/enterprise-app') } finally { await browser.close() }
  console.log('enterprise built app screens passed')
}
