import { referencePage } from './reference-browser.mjs'
import { payWorkspace } from './pay-transparency-browser.mjs'
import { weeklyReportPage } from './weekly-report-browser.mjs'
import { enterprisePage } from './enterprise-browser.mjs'
import { bulkInvitationsPage } from './bulk-invitations-browser.mjs'
import { analysisSchedulePage } from './analysis-schedule-browser.mjs'
import { analysisPage } from './analysis-browser.mjs'
import { crmPage } from './crm-browser.mjs'
import { reminderPage } from './reminders-browser.mjs'
import { applicationEmailWorkspace } from './application-email-workspace.mjs'
import { applicationEmailPage } from './application-email-browser.mjs'
import { capturePage } from './capture-browser.mjs'
import { browserWidths } from './browser-widths.mjs'
import { careersPage as employerCareersPage } from './careers-driver.mjs'
import { careersDraftPage } from './careers-draft-page.mjs'
import { connectorsPage } from './connectors-driver.mjs'
import { referralsPage } from './referrals-driver.mjs'
import { languagesPage } from './languages-driver.mjs'
import { legacyPage } from './legacy-driver.mjs'
import { candidatePage, candidateAccountPage, candidateBookingPage } from './candidate-driver.mjs'
// LDG-015 and LDG-017, plus the human journeys at 1440 and 390: a fresh clone of
// the committed HEAD run only through the pinned `rer` verbs, the whole hiring
// loop clicked by each role, every workspace screen at both widths, the Workable
// kit through its page, preview, deploy preflight, and a whole-installation
// archive restored into a second clone.
import { queuedEntrypoint } from '@runeditrun/rer/queued-entry'
const queued = await queuedEntrypoint(import.meta.url, 'test:lodge-browser'); if (queued !== null) process.exit(queued)
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { command, freePort, fresh, report, start } from './browser-runtime.mjs'
import { api, current, journey, screens, session } from './browser-journey.mjs'
import { careersPage, careersSite, embedFallback, embedPage, embedRefused } from './board-page.mjs'
import { offersPage } from './offer-driver.mjs'
import { esignPage } from './esign-driver.mjs'
import { documentsPage } from './document-page.mjs'
import { operationsPage } from './operations-driver.mjs'
import { agencyPage } from './agency-driver.mjs'
import { postsPage } from './posts-page.mjs'
import { eventsPage } from './events-page.mjs'
import { resumeIntakePage } from './resume-driver.mjs'
import { fieldsImportPage } from './fields-import-page.mjs'
import { fieldsPage } from './fields-driver.mjs'
import { blindPage } from './blind-driver.mjs'
import { bulkPage } from './bulk-page.mjs'
import { notifyPage } from './notify-driver.mjs'
import { cutoverPage } from './cutover-driver.mjs'
import { folderEntries, zip } from './zip.mjs'

const evidence = resolve(process.env.LODGE_EVIDENCE ?? '.cache/lodge-browser-proof')
await mkdir(evidence, { recursive: true })
const first = await fresh()
let second, server, browser
const result = { head: first.head, journeys: [] }
const PERSONAS = [['manager', ['manager'], 'Morgan Lee'], ['approver', ['approver'], 'Parker Jones'], ['interviewer', ['interviewer'], 'Ivy Chen']]
const sortById = rows => [...rows].sort((a, b) => a.id.localeCompare(b.id))

