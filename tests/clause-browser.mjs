import { browserWidths } from './browser-widths.mjs'
// Narrow committed journeys for builder landings; the full fresh-install journey remains in browser.mjs.
import { pathToFileURL } from 'node:url'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fresh, command, freePort, start } from './browser-runtime.mjs'
import { api, current, journey, session } from './browser-journey.mjs'
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
  browser = await chromium.launch({ headless: true, executablePath: process.env.LODGE_CHROMIUM_EXECUTABLE, args: ['--use-mock-keychain', '--password-store=basic'] })
  const owner = await session(browser, clone.root, server.origin, 'owner', 1440)
  try {
    const run = (op, body, context = owner.context) => api(context, server.origin, op, body)
    await run('business', BUSINESS)
    for (const [as, roles, name] of [['manager', ['manager'], 'Morgan Lee'], ['approver', ['approver'], 'Parker Jones'], ['interviewer', ['interviewer'], 'Ivy Chen']]) await run('member', { email: as + '@dev.localhost', roles, name })
    const options = { root: clone.root, origin: server.origin, run, evidence, ownerEmail: (await current(owner.context, server.origin)).actor.email }
    for (const clause of process.argv.slice(2)) {
      if (clause === 'TEAM-002') {
        const job = await run('vacancy', { title: 'Site supervisor', location: 'Brooklyn, NY', headcount: 1, manager: 'manager@dev.localhost', compensation: { currency: 'USD', min: 9000000, max: 11000000, period: 'year' } })
        await run('rubric', { id: job.id, criteria: [{ name: 'Safety', description: 'Explains safe site operations' }] })
        await run('interview-plan', { id: job.id, plan: [{ name: 'Work review', stageName: 'Interview' }] })
        const asked = await run('request-vacancy-approval', { id: job.id, approver: options.ownerEmail })
        await run('decide-approval', { id: asked.id, decision: 'approved', reason: 'Budget reviewed', version: asked.version })
        await run('publish', { id: job.id })
        await (await import('./notify-driver.mjs')).notifyPage(browser, { ...options, job })
        console.log(clause + ': own screens and end states passed at 1440 and 390')
        continue
      }
      if (clause === 'LDG-003') {
        for (const width of browserWidths) await journey(browser, clone.root, server.origin, width, evidence)
        console.log(clause + ': hiring journey passed at 1440 and 390')
        continue
      }
      const [file, fn] = ({ 'REPORT-005': ['analysis-workspace', 'analysisWorkspace'], 'CRM-004': ['crm-browser', 'crmWorkspace'], 'AUTO-002': ['reminders-browser', 'reminderWorkspace'], 'REPORT-004': ['surveys-driver', 'surveysWorkspacePage'], 'ATTR-001': ['careers-driver', 'careersPage'], 'ATTR-007': ['languages-driver', 'languagesPage'], 'ATTR-014': ['careers-draft-page', 'careersDraftPage'], 'CRM-003': ['referrals-driver', 'referralsPage'], 'INT-002': ['connectors-driver', 'connectorsPage'], 'CRM-001': ['talent-page', 'talentPage'], 'CAND-001': ['candidate-driver', 'candidatePage'], 'CAND-002': ['candidate-driver', 'candidateAccountPage'], 'CAND-003': ['candidate-driver', 'candidateBookingPage'] })[clause] ?? []
      if (!file) throw new Error('Name a supported clause')
      await (await import('./' + file + '.mjs'))[fn](browser, options)
      console.log(clause + ': own screens and end states passed at 1440 and 390')
    }
  } finally { await owner.context.close() }
} finally {
  await browser?.close(); await server?.close()
  await rm(clone.root, { recursive: true, force: true })
}
