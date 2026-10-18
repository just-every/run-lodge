// One vacancy from creation to an accepted offer, clicked through the real UI
// by each role in its own browser session, at one viewport width.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readDevKey, signInAs } from '../src/modules/operator-auth/dev/sign-in-as.mjs'

export async function session(browser, root, origin, as, width) {
  const key = await readDevKey(root)
  const login = await signInAs({ origin, key, as, returnTo: '/app' })
  const context = await browser.newContext({ viewport: { width, height: 1000 } })
  await context.addCookies(login.cookies.map(c => ({ ...c, url: origin })))
  const page = await context.newPage()
  await page.goto(origin + '/app')
  if (page.url().endsWith('/setup')) { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup' }).click() }
  await page.getByRole('navigation', { name: 'Workspace' }).waitFor()
  return { context, page }
}

export async function api(context, origin, op, body) {
  const r = await context.request.post(origin + '/api/lodge/command/' + op, { headers: { origin }, data: body })
  const value = await r.json()
  assert.equal(r.status(), 200, JSON.stringify(value))
  return value
}

export async function current(context, origin) {
  const r = await context.request.get(origin + '/api/lodge/state')
  assert.equal(r.status(), 200)
  return r.json()
}

const tab = (page, name) => page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name, exact: true }).click()
const saved = page => page.getByText('Saved.', { exact: true }).waitFor()
// The open application's record sits in tabs beside the board: Overview, Interviews, Scorecards, Decisions, Documents.
const record = (page, name) => page.getByRole('tab', { name, exact: true }).click()

async function fits(page, label) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }))
  assert.ok(scroll <= width + 1, `${label}: no sideways scrolling (${scroll} > ${width})`)
}

async function shot(page, evidence, name, width) {
  await fits(page, name)
  await page.screenshot({ path: join(evidence, `${name}-${width}.png`), fullPage: true })
}