try {
  const root = first.root
  await command(root, ['install'])
  const port = await freePort()
  await command(root, ['setup', '--owner-email', 'owner@example.test', '--port', String(port), '--non-interactive'])
  await command(root, ['check', '--profile', 'first-party'])
  await command(root, ['describe'])
  server = await start(root, port)
  browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })

  await enterprisePage(browser, resolve(evidence, 'enterprise'))
  await bulkInvitationsPage(browser, resolve(evidence, 'bulk-invitations'))
  await analysisPage(browser, resolve(evidence, 'analysis'))
  await analysisSchedulePage(browser, resolve(evidence, 'analysis'))
  await weeklyReportPage(browser, resolve(evidence, 'weekly-reports'))
  await crmPage(browser, resolve(evidence, 'crm'))
  await reminderPage(browser, resolve(evidence, 'reminders'))
  await applicationEmailPage(browser, resolve(evidence, 'application-emails'))
  await capturePage(browser, resolve(evidence, 'capture'))

  // The owner starts from the empty-state onboarding page.
  const owner = await session(browser, root, server.origin, 'owner', 1440)
  await owner.page.getByRole('heading', { name: 'Welcome to Lodge' }).waitFor()
  await owner.page.getByLabel('Business name').fill('Example Builders')
  await owner.page.getByLabel('Accommodation contact', { exact: false }).fill('adjustments@example.test')
  await owner.page.getByLabel('Applicant privacy notice', { exact: false }).fill('We use your application only to assess you for this role and keep it for one year.')
  await owner.page.getByRole('button', { name: 'Save business settings' }).click()
  await owner.page.getByRole('heading', { name: 'Example Builders' }).waitFor()
  await owner.page.screenshot({ path: join(evidence, 'owner-overview-1440.png'), fullPage: true })
  for (const [as, roles, name] of PERSONAS) await api(owner.context, server.origin, 'member', { email: `${as}@dev.localhost`, name, roles })

  await applicationEmailWorkspace(browser, root, server.origin, resolve(evidence, 'application-emails'))
  await referencePage(browser, { root, origin: server.origin, evidence: resolve(evidence, 'references'), ownerEmail: 'owner@example.test' })

  for (const width of browserWidths) result.journeys.push(await journey(browser, root, server.origin, width, evidence))

  // ATTR-009: the example careers page, on its own origin, lists a published job from the public board and applies through it.
  // ATTR-008: the embed snippet on that origin frames the board and form; an unlisted site cannot; without JavaScript it links to the hosted roles.
  const site = await careersSite(root), unlisted = await careersSite(root)
  try {
    const run = (op, body, context = owner.context) => api(context, server.origin, op, body)
    const ops = await run('department', { name: 'Field operations' }), yard = await run('office', { name: 'Brooklyn yard' })
    const lead = await run('vacancy', { title: 'Yard lead', departmentId: ops.id, officeId: yard.id, headcount: 1, manager: 'manager@dev.localhost', compensation: { currency: 'USD', min: 6500000, max: 7800000, period: 'year' }, description: 'Run the yard.' })
    await run('rubric', { id: lead.id, criteria: [{ name: 'Safety', description: 'Ran safety on a yard' }] })
    await run('interview-plan', { id: lead.id, plan: [{ name: 'Walk', stageName: 'Interview', durationMinutes: 45 }] })
    const asked = await run('request-vacancy-approval', { id: lead.id, approver: 'approver@dev.localhost' })
    const approver = await session(browser, root, server.origin, 'approver', 1440)
    const version = (await current(approver.context, server.origin)).approvals.find(x => x.id === asked.id).currentVersion
    await run('decide-approval', { id: asked.id, decision: 'approved', reason: 'Budgeted', version }, approver.context)
    await approver.context.close()
    await run('publish', { id: lead.id })
    await run('job-board', { token: 'example-builders', allowedOrigins: [site.origin] })
    for (const width of browserWidths) {
      const receipt = await careersPage(browser, { lodge: server.origin, site: site.origin, board: 'example-builders', job: { title: 'Yard lead', department: 'Field operations', office: 'Brooklyn yard', pay: '$65,000–$78,000 a year' }, width, evidence, email: `jules${width}@example.test` })
      const w = await current(owner.context, server.origin)
      const landed = w.applications.find(a => w.receipts.some(r => r.id === receipt && r.application === a.id))
      assert.deepEqual([landed.source, landed.campaign], ['Careers page (API)', { utm_source: 'webflow', utm_campaign: 'careers-' + width }])
      const framed = await embedPage(browser, { lodge: server.origin, site: site.origin, job: { title: 'Yard lead', departmentId: ops.id }, width, evidence, email: `wren${width}@example.test` })
      const after = await current(owner.context, server.origin)
      const embedded = after.applications.find(a => after.receipts.some(r => r.id === framed && r.application === a.id))
      assert.deepEqual([embedded.source, embedded.campaign], ['Careers page (embedded)', { utm_source: 'webflow-embed' }])
    }
    await legacyPage(browser, { lodge: server.origin, site: site.origin, run, state: () => current(owner.context, server.origin), ownerEmail: (await current(owner.context, server.origin)).actor.email, evidence })
    await embedRefused(browser, { lodge: server.origin, site: unlisted.origin })
    await embedFallback(browser, { lodge: server.origin, site: site.origin, job: { title: 'Yard lead' }, email: 'noor@example.test' })
    // ATTR-012: a job approved for two offices gets a post per width, put live in the app and opened from the careers page.
    const hand = await postsPage(browser, { root, origin: server.origin, run, offices: [yard, await run('office', { name: 'Queens yard' })], evidence })
    await languagesPage(browser, { root, origin: server.origin, run, evidence, ownerEmail: (await current(owner.context, server.origin)).actor.email })
    await candidateAccountPage(browser, { evidence })
    await candidateBookingPage(browser, { evidence })
    await candidatePage(browser, { root, origin: server.origin, run, evidence, ownerEmail: (await current(owner.context, server.origin)).actor.email })
    await employerCareersPage(browser, { root, origin: server.origin, run, evidence, ownerEmail: (await current(owner.context, server.origin)).actor.email })
    await careersDraftPage(browser, { root, origin: server.origin, run, evidence })
    await referralsPage(browser, { root, origin: server.origin, run, evidence, ownerEmail: (await current(owner.context, server.origin)).actor.email })
    await agencyPage(browser, { root, origin: server.origin, run, evidence, ownerEmail: (await current(owner.context, server.origin)).actor.email })
    // CRM-009: a campus fair on a phone: online and offline captures, the sign-out warning, QR self-registration; the pool at 1440.
    await eventsPage(browser, { root, origin: server.origin, job: { title: 'Yard lead' }, evidence })
    // DATA-003: one applicant on each of two jobs selected from their board views, a previewed bulk tag applied to both.
    await bulkPage(browser, { root, origin: server.origin, run, jobs: [lead, hand], evidence })
    await resumeIntakePage(browser, { root, origin: server.origin, job: lead, evidence })
    // TEAM-002/003: @mentions from the note box, the home list and the notification settings.
    await notifyPage(browser, { root, origin: server.origin, run, job: lead, evidence, ownerEmail: (await current(owner.context, server.origin)).actor.email })
    await documentsPage(browser, { root, origin: server.origin, run, evidence, ownerEmail: (await current(owner.context, server.origin)).actor.email })
    await offersPage(browser, { root, origin: server.origin, run, evidence, ownerEmail: (await current(owner.context, server.origin)).actor.email })
    await esignPage(browser, { root, origin: server.origin, run, evidence, ownerEmail: (await current(owner.context, server.origin)).actor.email })
    await fieldsPage(browser, { root, origin: server.origin, run, evidence, ownerEmail: (await current(owner.context, server.origin)).actor.email })
    await fieldsImportPage(browser, { root, origin: server.origin, evidence })
    await blindPage(browser, { root, origin: server.origin, run, evidence, ownerEmail: (await current(owner.context, server.origin)).actor.email })
    await connectorsPage(browser, { root, origin: server.origin, run, evidence, ownerEmail: (await current(owner.context, server.origin)).actor.email })
    await operationsPage(browser, { root, origin: server.origin, run, evidence, ownerEmail: (await current(owner.context, server.origin)).actor.email })
  } finally {
    await site.close(); await unlisted.close()
  }

  // The Workable kit through its own page: preview, then commit that exact preview.
  const pkg = join(evidence, 'workable-sample.zip')
  await writeFile(pkg, zip(await folderEntries(join(root, 'fixtures/workable-full-export'))))
  await owner.page.reload()
  await owner.page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Move in', exact: true }).click()
  await owner.page.getByLabel('Workable export ZIP').setInputFiles(pkg)
  await owner.page.getByRole('button', { name: 'Preview package' }).click()
  await owner.page.getByText('Files that match no candidate').waitFor()
  await owner.page.screenshot({ path: join(evidence, 'move-in-preview-1440.png'), fullPage: true })
  await owner.page.getByRole('button', { name: 'Commit this exact preview' }).click()
  await owner.page.getByText(/Import completed/).waitFor()
  // MIG-008: that import's open applications, moved into live jobs by a previewed and approved cutover.
  await cutoverPage(browser, { root, origin: server.origin, run: (op, body) => api(owner.context, server.origin, op, body), evidence })

  // Every main screen the owner uses, the Lobby, sign-in and the public job list, at both widths.
  for (const width of browserWidths) await screens(browser, root, server.origin, width, evidence)

  await payWorkspace(browser, root, server.origin, resolve(evidence, 'pay-transparency'))
  const before = await current(owner.context, server.origin)
  await owner.context.close(); await browser.close(); browser = undefined
  await server.close(); server = undefined

  // Setup again keeps everything; the production build serves with the same boundary.
  await command(root, ['setup', '--owner-email', 'owner@example.test', '--port', String(port), '--non-interactive'])
  await command(root, ['build'])
  server = await start(root, port, 'preview')
  assert.equal((await fetch(server.origin + '/health')).status, 200)
  assert.equal((await fetch(server.origin + '/api/lodge/state')).status, 401, 'preview keeps private routes private')
  assert.equal((await fetch(server.origin + '/jobs')).status, 200, 'preview serves the application pages')
  await server.close(); server = undefined
  // The credential-free build and preview above prove the production artifact.
  // Base #275 requires target-secret reads for dry runs, including with mail configured.
  const deployEnv = '.cache/browser-deploy.env'
  await mkdir(join(root, '.cache'), { recursive: true })
  const noCredentials = 'CLOUDFLARE_ACCOUNT_ID=\nCLOUDFLARE_API_TOKEN=\n'
  await writeFile(join(root, deployEnv), noCredentials + 'MAIL_API_KEY=\n', { mode: 0o600 })
  const missing = await command(root, ['deploy', '--dry-run', '--env-file', deployEnv], { expected: 3 })
  assert.match(missing, /production sign-in mail: MAIL_API_KEY/, 'the dry run names the sign-in method a real deploy still needs')
  for (const name of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']) assert.ok(missing.includes(name), missing)
  await writeFile(join(root, deployEnv), noCredentials + 'MAIL_API_KEY=test-only-offline-plan\n', { mode: 0o600 })
  const configured = await command(root, ['deploy', '--dry-run', '--env-file', deployEnv], { expected: 3 })
  for (const name of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']) assert.ok(configured.includes(name), configured)
  assert.doesNotMatch(configured, /production sign-in mail: MAIL_API_KEY/, 'the configured mail input satisfies the sign-in prerequisite')
  await assert.rejects(readFile(join(root, '.rer/deploy/production.json')), { code: 'ENOENT' })

  // Whole-installation archive: refused into a non-empty checkout, restored into a fresh one.
  await rm(join(root, 'exports'), { recursive: true, force: true })
  await command(root, ['export', '--output', 'exports/lodge.rer'])
  await command(root, ['import', '--input', 'exports/lodge.rer', '--yes'], { expected: 4 })
  second = await fresh()
  // Base's restore order: import into the empty checkout, then setup establishes the owner.
  await command(second.root, ['install'])
  const secondPort = await freePort()
  await mkdir(join(second.root, 'exports'), { recursive: true })
  const bytes = await readFile(join(root, 'exports/lodge.rer'))
  await writeFile(join(second.root, 'exports/damaged.rer'), Buffer.concat([bytes.subarray(0, Math.floor(bytes.length / 2)), Buffer.from('\ndamaged\n')]), { mode: 0o600 })
  await command(second.root, ['import', '--input', 'exports/damaged.rer', '--yes'], { expected: 2 })
  await copyFile(join(root, 'exports/lodge.rer'), join(second.root, 'exports/lodge.rer'))
  await command(second.root, ['import', '--input', 'exports/lodge.rer', '--yes'])
  await command(second.root, ['setup', '--owner-email', 'owner@example.test', '--port', String(secondPort), '--non-interactive'])
  server = await start(second.root, secondPort)
  browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  const restored = await session(browser, second.root, server.origin, 'owner', 1440)
  const after = await current(restored.context, server.origin)
  for (const key of ['vacancies', 'applications', 'candidates', 'documents', 'scorecards', 'offers', 'approvals'])
    assert.deepEqual(sortById(after[key]), sortById(before[key]), `${key} survive the archive restore`)
  // Import batches and their journal survive, still bound to the same restored owner who ran them.
  assert.deepEqual(sortById(after.importJobs), sortById(before.importJobs), 'import batches survive the archive restore')
  assert.ok(after.importJobs.length > 0 && after.importJobs.every(job => job.mine))
  const doc = after.documents.find(d => d.name === 'resume.txt')
  const download = await restored.context.request.get(`${server.origin}/api/lodge/download/document/${doc.id}`)
  assert.match(await download.text(), /Site supervisor 2018-2026/, 'document bytes survive the restore')
  await restored.context.close()
  result.restore = { records: Object.fromEntries(['vacancies', 'applications', 'candidates', 'documents', 'importJobs'].map(k => [k, after[k].length])) }
  await server.close(); server = undefined
  await command(second.root, ['reset', '--yes'])
  result.passed = true
  await report(evidence, result)
  console.log(`Browser and CLI proof passed on ${first.head}; screenshots in ${evidence}`)
} finally {
  await browser?.close()
  await server?.close()
  for (const clone of [first, second]) if (clone) await rm(clone.root, { recursive: true, force: true })
}
