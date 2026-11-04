import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { api, current, session } from './browser-journey.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { handoffAddress } from './handoff-exception-flow.mjs'
import { mappingFields, previewFixture } from './handoff-preview-flow.mjs'

/** One desktop sanity journey; the changed states are captured at both release widths. */
export async function handoffPreviewPage(browser, { root, origin, evidence, ownerEmail }) {
  if (process.env.LODGE_BROWSER_WIDTH === '390') return
  await mkdir(evidence, { recursive: true })
  const { page, context } = await session(browser, root, origin, 'owner', 1440)
  page.setDefaultTimeout(30000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  const run = (op, body) => api(context, origin, op, body)
  let approver
  const capture = async name => {
    await iconTooltips(page)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.screenshot({ path: evidence + '/' + name + '-' + width + '.png', fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  try {
    const suffix = '-' + crypto.randomUUID().slice(0, 8), email = handoffAddress('preview-browser-approver' + suffix)
    await run('member', { email, name: 'Synthetic Lodge independent approver', roles: ['approver'] })
    assert.equal((await context.request.post(origin + '/api/lodge/invite', { headers: { origin }, data: { email } })).status(), 200)
    approver = await session(browser, root, origin, email, 1440)
    const f = await previewFixture(run, ownerEmail, suffix, email, (op, body) => api(approver.context, origin, op, body))
    await page.goto(origin + '/app?settings=handoff')
    const settings = page.getByRole('region', { name: 'Employee mapping settings', exact: true })
    await settings.getByLabel('Mapping job', { exact: true }).selectOption(f.job.id)
    await settings.getByLabel('Declared destination', { exact: true }).selectOption('bamboohr')
    await settings.getByLabel('Declared tenant identifier', { exact: true }).fill('synthetic-lodge-browser-tenant')
    await settings.getByLabel('Job manager destination field', { exact: true }).fill('')
    await settings.getByRole('button', { name: 'Save employee mapping', exact: true }).click()
    await page.getByText('Saved.', { exact: true }).waitFor()
    assert.equal((await current(context, origin)).handoffPreviews.mappings.find(m => m.vacancy === f.job.id).destination, 'bamboohr')
    await capture('employee-mapping-settings')
    await page.goto(origin + '/app?application=' + f.people[0].application.id)
    await page.getByRole('tab', { name: 'Decisions', exact: true }).click()
    const panel = page.getByRole('region', { name: 'Employee creation mapping preview', exact: true })
    await panel.getByRole('button', { name: 'Prepare employee mapping preview', exact: true }).click()
    const frozen = panel.getByRole('article').last()
    await frozen.getByText('Frozen sources and original digests', { exact: true }).click()
    const body = await frozen.innerText()
    assert.ok(body.includes('7000000') && body.includes('year') && body.includes('Operations West'))
    assert.ok(body.includes('Missing fields: Job manager') && body.includes('Human attestation only; not provider-verified.'))
    assert.ok(body.includes('Provider contingencies unknown') && (await panel.innerText()).includes('Employee creation is not authorized or verified'))
    const record = (await current(context, origin)).handoffPreviews.records.find(r => r.offer === f.offers[0].id)
    assert.ok(body.includes(record.snapshot.documents[0].sha256))
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mapping preview fits desktop')
    await capture('employee-mapping-review')
    await frozen.getByLabel('Mapping review reason', { exact: true }).fill('Human checked exact signed original and mapping; no destination action authorized')
    await frozen.getByLabel('This review grants no permission to create an employee or complete a destination', { exact: true }).check()
    await frozen.getByRole('button', { name: 'Record human mapping review', exact: true }).click()
    await frozen.getByRole('heading', { name: 'BambooHR · Human reviewed; creation not authorized', exact: true }).waitFor()
    await capture('employee-mapping-reviewed')
    await run('field-values', { application: f.people[0].application.id, values: { [f.customField]: 'Changed cost centre' } })
    await page.reload(); await page.getByRole('tab', { name: 'Decisions', exact: true }).click()
    await panel.getByRole('heading', { name: 'BambooHR · Sources changed; prepare again', exact: true }).waitFor()
    assert.equal(await panel.getByRole('button', { name: 'Record human mapping review', exact: true }).count(), 0)
    await capture('employee-mapping-stale')
    const legacy = await context.request.get(origin + '/api/lodge/download/handoff/' + f.offers[0].id)
    assert.equal(legacy.status(), 200); assert.equal((await legacy.json()).complete, false)
    await page.goto(origin + '/app?application=' + f.people[1].application.id)
    await page.getByRole('tab', { name: 'Decisions', exact: true }).click()
    await panel.getByText('A recorded acceptance alone is unsigned and cannot unlock a mapping preview.', { exact: true }).waitFor()
    assert.equal(await panel.getByRole('button', { name: 'Prepare employee mapping preview', exact: true }).count(), 0)
    await capture('employee-mapping-unsigned')
    assert.deepEqual(errors, [])
  } catch (error) {
    await page.screenshot({ path: evidence + '/employee-mapping-failure.png', fullPage: true, timeout: 10000 }).catch(() => {})
    throw error
  } finally { await approver?.context.close(); await context.close() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import('@playwright/test'), { start, freePort } = await import('./browser-runtime.mjs')
  const root = process.cwd(), server = await start(root, await freePort())
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
  try {
    const owner = await session(browser, root, server.origin, 'owner', 1440)
    let ownerEmail
    try {
      const w = await current(owner.context, server.origin); ownerEmail = w.actor.email
      if (!w.business) await api(owner.context, server.origin, 'business', (await import('./harness.mjs')).BUSINESS)
    } finally { await owner.context.close() }
    await handoffPreviewPage(browser, { root, origin: server.origin, evidence: process.env.LODGE_EVIDENCE, ownerEmail })
    console.log('Employee mapping browser sanity journey passed at 1440; screens captured at 1440 and 390')
  } finally { await browser.close(); await server.close() }
}
