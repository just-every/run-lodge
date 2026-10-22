// Narrow committed journeys for builder landings; the full fresh-install journey remains in browser.mjs.
import { pathToFileURL } from 'node:url'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fresh, command, freePort, start } from './browser-runtime.mjs'
import { api, current, session } from './browser-journey.mjs'
import { BUSINESS } from './harness.mjs'

const { chromium } = await import(process.env.LODGE_PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.LODGE_PLAYWRIGHT_MODULE)).href : '@playwright/test')
const evidence = resolve(process.env.LODGE_EVIDENCE ?? '.cache/clause-browser')
await mkdir(evidence, { recursive: true })
const clone = await fresh()
let server, browser
try {
  await command(clone.root, ['install'])
  const port = await freePort()
  await command(clone.root, ['setup', '--owner-email', 'owner@example.test', '--port', String(port), '--non-interactive'])
  server = await start(clone.root, port)
  browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  const owner = await session(browser, clone.root, server.origin, 'owner', 1440)
  try {
    const run = (op, body, context = owner.context) => api(context, server.origin, op, body)
    await run('business', BUSINESS)
    for (const [as, roles, name] of [['manager', ['manager'], 'Morgan Lee'], ['approver', ['approver'], 'Parker Jones'], ['interviewer', ['interviewer'], 'Ivy Chen']]) await run('member', { email: as + '@dev.localhost', roles, name })
    const options = { root: clone.root, origin: server.origin, run, evidence, ownerEmail: (await current(owner.context, server.origin)).actor.email }
    for (const clause of process.argv.slice(2)) {
      const [file, fn] = ({ 'ATTR-001': ['careers-page', 'careersPage'], 'ATTR-007': ['languages-page', 'languagesPage'], 'CRM-003': ['referrals-page', 'referralsPage'], 'INT-002': ['connectors-page', 'connectorsPage'] })[clause] ?? []
      if (!file) throw new Error('Name a supported clause')
      await (await import('./' + file + '.mjs'))[fn](browser, options)
      console.log(clause + ': own screens and end states passed at 1440 and 390')
    }
  } finally { await owner.context.close() }
} finally {
  await browser?.close(); await server?.close()
  await rm(clone.root, { recursive: true, force: true })
}
