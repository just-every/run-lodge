import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { browserWidths } from './browser-widths.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { crmFixture } from './crm-flow.mjs'
import { session } from './browser-journey.mjs'

const cookies = (cookie, origin) => cookie.split('; ').map(value => { const i = value.indexOf('='); return { name: value.slice(0, i), value: value.slice(i + 1), url: origin } })
export async function crmPage(browser, evidence) {
 await mkdir(evidence, { recursive: true })
 for (const width of browserWidths) {
  const h = await crmFixture(), context = await browser.newContext({ viewport: { width, height: 1000 } })
  await context.addCookies(cookies(h.owner, h.origin))
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  const shot = async (name, p = page) => {
   assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' fits ' + width)
   await iconTooltips(p)
   await p.screenshot({ path: evidence + '/' + name + '-' + width + '.png', fullPage: true })
  }
  let candidateContext
  try {
   await page.goto(h.origin + '/crm')
   await page.getByText('Verify native reply routing', { exact: true }).click()
   await page.getByRole('button', { name: 'Send route verification email', exact: true }).click()
   const check = (await h.mails()).findLast(m => m.subject === 'Lodge CRM reply route verification')
   assert.equal((await h.nativeEmail('installation-sender@example.test', check.text)).status, 200)
   await page.goto(h.origin + '/crm?q=Bluebeam')
   await page.getByText('Create a talent pool', { exact: true }).click()
   await page.getByLabel('Pool name', { exact: true }).fill('Future warehouse team')
   await page.getByLabel('Selection reason', { exact: true }).fill('The candidate recorded Bluebeam experience relevant to the future opening.')
   await page.getByLabel('Riley Park', { exact: true }).check()
   await page.getByText('Matching evidence for Riley Park', { exact: true }).click()
   await shot('crm-factual-matches')
   await page.getByRole('button', { name: 'Create selected pool', exact: true }).click()
   await page.getByRole('status').waitFor()
   await page.getByLabel('Candidate', { exact: true }).selectOption(h.riley.candidate.id)
   await page.getByRole('button', { name: 'Review selected candidate', exact: true }).click()
   await page.getByText('Factual selection evidence', { exact: true }).click()
   await page.getByText('Prepare a nurture sequence for Riley Park', { exact: true }).click()
   await page.getByLabel('Source application', { exact: true }).selectOption(h.riley.application.id)
   const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Prepare exact sequence preview', exact: true }) })
   await form.getByLabel('Target vacancy', { exact: true }).selectOption(h.target.id)
   await page.getByLabel('First due time', { exact: false }).fill('2026-10-26T10:01')
   await page.getByLabel('Hours between steps', { exact: true }).fill('1')
   await page.getByLabel('Source application language code', { exact: true }).fill('en')
   for (const i of [1, 2]) {
    if (i === 2) await page.getByText('Message 2 · optional', { exact: true }).click()
    await page.getByLabel('Message ' + i + ' subject', { exact: true }).fill(h.input.steps[i - 1].subject)
    await page.getByLabel('Message ' + i + ' body', { exact: true }).fill(h.input.steps[i - 1].body)
    await page.getByLabel('Message ' + i + ' footer in this language', { exact: true }).fill(h.input.steps[i - 1].footer)
   }
   await page.getByRole('button', { name: 'Prepare exact sequence preview', exact: true }).click()
   await page.getByRole('heading', { name: 'Exact sequence preview', exact: true }).waitFor()
   const draft = (await h.view()).enrollments.find(e => e.status === 'draft')
   assert.equal(draft.outcomes.length, 0)
   await shot('crm-exact-sequence-preview')
   await page.getByLabel('I, Olive Owner, reviewed', { exact: false }).check()
   await page.getByLabel('Enable this reviewed sequence', { exact: true }).check()
   await page.getByRole('button', { name: 'Enable reviewed sequence', exact: true }).click()
   await h.tick('2026-10-26T14:01:00.000Z')
   const candidateCookie = await h.nativeCandidate(h.riley.candidate.email)
   candidateContext = await browser.newContext({ viewport: { width, height: 1000 } })
   await candidateContext.addCookies(cookies(candidateCookie, h.origin))
   const candidate = await candidateContext.newPage()
   await candidate.goto(h.origin + '/crm/reply/' + draft.id)
   await candidate.getByLabel('Your reply', { exact: true }).fill('Yes, I would like to discuss the future warehouse role.')
   await shot('crm-candidate-reply', candidate)
   const replyResponse = candidate.waitForResponse(response => response.request().method() === 'POST' && response.url() === h.origin + '/crm/reply/' + draft.id)
   await candidate.getByRole('button', { name: 'Send reply and stop sequence', exact: true }).click()
   assert.equal((await replyResponse).status(), 303, await candidate.locator('main').innerText())
   await candidate.getByRole('heading', { name: 'Your reply', exact: true }).waitFor()
   await shot('crm-candidate-reply-recorded', candidate)
   await page.goto(h.origin + '/crm?enrollment=' + draft.id)
   await page.getByText('Prior interactions and replies', { exact: true }).click()
   await page.getByText('Recorded sending outcomes', { exact: true }).click()
   await shot('crm-stopped-thread')
   await page.goto(h.origin + '/crm?pool=' + draft.pool + '&candidate=' + h.riley.candidate.id)
   await page.getByText('Create an application for Riley Park', { exact: true }).click()
   const applyForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Create approved application', exact: true }) })
   await applyForm.getByLabel('Target vacancy', { exact: true }).selectOption(h.target.id)
   await page.getByLabel('Application reason', { exact: true }).fill('Riley replied with interest and the recruiter selected the evidenced match.')
   await page.getByLabel('I explicitly approve creating', { exact: false }).check()
   await shot('crm-human-application-selection')
   await page.getByRole('button', { name: 'Create approved application', exact: true }).click()
   assert.equal((await h.state()).applications.filter(a => a.candidate === h.riley.candidate.id && a.vacancy === h.target.id).length, 1)
   await candidate.goto(h.origin + '/crm/opt-out/' + draft.optOutToken)
   await candidate.getByLabel('Stop future-opening emails', { exact: true }).check()
   await shot('crm-opt-out', candidate)
   await candidate.getByRole('button', { name: 'Stop future-opening emails', exact: true }).click()
   await candidate.getByRole('heading', { name: 'Email preference recorded', exact: true }).waitFor()
   await shot('crm-opt-out-recorded', candidate)
   await h.tick('2026-10-26T16:00:00.000Z')
   assert.equal((await h.view()).enrollments.find(e => e.id === draft.id).outcomes.length, 1)
   assert.deepEqual(errors, [])
  } finally { await candidateContext?.close(); await context.close(); await h.close() }
 }
}
export async function crmWorkspace(browser, { root, origin, evidence }) {
 for (const width of browserWidths) {
  const owner = await session(browser, root, origin, 'owner', width)
  try {
   await owner.page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'People', exact: true }).click()
   const link = owner.page.getByRole('link', { name: 'Talent pools and nurture campaigns', exact: true })
   await link.waitFor(); await iconTooltips(owner.page, evidence + '/crm-workspace-tooltips-' + width + '.png')
   await owner.page.screenshot({ path: evidence + '/crm-workspace-' + width + '.png', fullPage: true })
   await link.click(); await owner.page.getByRole('heading', { name: 'Talent pools and follow-up', exact: true }).waitFor()
  } finally { await owner.context.close() }
 }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const { chromium } = await import(process.env.LODGE_PLAYWRIGHT_MODULE || '@playwright/test')
 const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
 try { await crmPage(browser, process.env.LODGE_EVIDENCE || '.cache/crm-proof') }
 finally { await browser.close() }
 console.log('CRM-004 pool, preview, activation, candidate reply, opt-out and human application screens passed at both widths')
}
