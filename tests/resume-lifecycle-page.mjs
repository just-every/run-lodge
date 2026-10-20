import assert from 'node:assert/strict'
import { join } from 'node:path'
import { api, current, session } from './browser-journey.mjs'

/** The existing DATA-002 journey calls this at each width; all writes use real commands or forms. */
export async function resumeLifecyclePage(browser, { root, origin, owner, intake, open, evidence, width }) {
 const { page, context } = owner, round = crypto.randomUUID().slice(0, 6)
 const manager = await session(browser, root, origin, 'manager', width)
 try {
  const who = (await current(manager.context, origin)).actor.email
  const vacancy = await api(context, origin, 'vacancy', { title: 'Abandoned resume ' + width + ' ' + round, location: 'New York', headcount: 1, manager: who })
  const file = { name: 'abandoned-' + width + '.txt', mediaType: 'text/plain', base64: Buffer.from('Private Resume\nprivate.resume@example.test').toString('base64') }
  const row = await api(manager.context, origin, 'resume-upload', { vacancy: vacancy.id, file })
  const level = await api(context, origin, 'permission-level', { name: 'No resume contact ' + width + ' ' + round, permissions: ['settings'] })
  await api(context, origin, 'job-levels', { id: vacancy.id, members: { [who]: level.id }, roles: {} })
  await page.reload()
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Candidates', exact: true }).click()
  await open()
  const discard = intake.getByRole('button', { name: 'Discard inaccessible pending resumes', exact: true })
  await discard.waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'orphan discard controls fit the viewport before discard')
  assert.ok(!(await intake.innerText()).includes(file.name), 'admin receives a count without the uploader’s filename')
  assert.equal((await context.request.get(origin + '/api/lodge/download/resume-intake/' + row.id)).status(), 404)
  await page.screenshot({ path: join(evidence, `DATA-002-orphan-count-${width}.png`), fullPage: true })
  await discard.click()
  await discard.waitFor({ state: 'detached' })
  assert.equal((await current(context, origin)).orphanedResumeIntakeCount, 0)
  assert.equal((await context.request.get(origin + '/api/lodge/download/resume-intake/' + row.id)).status(), 404)
  const setting = intake.getByLabel('Keep new uncommitted resumes (days)')
  await setting.fill('7')
  await intake.getByRole('button', { name: 'Save pending resume retention', exact: true }).click()
  await page.getByText('New uploads are kept for 7 days.', { exact: false }).waitFor()
  assert.equal((await current(context, origin)).resumeIntakePolicy.retentionDays, 7)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'pending retention and discard fit the viewport')
 } finally { await manager.context.close() }
}
