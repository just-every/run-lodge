import assert from 'node:assert/strict'
import { session, current, api } from './browser-journey.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { file, original } from './take-home-flow.mjs'

/** Real built workspace and native candidate pages; assertions use 1440 and screenshots cover both widths. */
export async function takeHomePage(browser, { root, origin, evidence, ownerEmail }) {
  const owner = await session(browser, root, origin, 'owner', 1440)
  const interviewer = await session(browser, root, origin, 'interviewer', 1440)
  const candidate = await session(browser, root, origin, 'manager', 1440)
  const { page, context } = owner, run = (op, body, c = context) => api(c, origin, op, body)
  const errors = []
  for (const p of [page, interviewer.page, candidate.page]) p.on('pageerror', e => errors.push(e.message))
  const capture = async (p, name) => {
    await iconTooltips(p)
    for (const width of [1440, 390]) {
      await p.setViewportSize({ width, height: 1000 })
      await p.screenshot({ path: evidence + '/take-home-' + name + '-' + width + '.png', fullPage: true })
    }
    await p.setViewportSize({ width: 1440, height: 1000 })
  }
  const fits = p => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
  try {
    const grader = (await current(interviewer.context, origin)).actor.email
    const candidateEmail = (await current(candidate.context, origin)).actor.email
    let job = await run('vacancy', { title: 'Synthetic take-home workspace', location: 'New York', manager: ownerEmail, headcount: 1, compensation: { currency: 'USD', min: 7000000, max: 9000000, period: 'year' } })
    await run('rubric', { id: job.id, criteria: [{ name: 'Safety plan', description: 'Explains a safe work sequence' }] })
    await run('interview-plan', { id: job.id, plan: [{ name: 'Work review', stageName: 'Interview' }] })
    const approval = await run('request-vacancy-approval', { id: job.id, approver: ownerEmail })
    await run('decide-approval', { id: approval.id, version: approval.version, decision: 'approved', reason: 'Synthetic approved terms' })
    job = await run('publish', { id: job.id })
    const applied = await candidate.context.request.post(origin + '/jobs/' + job.slug, { headers: { origin }, form: { name: 'Synthetic take-home applicant', email: candidateEmail, noticeVersion: '1', consent: 'yes' } })
    assert.equal(applied.status(), 200)
    const initial = await current(context, origin), receiptId = (await applied.text()).match(/LDG-[A-F0-9]{8}/)[0]
    const receipt = initial.receipts.find(r => r.id === receiptId), app = initial.applications.find(a => a.id === receipt.application)
    await run('assign-reviewers', { application: app.id, reviewers: [grader] })
    await page.goto(origin + '/app?application=' + app.id)
    await page.getByRole('tab', { name: 'Scorecards', exact: true }).click()
    await page.getByRole('region', { name: 'Take-home assignment', exact: true }).getByRole('link', { name: 'Take-home settings', exact: true }).click()
    let settings = page.getByRole('region', { name: 'Take-home settings', exact: true })
    await settings.getByLabel('Take-home instructions', { exact: true }).fill('Prepare a short plan for a safe site handover.')
    await settings.getByLabel('Candidate time zone', { exact: true }).fill('America/New_York')
    await settings.getByLabel('Deadline in candidate time zone', { exact: true }).fill('2099-03-14T09:00')
    await settings.getByLabel('First grader').selectOption(grader)
    await settings.getByLabel('Second grader').selectOption(ownerEmail)
    await settings.getByLabel('Optional instruction attachment', { exact: true }).setInputFiles({ name: file.name, mimeType: file.mediaType, buffer: Buffer.from(file.base64, 'base64') })
    await settings.getByRole('button', { name: 'Save take-home assignment', exact: true }).click()
    await page.getByText('Saved.', { exact: true }).waitFor()
    assert.ok(await fits(page), 'take-home settings fit the test width')
    await capture(page, 'settings')
    const candidatePath = '/candidate/receipts/' + receiptId + '/take-home/' + app.id
    await candidate.page.goto(origin + candidatePath)
    await candidate.page.getByRole('heading', { name: 'Your take-home', exact: true }).waitFor()
    assert.match(await candidate.page.locator('main').innerText(), /Instructions not delivered/)
    assert.ok(await fits(candidate.page), 'private candidate assignment fits')
    const download = await candidate.context.request.get(origin + candidatePath + '/files/' + (await current(context, origin)).takeHomes.assignments.find(r => r.id === app.id).versions[0].attachment)
    assert.equal((await download.body()).toString(), original)
    await capture(candidate.page, 'candidate-ready')
    await candidate.page.getByLabel('Submission file', { exact: true }).setInputFiles({ name: file.name, mimeType: file.mediaType, buffer: Buffer.from(file.base64, 'base64') })
    await candidate.page.getByLabel('Submission link', { exact: true }).fill('https://example.test/synthetic-lodge-browser')
    await candidate.page.getByRole('button', { name: 'Submit take-home', exact: true }).click()
    await candidate.page.getByRole('heading', { name: 'Submission received', exact: true }).waitFor()
    assert.equal(await candidate.page.getByRole('button', { name: 'Submit take-home', exact: true }).count(), 0)
    await capture(candidate.page, 'candidate-received')
    const wrong = await interviewer.context.request.get(origin + candidatePath)
    assert.equal(wrong.status(), 404, 'another signed-in person cannot use the private assignment link')
    const open = async p => {
      await p.goto(origin + '/app?application=' + app.id)
      await p.getByRole('tab', { name: 'Scorecards', exact: true }).click()
      return p.getByRole('region', { name: 'Take-home assignment', exact: true })
    }
    const fillGrade = async (p, note) => {
      const panel = await open(p)
      await panel.getByText('Write your take-home scorecard', { exact: true }).click()
      await panel.getByLabel('Rating for Safety plan').selectOption('3')
      await panel.getByLabel('Evidence for Safety plan', { exact: true }).fill('The handover includes safe isolation and a named owner.')
      await panel.getByLabel('Take-home recommendation').selectOption('yes')
      await panel.getByLabel('Take-home key take-aways', { exact: true }).fill(note)
      await panel.getByRole('button', { name: 'Submit take-home scorecard', exact: true }).click()
      await panel.getByText(note, { exact: true }).waitFor()
      return panel
    }
    await fillGrade(interviewer.page, 'Synthetic first independent judgment')
    let ownerPanel = await open(page)
    assert.equal(await ownerPanel.getByText('Synthetic first independent judgment', { exact: true }).count(), 0)
    await capture(interviewer.page, 'independent-grading')
    await fillGrade(page, 'Synthetic second independent judgment')
    ownerPanel = page.getByRole('region', { name: 'Take-home assignment', exact: true })
    await ownerPanel.getByRole('button', { name: 'Release take-home feedback', exact: true }).click()
    await ownerPanel.getByText('Take-home feedback released.', { exact: true }).waitFor()
    const released = await open(interviewer.page)
    await released.getByText('Synthetic second independent judgment', { exact: true }).waitFor()
    assert.ok(await fits(interviewer.page), 'released take-home feedback fits')
    await capture(interviewer.page, 'feedback-released')
    const after = await current(context, origin), afterApp = after.applications.find(a => a.id === app.id)
    assert.deepEqual([afterApp.stage, afterApp.history], [app.stage, app.history], 'assignment, submission and grading leave application stage history unchanged')
    const sub = after.takeHomes.submissions.find(s => s.application === app.id)
    const staffDownload = await interviewer.context.request.get(origin + '/api/lodge/download/document/' + sub.files[0])
    assert.equal((await staffDownload.body()).toString(), original)
    assert.deepEqual(errors, [], 'take-home screens have no browser exceptions')
    // End this journey's temporary review grant before the shared hiring journeys begin.
    await run('assign-reviewers', { application: app.id, reviewers: [] })
    assert.equal((await current(interviewer.context, origin)).takeHomes.assignments.some(r => r.application === app.id), false, 'a take-home record grants no application access after review revocation')
  } catch (error) {
    for (const [label, p] of [['manager', page], ['grader', interviewer.page], ['candidate', candidate.page]]) await p.screenshot({ path: evidence + '/take-home-error-' + label + '.png', fullPage: true }).catch(() => {})
    throw error
  } finally { await candidate.context.close(); await interviewer.context.close(); await context.close() }
}
