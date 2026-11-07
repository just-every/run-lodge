import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { readDevKey, signInAs } from '../src/modules/operator-auth/dev/sign-in-as.mjs'
import { autonomousPolicy } from '../src/modules/agent-door/conformance/crypto.mjs'
import { attributionFixture, attributionDrafts } from './agent-attribution-flow.mjs'
import { iconTooltips } from './icon-tooltips.mjs'

// The built workspace talks to the disposable real Worker with its signed-in
// native human session. Only transport is forwarded; no projection is faked.
export async function agentAttributionPage(browser, { root, origin, evidence }) {
  if (process.env.LODGE_BROWSER_WIDTH === '390') return
  await mkdir(evidence, { recursive: true })
  const f = await attributionFixture(), { h, c } = f
  const login = await signInAs({ origin, key: await readDevKey(root), as: 'owner', returnTo: '/app' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  let page
  try {
    await context.addCookies(login.cookies.map(cookie => ({ ...cookie, url: origin })))
    await c.adopt(autonomousPolicy())
    const p = await attributionDrafts(f, 'browser')
    const label = p.proposal.preparation.label
    page = await context.newPage()
    page.setDefaultTimeout(30000)
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/api/lodge/**', async route => {
      const request = route.request(), incoming = new URL(request.url())
      const forwarded = new Headers(request.headers())
      forwarded.set('Origin', h.origin); forwarded.set('Cookie', h.owner); forwarded.delete('host')
      const response = await h.mf.dispatchFetch(h.origin + incoming.pathname + incoming.search, {
        method: request.method(), headers: Object.fromEntries(forwarded),
        body: request.postDataBuffer() ?? undefined,
      })
      const headers = Object.fromEntries(response.headers)
      for (const name of ['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie']) delete headers[name]
      await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) })
    })
    const capture = async name => {
      await iconTooltips(page)
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.screenshot({ path: evidence + '/' + name + '-' + width + '.png', fullPage: true })
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    const go = async path => {
      await page.goto(origin + path)
      if (new URL(page.url()).pathname === '/setup') {
        await page.getByRole('checkbox').check()
        await page.getByRole('button', { name: 'Finish setup' }).click()
      }
      await page.getByRole('navigation', { name: 'Workspace' }).waitFor()
    }
    const proposals = async () => {
      await go('/app')
      await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^Proposals/ }).click()
      await page.getByRole('heading', { name: 'Agent proposals', exact: true }).waitFor()
    }
    await proposals()
    const packet = page.getByRole('article').filter({ has: page.getByRole('heading', { name: p.proposal.summary, exact: true }) })
    await packet.getByText('Prepared by ' + label, { exact: false }).waitFor()
    await capture('proposal-preparation')
    await packet.getByRole('combobox', { name: /^Decision/ }).selectOption('approved')
    await packet.getByLabel('Reason', { exact: true }).fill('Signed-in human reviewed the exact prepared changes')
    await packet.getByRole('button', { name: 'Record decision', exact: true }).click()
    await page.getByRole('heading', { name: 'Decided', exact: true }).waitFor()
    const decided = page.getByRole('listitem').filter({ hasText: p.proposal.summary })
    assert.ok((await decided.innerText()).includes(label))
    assert.ok((await decided.innerText()).includes('by ' + f.human.displayName))
    assert.equal((await f.persisted('proposal', p.proposal.id)).decidedBy, f.email)
    await capture('proposal-human-decision')
    await go('/app?application=' + p.application)
    await page.getByRole('tab', { name: 'Scorecards', exact: true }).click()
    const brief = page.getByRole('region', { name: 'Debrief brief', exact: true })
    await brief.getByRole('heading', { name: 'Prepared by ' + label, exact: false }).waitFor()
    await capture('debrief-preparation')
    await brief.getByRole('button', { name: 'Keep this brief', exact: true }).click()
    await brief.getByText('Kept by ' + f.human.displayName, { exact: false }).waitFor()
    assert.equal((await f.persisted('debrief', p.debrief.id)).keptBy, f.email)
    await capture('debrief-human-decision')
    await page.getByRole('tab', { name: 'Notes', exact: true }).click()
    await page.getByText(label + ' prepared a proposal for human review', { exact: false }).waitFor()
    await page.getByText(label + ' prepared a debrief for human review', { exact: false }).waitFor()
    const recent = page.locator('.recent')
    assert.ok((await recent.innerText()).includes(label + ' proposed:'))
    assert.ok((await recent.innerText()).includes(label + ' · Debrief prepared'))
    await capture('candidate-activity')
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Audit', exact: true }).click()
    const auditRows = page.getByRole('row').filter({ hasText: label })
    assert.ok(await auditRows.count() >= 2)
    await capture('native-audit')
    const bound = (await h.state()).members.find(row => row.businessAgentId === c.agentId)
    await h.command('member', { ...bound, active: false, name: 'Renamed inactive agent' })
    await proposals()
    assert.ok((await page.getByRole('listitem').filter({ hasText: p.proposal.summary }).innerText()).includes(label))
    await capture('retained-attribution')
    assert.deepEqual(errors, [])
    console.log('PROBE BASE-AGENT-008 browser: real MCP drafts and native human decisions -> preparation, activity and audit labels; screens captured at 1440 and 390')
  } catch (error) {
    if (page) {
      await page.screenshot({ path: evidence + '/failure.png', fullPage: true }).catch(() => {})
      console.log('BROWSER_BODY ' + (await page.locator('body').innerText()).slice(0, 1200))
      console.log('BROWSER_ERRORS ' + JSON.stringify(errors))
    }
    throw error
  } finally { await context.close(); await h.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import('@playwright/test')
  const { start } = await import('./browser-runtime.mjs')
  const root = process.cwd(), server = await start(root, 8787)
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] })
  try {
    await agentAttributionPage(browser, { root, origin: server.origin, evidence: process.env.LODGE_EVIDENCE })
  } finally { await browser.close(); await server.close() }
}
