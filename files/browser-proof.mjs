import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
const root = process.cwd()
const require = createRequire(join(root, 'package.json'))
const { chromium } = require('@playwright/test')
const { checkAgentRefusals } = await import(join(root, 'tests/agent-refusal-flow.mjs'))
const { readDevKey, signInAs } = await import(join(root, 'src/modules/operator-auth/dev/sign-in-as.mjs'))
const output = process.env.LODGE_EVIDENCE
assert.ok(output)
const origin = 'http://127.0.0.1:8787'
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
const screens = []
try {
  const result = await checkAgentRefusals({ observe: async ({ h, fixtures, receipts, attempts }) => {
    const key = await readDevKey(root)
    const login = await signInAs({ origin, key, as: 'owner', returnTo: '/app' })
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } })
      try {
        await context.addCookies(login.cookies.map(cookie => ({ ...cookie, url: origin })))
        await context.route('**/*', async route => {
          const incoming = route.request(), url = new URL(incoming.url())
          if (url.origin !== origin) return route.abort()
          if (!url.pathname.startsWith('/api/lodge/') && !url.pathname.startsWith('/agents')) return route.continue()
          const response = await h.mf.dispatchFetch(h.origin + url.pathname + url.search, {
            method: incoming.method(), headers: { ...incoming.headers(), Origin: h.origin, Cookie: h.owner },
            body: incoming.postDataBuffer() ?? undefined,
          })
          const headers = Object.fromEntries(response.headers)
          for (const name of ['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie']) delete headers[name]
          await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) })
        })
        const page = await context.newPage()
        page.setDefaultTimeout(30000)
        await page.goto(origin + '/agents')
        await page.getByRole('heading', { name: 'Agents', exact: true }).waitFor()
        if (width === 1440) {
          assert.ok(await page.getByText(/Refused/).count() > 0, 'native shared activity displays real refusals')
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        }
        const agents = `agents-refusals-${width}.png`
        await page.screenshot({ path: join(output, agents), fullPage: true })
        screens.push({ screen: 'Shared agent refusal and review end states', width, file: agents })
        await page.goto(origin + '/app')
        if (new URL(page.url()).pathname === '/setup') {
          await page.getByRole('checkbox').check()
          await page.getByRole('button', { name: 'Finish setup' }).click()
        }
        await page.getByRole('navigation', { name: 'Workspace' }).waitFor()
        await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^Proposals/ }).click()
        await page.getByRole('heading', { name: 'Agent proposals', exact: true }).waitFor()
        await page.getByRole('heading', { name: 'Synthetic unsent vacancy proposal' }).first().waitFor()
        if (width === 1440) {
          assert.ok(await page.getByRole('button', { name: 'Record decision', exact: true }).count() > 0)
          assert.equal(await page.getByText('Approve and apply', { exact: true }).count() > 0, true)
        }
        const proposals = `unsent-proposals-${width}.png`
        await page.screenshot({ path: join(output, proposals), fullPage: true })
        screens.push({ screen: 'Native proposed drafts retain separate human decisions', width, file: proposals })
        await page.goto(origin + '/app?application=' + fixtures.values.debrief.application)
        await page.getByRole('navigation', { name: 'Workspace' }).waitFor()
        await page.getByRole('tab', { name: 'Scorecards', exact: true }).click()
        await page.getByRole('heading', { name: 'Debrief brief', exact: true }).waitFor()
        if (width === 1440) {
          assert.ok(await page.getByRole('button', { name: 'Keep this brief', exact: true }).count() > 0)
          assert.ok(await page.getByText('Takeoffs has not been assessed.', { exact: false }).count() > 0)
        }
        const briefs = `unsent-debriefs-${width}.png`
        await page.screenshot({ path: join(output, briefs), fullPage: true })
        screens.push({ screen: 'Native draft debriefs retain separate human keep decisions', width, file: briefs })
      } finally { await context.close() }
    }
    assert.deepEqual(attempts, [])
    await writeFile(join(output, 'refusal-receipt.json'), JSON.stringify({ head, refusals: receipts, providerAttempts: attempts.length }, null, 2) + '\n')
  } })
  await writeFile(join(output, 'browser-receipt.json'), JSON.stringify({ head, screens, assertionsAt: 1440,
    worker: 'real disposable Worker and D1, signed Business fixture', renderer: 'unchanged native local app and shared agent pages',
    refusals: result.refusals.length, providerAttempts: result.providerAttempts }, null, 2) + '\n')
  console.log(JSON.stringify({ head, screens: screens.length, refusals: result.refusals.length, providerAttempts: result.providerAttempts }))
} finally { await browser.close() }
