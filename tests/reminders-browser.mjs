import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { browserWidths } from './browser-widths.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { reminderFixture, clock } from './reminders-flow.mjs'
import { session } from './browser-journey.mjs'

export async function reminderPage(browser, evidence) {
 await mkdir(evidence, { recursive: true })
 for (const width of browserWidths) {
  const h = await reminderFixture(), context = await browser.newContext({ viewport: { width, height: 1000 } })
  await context.addCookies(h.owner.split('; ').map(value => { const i = value.indexOf('='); return { name: value.slice(0, i), value: value.slice(i + 1), url: h.origin } }))
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  const shot = async name => {
   assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' fits ' + width)
   await iconTooltips(page)
   await page.screenshot({ path: evidence + '/' + name + '-' + width + '.png', fullPage: true })
  }
  try {
   await page.goto(h.origin + '/reminders/settings')
   await page.getByText('Configure a reminder', { exact: true }).click()
   await page.getByLabel('Reminder purpose', { exact: true }).selectOption('availability')
   await page.getByLabel('Recipient', { exact: true }).selectOption('candidate')
   await page.getByLabel('Responsible owner', { exact: true }).selectOption('owner@example.test')
   await page.getByLabel('Escalation hiring manager', { exact: true }).selectOption('owner@example.test')
   await page.getByLabel('First due time', { exact: false }).fill('2026-10-26T10:00')
   await page.getByLabel('Hours between attempts', { exact: true }).fill('1')
   await page.getByLabel('Maximum attempts', { exact: true }).fill('2')
   await page.getByText('Business hours and weekdays', { exact: true }).click()
   await page.getByLabel('Start hour, 0–23', { exact: true }).fill('9')
   await page.getByLabel('End hour, 1–24', { exact: true }).fill('17')
   await page.getByLabel('Monday', { exact: true }).check()
   await page.getByLabel('Exact subject', { exact: true }).fill('Jordan, please choose your interview times')
   await page.getByLabel('Exact message body', { exact: true }).fill('Hi Jordan, please choose your availability: ' + h.origin + '/availability/' + h.interview.candidateToken)
   await page.getByLabel('Exact employer footer in this language', { exact: true }).fill(h.input.footer)
   await shot('reminder-reviewed-configuration')
   await page.getByLabel('I, Olive Owner, reviewed', { exact: false }).check()
   await page.getByLabel('Enable this reminder', { exact: true }).check()
   await page.getByRole('button', { name: 'Enable reviewed reminder', exact: true }).click()
   await page.getByRole('status').waitFor()
   const r = (await h.rows())[0]
   assert.equal(r.attempts, 0)
   await page.getByText(h.interview.title + ' · Missing availability · Queued', { exact: true }).click()
   await shot('reminder-queued')
   await h.tick(clock); await h.delivered(r.id, clock)
   await h.restart(); await h.tick('2026-10-26T15:00:00.000Z'); await h.delivered(r.id, '2026-10-26T15:00:00.000Z')
   await h.tick('2026-10-26T16:00:00.000Z'); await h.delivered(r.id, '2026-10-26T16:00:00.000Z')
   await page.reload()
   await page.locator('details.disclosure').filter({ has: page.locator('summary', { hasText: 'Missing availability · Completed' }) }).locator('summary').first().click()
   await page.getByRole('heading', { name: 'Delivered · escalation', exact: true }).waitFor()
   await shot('reminder-delivered-escalation')
   const candidatePage = await context.newPage()
   await candidatePage.goto(h.origin + '/availability/' + h.interview.candidateToken)
   await candidatePage.locator('input[name="slot"]').first().check()
   await candidatePage.getByRole('button', { name: 'Send my availability', exact: true }).click()
   await candidatePage.close()
   await h.tick('2026-10-26T17:00:00.000Z')
   await page.reload()
   await page.getByText(h.interview.title + ' · Missing availability · Response received', { exact: true }).click()
   await shot('reminder-acknowledged')
   assert.equal((await h.outcomes(r.id)).length, 3)
   assert.deepEqual(errors, [])
  } finally { await context.close(); await h.close() }
 }
}

export async function reminderWorkspace(browser, { root, origin, evidence }) {
 for (const width of browserWidths) {
  const owner = await session(browser, root, origin, 'owner', width)
  try {
   await owner.page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'People', exact: true }).click()
   const link = owner.page.getByRole('link', { name: 'Configure hiring reminders', exact: true })
   await link.waitFor(); await iconTooltips(owner.page, evidence + '/reminder-workspace-tooltips-' + width + '.png')
   await owner.page.screenshot({ path: evidence + '/reminder-workspace-' + width + '.png', fullPage: true })
   await link.click(); await owner.page.getByRole('heading', { name: 'Persistent hiring reminders', exact: true }).waitFor()
  } finally { await owner.context.close() }
 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const { chromium } = await import(process.env.LODGE_PLAYWRIGHT_MODULE || '@playwright/test')
 const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
 try { await reminderPage(browser, process.env.LODGE_EVIDENCE || '.cache/reminder-proof') }
 finally { await browser.close() }
 console.log('AUTO-002 configuration, queued work, delivered escalation and response stops passed at both widths')
}
