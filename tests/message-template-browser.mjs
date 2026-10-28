import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { api, current, session } from './browser-journey.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { messageTemplateJob } from './message-template-flow.mjs'

/** Native settings to filled bulk review to a frozen, exactly approved unsent draft. */
export async function messageTemplatePage(browser, { root, origin, evidence, ownerEmail }) {
  if (process.env.LODGE_BROWSER_WIDTH === '390') return
  await mkdir(evidence, { recursive: true })
  const user = await session(browser, root, origin, 'owner', 1440)
  const { page, context } = user, errors = []
  page.on('pageerror', e => errors.push(e.message))
  const run = (op, body) => api(context, origin, op, body)
  const capture = async name => {
    await iconTooltips(page)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.screenshot({ path: evidence + '/' + name + '-' + width + '.png', fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  try {
    const { job, spanish } = await messageTemplateJob(run, ownerEmail)
    const address = n => ['synthetic-lodge-browser-' + n, 'example.test'].join('@')
    const en = await run('candidate', { name: 'Synthetic Lodge English', email: address(1), phone: '+1 555 0101', source: 'Direct', consentBasis: 'manual', vacancy: job.id })
    await run('candidate', { name: 'Synthetic Lodge missing phone', email: address(3), source: 'Direct', consentBasis: 'manual', vacancy: job.id })
    const applied = await context.request.post(origin + '/jobs/' + spanish, { headers: { origin }, form: { name: 'Synthetic Lodge Spanish', email: address(2), phone: '+1 555 0102', noticeVersion: '1', consent: 'yes' } })
    assert.equal(applied.status(), 200, await applied.text())
    await page.goto(origin + '/app?settings=message-templates')
    const settings = page.getByRole('region', { name: 'Message template settings', exact: true })
    await settings.getByLabel('Template job', { exact: true }).selectOption(job.id)
    await settings.getByLabel('Template name', { exact: true }).fill('Synthetic Lodge reviewed follow-up')
    await settings.getByLabel('Template subject', { exact: true }).fill('Next step for {job_title}')
    await settings.getByLabel('Template message', { exact: true }).fill('Hello {candidate_name}, phone {candidate_phone}. — {business_name}')
    await settings.getByLabel('I reviewed this exact text in the stated application language', { exact: true }).check()
    await settings.getByRole('button', { name: 'Save reviewed template', exact: true }).click()
    await settings.getByText('Reviewed language versions', { exact: true }).waitFor()
    await settings.getByLabel('Application language', { exact: true }).fill('es')
    await settings.getByLabel('Template subject', { exact: true }).fill('Próximo paso para {job_title}')
    await settings.getByLabel('Template message', { exact: true }).fill('Hola {candidate_name}, teléfono {candidate_phone}. — {business_name}')
    await settings.getByLabel('I reviewed this exact text in the stated application language', { exact: true }).check()
    await settings.getByRole('button', { name: 'Save reviewed template', exact: true }).click()
    await settings.getByText('Reviewed language versions', { exact: true }).click()
    await settings.getByRole('heading', { name: 'es · version 2', exact: true }).waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'template settings fit')
    await capture('template-settings')
    const template = (await current(context, origin)).messageTemplates.find(t => t.vacancy === job.id)
    await page.goto(origin + '/app?job=' + job.id)
    await page.getByRole('heading', { name: job.title, exact: true, level: 1 }).waitFor()
    const bulk = page.locator('details.bulk')
    await bulk.locator('summary').click()
    for (const name of ['Synthetic Lodge English', 'Synthetic Lodge Spanish', 'Synthetic Lodge missing phone']) await bulk.getByLabel('Select ' + name, { exact: true }).check()
    await bulk.getByLabel('Bulk action', { exact: true }).selectOption('message')
    await bulk.getByLabel('Reusable message template', { exact: true }).selectOption(template.id)
    await bulk.getByLabel('Approver (a hiring manager’s email, optional)', { exact: true }).fill(ownerEmail)
    await bulk.getByRole('button', { name: 'Preview', exact: true }).click()
    const preview = page.getByRole('region', { name: 'Bulk preview', exact: true })
    await preview.getByText('2 ready · 1 refused', { exact: true }).waitFor()
    assert.match(await preview.innerText(), /Hello Synthetic Lodge English, phone \+1 555 0101/)
    assert.match(await preview.innerText(), /Hola Synthetic Lodge Spanish, teléfono \+1 555 0102/)
    assert.match(await preview.innerText(), /Missing merge value: candidate_phone/)
    assert.match(await preview.innerText(), /es · version 2/)
    assert.equal((await current(context, origin)).messages.some(m => m.application === en.application.id), false)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'filled recipient preview fits')
    await capture('template-recipient-preview')
    await preview.getByRole('button', { name: 'Apply to 2', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '2 applied · 0 refused · drafts saved, not sent' }).waitFor()
    const m = (await current(context, origin)).messages.find(m => m.application === en.application.id)
    assert.equal(m.templateDraft.version, 1)
    await run('decide-approval', { id: m.approval.id, version: m.version, decision: 'approved', reason: 'Reviewed exact text' })
    await page.goto(origin + '/app?application=' + en.application.id)
    await page.getByRole('tab', { name: 'Decisions', exact: true }).click()
    await page.getByRole('link', { name: 'Download approved message (.eml)', exact: true }).waitFor()
    await page.getByText('Template Synthetic Lodge reviewed follow-up', { exact: false }).waitFor()
    const eml = await context.request.get(origin + '/api/lodge/download/message/' + m.id)
    assert.equal(eml.status(), 200); assert.match(await eml.text(), /X-Unsent: 1/)
    await capture('template-frozen-draft')
    assert.deepEqual(errors, [])
  } catch (e) {
    await page.screenshot({ path: evidence + '/template-error.png', fullPage: true })
    throw e
  } finally { await context.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import('@playwright/test')
  const { start } = await import('./browser-runtime.mjs')
  const root = process.cwd(), server = await start(root, 8787)
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
  try {
    const owner = await session(browser, root, server.origin, 'owner', 1440)
    let ownerEmail
    try {
      const w = await current(owner.context, server.origin)
      ownerEmail = w.actor.email
      if (!w.business) { const { BUSINESS } = await import('./harness.mjs'); await api(owner.context, server.origin, 'business', BUSINESS) }
    } finally { await owner.context.close() }
    await messageTemplatePage(browser, { root, origin: server.origin, evidence: process.env.LODGE_EVIDENCE, ownerEmail })
    console.log('COM-002 template workspace journey passed at 1440; changed screens captured at 1440 and 390')
  } finally { await browser.close(); await server.close() }
}