export async function journey(browser, root, origin, width, evidence) {
  const s = {}
  try {
    for (const as of ['manager', 'approver', 'interviewer']) s[as] = await session(browser, root, origin, as, width)
    const { manager, approver, interviewer } = s
    const title = `Site supervisor ${width}`, person = `Dana Whitfield ${width}`

    // Manager: the vacancy, its rubric and plan, then an approval request.
    await tab(manager.page, 'Vacancies')
    await manager.page.getByText('New vacancy', { exact: true }).click()
    await manager.page.getByLabel('Job title').fill(title)
    await manager.page.getByLabel('Location').fill('Brooklyn, NY')
    await manager.page.getByLabel('Headcount').fill('1')
    await manager.page.getByLabel('Minimum pay').fill('90000')
    await manager.page.getByLabel('Maximum pay').fill('110000')
    await manager.page.getByLabel('Description applicants will read').fill('Run two residential sites safely and on schedule.')
    await manager.page.getByRole('button', { name: 'Create vacancy' }).click()
    await manager.page.getByRole('heading', { name: title }).waitFor()
    await manager.page.getByLabel('Criteria, one per line', { exact: false }).fill('Site safety: Describes how they ran safety on a past site\nScheduling: Explains a schedule they recovered')
    await manager.page.getByRole('button', { name: 'Save rubric version' }).click()
    await manager.page.getByText('(version 1)').waitFor()
    await manager.page.getByLabel('Interviews, one per line', { exact: false }).fill('Site walk | Interview | 60 | Site safety, Scheduling')
    await manager.page.getByRole('button', { name: 'Save interview plan' }).click()
    await manager.page.getByText('Site walk · Interview · 60 min').waitFor()
    await manager.page.getByLabel('Approver').selectOption('approver@dev.localhost')
    await manager.page.getByRole('button', { name: 'Request approval' }).click()
    await manager.page.getByText('awaiting approval').first().waitFor()
    await shot(manager.page, evidence, 'vacancy', width)

    // Approver: approves the exact terms.
    await approver.page.reload(); await tab(approver.page, 'Approvals')
    await approver.page.getByLabel('Decision').selectOption('approved')
    await approver.page.getByLabel('Reason').fill('Budgeted for this year')
    await shot(approver.page, evidence, 'approval', width)
    await approver.page.getByRole('button', { name: 'Record decision' }).click()
    await approver.page.getByText('Nothing is waiting for you.').waitFor()

    // Manager publishes; an applicant applies on the public page.
    await manager.page.reload(); await tab(manager.page, 'Vacancies')
    await manager.page.getByRole('button', { name: 'Open ' + title }).click()
    await manager.page.getByRole('button', { name: 'Publish application page' }).click()
    const link = manager.page.getByRole('link', { name: /^\/jobs\// })
    await link.waitFor()
    const slug = (await link.textContent()).trim()
    const applicant = await browser.newContext({ viewport: { width, height: 1000 } })
    const form = await applicant.newPage()
    await form.goto(origin + slug)
    await form.getByLabel('Full name').fill(person)
    await form.getByLabel('Email').fill(`dana${width}@example.test`)
    await form.getByLabel('Resume', { exact: false }).setInputFiles({ name: 'resume.txt', mimeType: 'text/plain', buffer: Buffer.from(`${person}\nSite supervisor 2018-2026\n`) })
    await form.getByLabel('I have read privacy notice', { exact: false }).check()
    await shot(form, evidence, 'application-page', width)
    await form.getByRole('button', { name: 'Submit application' }).click()
    await form.getByRole('heading', { name: 'Application received' }).waitFor()
    assert.match(await form.textContent('main'), /LDG-[0-9A-F]{8}/)
    await shot(form, evidence, 'receipt', width)
    await applicant.close()

    // Manager: reviewer, interview, schedule.
    await manager.page.reload(); await tab(manager.page, 'Applications')
    await manager.page.getByRole('button', { name: 'Open ' + person }).click()
    await manager.page.getByLabel('Reviewers (emails, comma separated)', { exact: false }).fill('interviewer@dev.localhost')
    await manager.page.getByRole('button', { name: 'Save reviewers' }).click(); await saved(manager.page)
    await record(manager.page, 'Interviews')
    await manager.page.getByText('Plan an interview', { exact: true }).click()
    // A select's accessible name includes its chosen option, so pick the plan field by name.
    await manager.page.locator('select[name="planItem"]').selectOption({ index: 1 })
    await manager.page.getByLabel('Interviewers (emails, comma separated)').fill('interviewer@dev.localhost')
    await manager.page.getByLabel('Proposed time 1').fill('2026-11-03T10:00')
    await manager.page.getByLabel('Proposed time 2').fill('2026-11-04T10:00')
    await manager.page.getByRole('button', { name: 'Propose interview' }).click(); await saved(manager.page)
    await manager.page.getByLabel('Confirmed time').selectOption({ index: 2 })
    await manager.page.getByRole('button', { name: 'Schedule', exact: true }).click()
    await manager.page.getByRole('link', { name: 'Download calendar invitation (.ics)' }).waitFor()

    // Interviewer: sees only this application and submits an independent scorecard.
    await interviewer.page.reload(); await tab(interviewer.page, 'Applications')
    await interviewer.page.getByRole('button', { name: 'Open ' + person }).click()
    await record(interviewer.page, 'Scorecards')
    await interviewer.page.getByLabel('Rating for Site safety', { exact: false }).selectOption('4')
    await interviewer.page.getByLabel('Evidence for Site safety').fill('Walked through daily toolbox talks and a near-miss log.')
    await interviewer.page.getByLabel('Recommendation').selectOption('strong-yes')
    await interviewer.page.getByLabel('Submit (you cannot change it afterwards)').check()
    await interviewer.page.getByRole('button', { name: 'Save scorecard' }).click()
    await interviewer.page.getByText('Your scorecard · Strong yes', { exact: false }).waitFor()
    await shot(interviewer.page, evidence, 'scorecard', width)

    // Manager: release feedback, prepare the offer, request approval.
    await manager.page.reload(); await tab(manager.page, 'Applications')
    await manager.page.getByRole('button', { name: 'Open ' + person }).click()
    await record(manager.page, 'Scorecards')
    await manager.page.getByRole('button', { name: 'Release feedback to the panel' }).click(); await saved(manager.page)
    await record(manager.page, 'Decisions')
    await manager.page.getByText('Prepare an offer', { exact: true }).click()
    await manager.page.getByLabel('Start date').fill('2026-12-01')
    await manager.page.getByLabel('Pay', { exact: true }).fill('100000')
    await manager.page.getByRole('button', { name: 'Save offer' }).click(); await saved(manager.page)
    await manager.page.getByLabel('Approver').selectOption('approver@dev.localhost')
    await manager.page.getByRole('button', { name: 'Request offer approval' }).click(); await saved(manager.page)

    await approver.page.reload(); await tab(approver.page, 'Approvals')
    await approver.page.getByLabel('Decision').selectOption('approved')
    await approver.page.getByLabel('Reason').fill('Within the approved range')
    await approver.page.getByRole('button', { name: 'Record decision' }).click()
    await approver.page.getByText('Nothing is waiting for you.').waitFor()

    await manager.page.reload(); await tab(manager.page, 'Applications')
    await manager.page.getByRole('button', { name: 'Open ' + person }).click()
    await record(manager.page, 'Decisions')
    await manager.page.getByLabel('Outcome').selectOption('accepted')
    await manager.page.getByLabel('Note', { exact: true }).fill('Accepted by phone')
    await manager.page.getByRole('button', { name: 'Record outcome' }).click()
    await manager.page.getByRole('link', { name: 'HR handoff (JSON)' }).waitFor()
    await shot(manager.page, evidence, 'offer-accepted', width)

    const state = await current(manager.context, origin)
    const app = state.applications.find(a => a.candidateName === person)
    assert.equal(app.status, 'hired')
    assert.deepEqual(app.history.map(e => e.reason), ['Application received (Application page)', 'Offer accepted: Accepted by phone'])
    const seen = await current(interviewer.context, origin)
    assert.ok(seen.applications.every(a => a.reviewers.includes('interviewer@dev.localhost')), 'the interviewer sees only assigned applications')
    return { width, vacancy: title, application: app.id, status: app.status }
  } finally {
    for (const x of Object.values(s)) await x.context.close()
  }
}

const SCREENS = ['Overview', 'Vacancies', 'Applications', 'Candidates', 'Approvals', 'Proposals', 'Retention', 'Move in', 'People', 'Audit']

/** The owner's workspace screens and the public doors, each fitting the width without sideways scrolling. */
export async function screens(browser, root, origin, width, evidence) {
  const owner = await session(browser, root, origin, 'owner', width)
  try {
    for (const name of SCREENS) {
      await tab(owner.page, name)
      await owner.page.locator('nav[aria-label="Workspace"] button[aria-current="page"]', { hasText: name }).waitFor()
      await shot(owner.page, evidence, 'screen-' + name.toLowerCase().replace(/ /g, '-'), width)
    }
  } finally { await owner.context.close() }
  const visitor = await browser.newContext({ viewport: { width, height: 1000 } })
  try {
    const page = await visitor.newPage()
    for (const [path, name] of [['/', 'lobby'], ['/signin', 'signin'], ['/jobs', 'jobs']]) {
      const response = await page.goto(origin + path)
      assert.equal(response.status(), 200, path)
      await shot(page, evidence, 'public-' + name, width)
    }
  } finally { await visitor.close() }
}
