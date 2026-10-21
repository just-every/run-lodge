// TEAM-002 and TEAM-003 on the real screens at 1440 and 390: the manager mentions a colleague with access and one without
// from the note box (with suggestions), the first opens the candidate from their home and the mention leaves it, the second
// sees the text with no link, and a member changes a notification setting. (Local `rer dev` captures no mail; the mail
// itself is asserted through the API in tests/notify-flow.mjs.)
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { current, session } from './browser-journey.mjs'

async function fits(page, label) {
 const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }))
 assert.ok(scroll <= width + 1, `${label}: no sideways scrolling (${scroll} > ${width})`)
}

// A manager lands on the board; the home list and settings sit on the Overview tab.
const overview = async page => { await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Overview', exact: true }).click(); await page.getByRole('heading', { name: 'Your work' }).waitFor() }

export async function notifyPage(browser, { root, origin, run, job, evidence, ownerEmail }) {
 for (const width of [1440, 390]) {
  const name = `Mention Person ${width}`
  await run('candidate', { name, email: `mention.${width}@example.test`, source: 'Referral', consentBasis: 'referral', consentNote: 'Agreed', vacancy: job.id })
  const manager = await session(browser, root, origin, 'manager', width), owner = await session(browser, root, origin, 'owner', width), interviewer = await session(browser, root, origin, 'interviewer', width)
  try {
   const errors = []
   for (const s of [manager, owner, interviewer]) s.page.on('pageerror', e => errors.push(e.message))
   const w = await current(manager.context, origin), app = w.applications.find(a => a.candidateName === name)
   const page = manager.page
   await page.goto(origin + '/app?application=' + app.id)
   await page.getByRole('tab', { name: 'Notes', exact: true }).click()
   const box = page.getByLabel('Note for the hiring team')
   await box.fill('Please look at this one, @ivy')
   const options = page.getByRole('listbox', { name: 'People you can mention' })
   await options.getByRole('button', { name: /Ivy Chen/ }).click()
   await box.evaluate(el => { el.focus(); el.setSelectionRange(el.value.length, el.value.length) })
   await box.pressSequentially('and also @' + ownerEmail.slice(0, 5))
   await options.getByRole('button').first().click()
   assert.match(await box.inputValue(), /@interviewer@dev\.localhost and also @owner/)
   await fits(page, 'note box')
   await page.screenshot({ path: join(evidence, `TEAM-002-note-${width}.png`), fullPage: true })
   await page.getByRole('button', { name: 'Add note' }).click()
   await page.getByText('Saved.', { exact: true }).waitFor()

   // The colleague with access: the mention is on their home, links to the candidate and leaves once opened.
   await owner.page.goto(origin + '/app'); await overview(owner.page)
   const work = owner.page.getByRole('heading', { name: 'Your work' }).locator('..')
   const mention = work.getByRole('link', { name: /mentioned you on/ })
   await mention.waitFor()
   await fits(owner.page, 'owner home')
   await owner.page.screenshot({ path: join(evidence, `TEAM-002-home-${width}.png`), fullPage: true })
   await mention.click()
   await owner.page.getByRole('heading', { name }).first().waitFor()
   assert.equal((await current(owner.context, origin)).alerts.find(x => x.event === 'mention')?.read, true, 'opening it marked it read')

   // The colleague without access: the text, no link, and the candidate stays closed to them.
   await interviewer.page.goto(origin + '/app'); await overview(interviewer.page)
   const text = interviewer.page.getByRole('heading', { name: 'Your work' }).locator('..').getByRole('listitem').filter({ hasText: 'mentioned you in a note' })
   await text.waitFor()
   assert.equal(await text.getByRole('link').getAttribute('href'), '#', 'no link to the candidate')
   assert.ok(!(await current(interviewer.context, origin)).applications.some(a => a.id === app.id))
   await fits(interviewer.page, 'interviewer home')
   await interviewer.page.screenshot({ path: join(evidence, `TEAM-002-nolink-${width}.png`), fullPage: true })

   // TEAM-003: the manager's own setting for the job, saved from the settings card.
   await manager.page.goto(origin + '/app'); await overview(manager.page)
   const settings = manager.page.getByRole('heading', { name: 'Notification settings' }).locator('..')
   await settings.locator('summary', { hasText: job.title }).click()
   await settings.getByLabel(`New application: email for ${job.title}`).selectOption('digest')
   await manager.page.getByText('Saved.', { exact: true }).waitFor()
   assert.equal((await current(manager.context, origin)).notify.jobs.find(j => j.vacancy === job.id).settings.application.email, 'digest')
   await fits(manager.page, 'settings')
   await manager.page.screenshot({ path: join(evidence, `TEAM-003-settings-${width}.png`), fullPage: true })
   assert.deepEqual(errors, [])
  } finally { for (const s of [manager, owner, interviewer]) await s.context.close() }
 }
}
