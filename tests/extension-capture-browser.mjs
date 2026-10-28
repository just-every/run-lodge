import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readDevKey, signInAs } from '../src/modules/operator-auth/dev/sign-in-as.mjs'
import { api, current } from './browser-journey.mjs'
import { freePort, start } from './browser-runtime.mjs'
import { iconTooltips } from './icon-tooltips.mjs'

const address = n => ['synthetic-lodge-' + n, 'example.test'].join('@')
const delay = ms => new Promise(r => setTimeout(r, ms))
async function executable() {
  for (const path of [process.env.LODGE_EXTENSION_CHROMIUM, '/usr/bin/chromium', chromium.executablePath()].filter(Boolean)) {
    try { await access(path); return path } catch {}
  }
  throw new Error('An installed Chromium with extension action debugging is required')
}

/** The real installed action, selected text, transient handoff and native review, at one assertion width. */
export async function extensionCapturePage(_browser, { root, origin, evidence }) {
  if (process.env.LODGE_BROWSER_WIDTH === '390') return
  await mkdir(evidence, { recursive: true })
  const profile = await mkdtemp(join(tmpdir(), 'lodge-extension-profile-')), port = await freePort()
  const generic = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html lang="en"><title>Ordinary public biography</title><h1>Synthetic Lodge Prospect</h1><p id="visible">Synthetic Lodge Selected</p><p hidden>Never captured hidden biography</p></html>') })
  await new Promise(r => generic.listen(0, '127.0.0.1', r))
  const sourceURL = 'http://127.0.0.1:' + generic.address().port + '/biography?tracking=synthetic-lodge-1#ignored'
  const child = spawn(await executable(), ['--headless=new', '--no-sandbox', '--use-mock-keychain', '--password-store=basic', '--enable-unsafe-extension-debugging', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
  let browser
  // Toolbar popups are Chromium other targets; keep the real popup attached.
  const previousAttach = process.env.PW_CHROMIUM_ATTACH_TO_OTHER
  process.env.PW_CHROMIUM_ATTACH_TO_OTHER = '1'
  try {
    let endpoint
    for (let i = 0; i < 100; i++) {
      try { endpoint = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json(); break } catch { if (child.exitCode !== null) throw new Error('Extension Chromium exited'); await delay(100) }
    }
    assert.ok(endpoint, 'extension Chromium became ready')
    browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl)
    const context = browser.contexts()[0], cdp = await browser.newBrowserCDPSession()
    const installed = await cdp.send('Extensions.loadUnpacked', { path: resolve(root, 'extensions/chromium') })
    const extension = (await cdp.send('Extensions.getExtensions')).extensions.find(e => e.id === installed.id)
    assert.equal(extension.enabled, true, 'the unpacked extension is installed and enabled')
    const login = await signInAs({ origin, key: await readDevKey(root), as: 'owner', returnTo: '/app' })
    await context.addCookies(login.cookies.map(c => ({ ...c, url: origin })))
    const native = await context.newPage(); await native.goto(origin + '/app')
    if (native.url().endsWith('/setup')) { await native.getByRole('checkbox').check(); await native.getByRole('button', { name: 'Finish setup' }).click() }
    let w = await current(context, origin)
    if (!w.business) { await api(context, origin, 'business', (await import('./harness.mjs')).BUSINESS); w = await current(context, origin) }
    const run = (op, body) => api(context, origin, op, body)
    const job = await run('vacancy', { title: 'Synthetic extension target', manager: w.actor.email, headcount: 1, location: 'Denver, CO', compensation: { currency: 'USD', min: 7000000, max: 9000000, period: 'year' } })
    await run('rubric', { id: job.id, criteria: [{ name: 'Safety', description: 'Practical work evidence' }] })
    await run('interview-plan', { id: job.id, plan: [{ name: 'Site walk', stageName: 'Interview' }] })
    const approval = await run('request-vacancy-approval', { id: job.id, approver: w.actor.email })
    await run('decide-approval', { id: approval.id, decision: 'approved', version: approval.version, reason: 'Approved target' })
    await run('publish', { id: job.id })
    const known = await run('candidate', { name: 'Synthetic Lodge Selected', email: address(40), source: 'Prior native entry', consentBasis: 'manual', talentPool: true })
    const requests = [], confirmations = []
    context.on('request', request => { requests.push(request.url()); if (new URL(request.url()).pathname === '/api/lodge/prospect-capture/confirm') confirmations.push(request.postDataJSON()) })
    const source = await context.newPage(); await source.goto(sourceURL)
    const action = async (name = 'Synthetic Lodge Selected', email = address(40)) => {
      await source.bringToFront()
      await source.locator('#visible').evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range) })
      // The action API expects the enclosing tab, rather than its page target.
      const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] })
      const tab = targetInfos.find(t => t.url === source.url())
      assert.ok(tab, 'the source page has an installed browser tab')
      const [popup] = await Promise.all([
        context.waitForEvent('page', { timeout: 15000 }),
        cdp.send('Extensions.triggerAction', { id: installed.id, targetId: tab.targetId }),
      ])
      await popup.waitForURL('chrome-extension://' + installed.id + '/popup.html')
      await popup.waitForFunction(() => document.querySelector('[name=sourceURL]')?.value)
      await popup.getByRole('button', { name: 'Use selected text as name', exact: true }).click()
      assert.equal(await popup.getByLabel('Name', { exact: true }).inputValue(), 'Synthetic Lodge Selected')
      assert.equal(await popup.getByLabel('Email', { exact: true }).inputValue(), '', 'no page contact fields were scraped')
      await popup.getByLabel('Name', { exact: true }).fill(name)
      await popup.getByLabel('Lodge installation URL', { exact: true }).fill(origin)
      await popup.getByLabel('Email', { exact: true }).fill(email)
      return popup
    }
    const handoff = async (name, email) => {
      const popup = await action(name, email), next = context.waitForEvent('page')
      await popup.getByRole('button', { name: 'Review in Lodge', exact: true }).click()
      const page = await next
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.getByRole('heading', { name: 'Review prospect', exact: true }).waitFor()
      assert.equal(new URL(page.url()).hash, '', 'native review cleared the transient fragment')
      assert.equal(new URL(page.url()).search, '?capture=1', 'no personal query fields')
      await page.getByLabel('Add to').selectOption(job.id)
      await page.getByLabel('Basis for keeping their details').selectOption('manual')
      await page.getByLabel('Consent basis evidence', { exact: true }).fill('Synthetic reviewed employer contact basis')
      await page.getByRole('button', { name: 'Check duplicates', exact: true }).click()
      await page.getByRole('heading', { name: 'Duplicate review', exact: true }).waitFor()
      return page
    }
    const before = (await current(context, origin)).candidates.length
    const canceledPopup = await action()
    await canceledPopup.getByRole('button', { name: 'Cancel capture', exact: true }).click()
    assert.equal((await current(context, origin)).candidates.length, before, 'canceling the installed popup never writes')
    const canceled = await handoff()
    await canceled.getByRole('button', { name: 'Cancel capture', exact: true }).click()
    assert.equal((await current(context, origin)).candidates.length, before, 'cancel never adds a person')
    await canceled.close()
    const page = await handoff()
    const duplicate = page.getByLabel('Synthetic Lodge Selected · Same email, Same name')
    await duplicate.selectOption('distinct')
    await page.getByLabel('I reviewed the details, consent basis and every visible duplicate', { exact: true }).check()
    const proof = async name => {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.screenshot({ path: join(evidence, name + '-' + width + '.png'), fullPage: true })
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'native review fits')
    await iconTooltips(page)
    await proof('extension-duplicate-review')
    await page.getByRole('button', { name: 'Confirm prospect', exact: true }).click()
    await page.getByRole('heading', { name: 'Prospect saved', exact: true }).waitFor()
    w = await current(context, origin)
    const added = w.candidates.find(c => c.email === address(40) && c.id !== known.candidate.id)
    assert.ok(added)
    const app = w.applications.find(a => a.candidate === added.id)
    assert.equal(app.sourceURL, sourceURL.split('?')[0])
    assert.deepEqual([app.source, app.credit.kind, app.credit.who], ['Sourced: extension', 'sourcer', w.actor.email])
    assert.equal(JSON.stringify(added).includes('Never captured hidden biography'), false)
    await page.goto(origin + '/app?application=' + app.id)
    await page.getByRole('region', { name: 'Source and credit', exact: true }).waitFor()
    await page.getByText('Source page: ' + sourceURL.split('?')[0], { exact: true }).waitFor()
    await proof('extension-source-credit')
    await iconTooltips(page)
    // A second installed capture links an authorized existing person without overwriting them.
    const second = await handoff()
    await second.locator('select[name="duplicate-' + known.candidate.id + '"]').selectOption('existing')
    await second.locator('select[name="duplicate-' + added.id + '"]').selectOption('distinct')
    const applicationsBefore = (await current(context, origin)).applications.length
    await second.getByLabel('I reviewed the details, consent basis and every visible duplicate', { exact: true }).check()
    await second.getByRole('button', { name: 'Confirm prospect', exact: true }).click()
    await second.getByRole('heading', { name: 'Prospect saved', exact: true }).waitFor()
    const linked = await current(context, origin)
    assert.equal(linked.applications.length, applicationsBefore + 1)
    assert.equal(linked.candidates.length, w.candidates.length)
    assert.equal(linked.candidates.find(c => c.id === known.candidate.id).source, 'Prior native entry')
    await second.close()
    const replay = await context.request.post(origin + '/api/lodge/prospect-capture/confirm', { headers: { origin }, data: confirmations[0] })
    assert.equal(replay.status(), 409, 'the actual installed capture confirmation cannot be replayed')
    assert.equal((await current(context, origin)).candidates.length, linked.candidates.length)
    for (const value of requests) {
      const query = new URL(value).search
      assert.equal(query.includes(encodeURIComponent(address(40))) || query.includes(encodeURIComponent('Synthetic Lodge Selected')), false, 'personal fields never enter request queries')
    }
    // Inspect the installed popup's real stores after completed handoffs.
    // Without the storage permission, Chromium exposes no extension storage API.
    const persistence = await action()
    const storage = await persistence.evaluate(async () => ({
      extensionAPI: typeof chrome.storage,
      local: { ...localStorage }, session: { ...sessionStorage },
      databases: await indexedDB.databases(),
    }))
    assert.equal(storage.extensionAPI, 'undefined', 'the installed extension has no persistent extension storage access')
    assert.deepEqual(storage.local, {}, 'the installed extension persisted no capture fields')
    assert.deepEqual(storage.session, {}, 'the popup retained no capture fields in session storage')
    assert.deepEqual(storage.databases, [], 'the installed extension created no persistent capture database')
    await persistence.getByRole('button', { name: 'Cancel capture', exact: true }).click()
    // Native session and membership revocation are exercised after real installed handoffs.
    const ownerControl = await browser.newContext()
    let reviewerBefore
    try {
      const ownerLogin = await signInAs({ origin, key: await readDevKey(root), as: 'owner', returnTo: '/app' })
      await ownerControl.addCookies(ownerLogin.cookies.map(c => ({ ...c, url: origin })))
      const reviewerEmail = ['manager', 'dev.localhost'].join('@')
      reviewerBefore = (await current(ownerControl, origin)).members.find(m => m.email === reviewerEmail)
      await api(ownerControl, origin, 'member', { email: reviewerEmail, name: 'Synthetic extension reviewer', roles: ['manager'] })
      await api(ownerControl, origin, 'hiring-team', { id: job.id, recruiters: [reviewerEmail] })
      const loginReviewer = async () => {
        const reviewer = await signInAs({ origin, key: await readDevKey(root), as: 'manager', returnTo: '/app' })
        await context.clearCookies()
        await context.addCookies(reviewer.cookies.map(c => ({ ...c, url: origin })))
      }
      const hidden = await api(ownerControl, origin, 'candidate', { name: 'Synthetic confidential capture', email: address(42), source: 'Native private entry', consentBasis: 'manual' })
      await api(ownerControl, origin, 'candidate-privacy', { id: hidden.candidate.id, private: true, namedPeople: [] })
      await loginReviewer()
      const sessionReview = await handoff('Synthetic revoked session prospect', address(42))
      assert.equal((await sessionReview.locator('body').textContent()).includes('Synthetic confidential capture'), false, 'an installed handoff never discloses a confidential match')
      assert.equal(await sessionReview.locator('select[name^="duplicate-"]').count(), 0)
      await sessionReview.getByLabel('I reviewed the details, consent basis and every visible duplicate', { exact: true }).check()
      assert.equal((await context.request.post(origin + '/auth/signout', { headers: { origin }, data: {} })).status(), 204)
      await sessionReview.getByRole('button', { name: 'Confirm prospect', exact: true }).click()
      await sessionReview.getByRole('alert').waitFor()
      assert.equal((await current(ownerControl, origin)).candidates.some(c => c.name === 'Synthetic revoked session prospect'), false)
      await sessionReview.close()
      await loginReviewer()
      const memberReview = await handoff('Synthetic deprovisioned prospect', address(43))
      await memberReview.getByLabel('I reviewed the details, consent basis and every visible duplicate', { exact: true }).check()
      await api(ownerControl, origin, 'member', { email: reviewerEmail, name: 'Synthetic removed reviewer', roles: ['manager'], active: false })
      await memberReview.getByRole('button', { name: 'Confirm prospect', exact: true }).click()
      await memberReview.getByRole('alert').waitFor()
      assert.equal((await current(ownerControl, origin)).candidates.some(c => c.email === address(43)), false)
      await memberReview.close()
    } finally {
      await api(ownerControl, origin, 'member', { email: ['manager', 'dev.localhost'].join('@'), name: reviewerBefore?.name ?? 'Morgan Lee', roles: reviewerBefore?.roles ?? ['manager'], active: true })
      await ownerControl.close()
    }
    console.log('CRM-007 installed action, explicit selection, cancel, duplicate choices, source and credit, replay and revoked-session and member refusals passed at 1440; review and application proof captured at 1440 and 390')
  } finally {
    if (previousAttach === undefined) delete process.env.PW_CHROMIUM_ATTACH_TO_OTHER
    else process.env.PW_CHROMIUM_ATTACH_TO_OTHER = previousAttach
    if (browser) await browser.close()
    if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(r => child.once('close', r)) }
    await new Promise(r => generic.close(r)); await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.cwd(), server = await start(root, 8787)
  try { await extensionCapturePage(null, { root, origin: server.origin, evidence: process.env.LODGE_EVIDENCE ?? '.cache/extension-proof' }) }
  finally { await server.close() }
}
