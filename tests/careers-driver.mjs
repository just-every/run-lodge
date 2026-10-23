// Shared HTTP and browser driver; each public-door journey retains its own assertions.
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { BUSINESS } from "./harness.mjs"
import { browserWidths } from "./browser-widths.mjs"
import { careersSite } from "./board-page.mjs"
import { join } from "node:path"
import { current, session } from "./browser-journey.mjs"

export const brandInput = { intro: 'Build thoughtful homes with a team that takes safety seriously.', primaryColor: '#194b3b', backgroundColor: '#ffffff', textColor: '#172033' }
export async function employerLogo() { return { name: 'hudson-builders.png', mediaType: 'image/png', base64: (await readFile(new URL('./fixtures/careers-employer.png', import.meta.url))).toString('base64') } }
export async function careersJob(run, title, workMode = 'onsite', location = 'Brooklyn, NY') {
  const v = await run('vacancy', { title, workMode, location, employmentType: 'full-time', manager: 'owner@example.test', description: 'Coordinate safe residential construction with clear communication.', headcount: 2, compensation: { currency: 'USD', min: 8000000, max: 10000000, period: 'year' } })
  await run('rubric', { id: v.id, criteria: [{ name: 'Site safety', description: 'A concrete example of safe residential work' }] })
  await run('interview-plan', { id: v.id, plan: [{ name: 'Site walk', stageName: 'Interview' }] })
  const request = await run('request-vacancy-approval', { id: v.id, approver: 'owner@example.test' })
  await run('decide-approval', { id: request.id, decision: 'approved', version: request.version, reason: 'Reviewed job, pay and interview plan' })
  return run('publish', { id: v.id })
}
export async function checkCareers(h) {
  await h.command('business', BUSINESS)
  const manager = await h.member('careers-manager@example.test', ['manager'])
  await h.command('careers-brand', { ...brandInput, logo: await employerLogo() }, manager, 403)
  await h.command('careers-brand', { ...brandInput, primaryColor: '#eeeeee' }, h.owner, 400)
  await h.command('careers-brand', { ...brandInput, textColor: '#dddddd' }, h.owner, 400)
  await h.command('careers-brand', { ...brandInput, logo: { name: 'unsafe.svg', mediaType: 'image/svg+xml', base64: Buffer.from('<svg onload="alert(1)"/>').toString('base64') } }, h.owner, 400)
  const logo = await employerLogo()
  await h.command('careers-brand', { ...brandInput, logo })
  const onsite = await careersJob(h.command, 'Residential site supervisor')
  const remote = await careersJob(h.command, 'Remote project coordinator', 'remote', 'Austin, TX')
  const jobs = await h.send('/jobs')
  assert.match(jobs.text, /\/careers\/logo/); assert.ok(jobs.text.includes(brandInput.intro))
  const filtered = await h.send('/jobs?remote=true&location=' + encodeURIComponent('Austin, TX') + '&q=coordinator')
  assert.ok(filtered.text.includes(remote.slug)); assert.ok(!filtered.text.includes('/jobs/' + onsite.slug))
  assert.equal(Buffer.from((await h.send('/careers/logo')).text).length > 0, true)
  assert.ok((await h.send('/careers/brand.css')).text.includes(brandInput.primaryColor))
  await h.command('job-board', { token: 'synthetic-lodge-1', allowedOrigins: ['https://employer.example.com'] })
  const form = await h.send('/jobs/' + onsite.slug)
  assert.match(form.text, /data-careers-draft/)
  const data = new FormData()
  for (const [k,v] of Object.entries({ name: 'Avery Careers', email: 'avery-careers@example.test', noticeVersion: '1', consent: 'yes' })) data.set(k,v)
  data.set('resume', new File(['Avery: supervised occupied renovation sites.'], 'avery-resume.txt', { type: 'text/plain' }))
  const receipt = await h.send('/jobs/' + onsite.slug, data)
  assert.equal(receipt.status, 200)
  const code = /data-recovery-code>([a-f0-9]{64})</.exec(receipt.text)?.[1]
  assert.ok(code)
  const id = /LDG-[A-F0-9]{8}/.exec(receipt.text)[0]
  const saved = (await h.state()).receipts.find(r => r.id === id)
  assert.equal(saved.recoveryHash, undefined, 'recovery material stays out of workspace and candidate exports')
  const wrong = new FormData(); wrong.set('code', '0'.repeat(64))
  assert.equal((await h.send('/jobs/receipt', wrong)).status, 404)
  const recovery = new FormData(); recovery.set('code', code)
  const recovered = await h.send('/jobs/receipt', recovery)
  assert.equal(recovered.status, 200); assert.ok(recovered.text.includes(id))
  assert.ok(!recovered.text.includes('avery-careers@example.test'))
  assert.equal((await h.send('/jobs/receipt', recovery, '', { origin: 'https://foreign.example.com' })).status, 403)
  const embedded = await h.send('/embed/receipt', recovery)
  assert.equal(embedded.status, 200); assert.ok(embedded.text.includes(id)); assert.match(embedded.text, /\/careers\/logo/)
  const receiptRecord = JSON.parse((await h.db.prepare("SELECT value FROM l_records WHERE kind='receipt' AND id=?").bind(id).first()).value)
  await h.db.prepare("UPDATE l_records SET value=json_set(value,'$.recoveryExpires',?) WHERE kind='receipt' AND id=?").bind('2000-01-01T00:00:00Z',id).run()
  assert.equal((await h.send('/jobs/receipt', recovery)).status,404,'an expired possession code cannot recover the receipt')
  await h.db.prepare("UPDATE l_records SET value=? WHERE kind='receipt' AND id=?").bind(JSON.stringify(receiptRecord),id).run()
  const app = (await h.state()).applications.find(a => a.id === saved.application)
  const exported = await h.send('/api/lodge/download/candidate/' + app.candidate, undefined, h.owner)
  assert.ok(!JSON.stringify(exported.value).includes('recoveryHash'))
  await h.command('move', { application: app.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Applicant withdrew' })
  const candidate = (await h.state()).candidates.find(c => c.id === app.candidate)
  assert.equal((await h.send('/api/lodge/delete-candidate', { candidate: candidate.id, confirm: candidate.name, reason: 'Applicant asked' }, h.owner)).status, 200)
  assert.equal((await h.send('/jobs/receipt', recovery)).status, 404)
}

async function brandedButton(button) {
  const expected = 'rgb(' + [1,3,5].map(i => parseInt(brandInput.primaryColor.slice(i,i+2),16)).join(', ') + ')'
  assert.equal(await button.evaluate(e => getComputedStyle(e).backgroundColor), expected, 'the employer primary color reaches the rendered control')
}
async function shot(page, evidence, name, width) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' fits viewport')
  await page.screenshot({ path: join(evidence, `careers-${name}-${width}.png`), fullPage: true })
}
export async function careersPublicPage(browser, { origin, jobs, evidence, prefix = '' }) {
  for (const width of browserWidths) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } })
    try {
      const page = await context.newPage()
      await page.goto(origin + '/jobs')
      await page.getByRole('img', { name: /Hudson Builders|Example Builders/ }).waitFor()
      await page.getByRole('textbox', { name: 'Search roles', exact: true }).fill('coordinator')
      await page.getByRole('combobox', { name: /^Location/ }).selectOption('Austin, TX')
      await page.getByRole('combobox', { name: /^Work mode/ }).selectOption('true')
      await brandedButton(page.getByRole('button', { name: 'Show roles', exact: true }))
      await page.getByRole('button', { name: 'Show roles', exact: true }).click()
      await page.getByRole('link', { name: jobs.remote.title, exact: true }).waitFor()
      assert.equal(await page.getByRole('link', { name: jobs.onsite.title, exact: true }).count(), 0)
      await shot(page, evidence, prefix + 'filtered', width)
      await page.goto(origin + '/jobs/' + jobs.onsite.slug)
      await page.getByRole('img', { name: /Hudson Builders|Example Builders/ }).waitFor()
      assert.ok((await page.locator('header.employer-brand').textContent()).includes(brandInput.intro))
      const name = page.getByRole('textbox', { name: 'Full name', exact: true })
      // Traverse the accessible keyboard order to the first application field.
      for (let tab = 0; tab < 20 && !await name.evaluate(e => e === document.activeElement); tab++) await page.keyboard.press('Tab')
      assert.ok(await name.evaluate(e => e === document.activeElement), 'the named field is keyboard reachable')
      await page.keyboard.insertText('Avery Hudson ' + prefix + width)
      await page.keyboard.press('Tab'); await page.keyboard.insertText(`avery-${prefix}${width}@example.test`)
      await page.getByRole('textbox', { name: /Adjustments you need/ }).fill('A private accessibility request not saved in the browser draft.')
      await page.getByRole('button', { name: 'Save draft on this device', exact: true }).click()
      await page.getByRole('status').getByText('Draft saved on this device.', { exact: true }).waitFor()
      const draft = await page.evaluate(() => Object.entries(localStorage).find(([k]) => k.startsWith('lodge-application-draft:'))?.[1])
      assert.ok(draft.includes('Avery Hudson')); assert.ok(!draft.includes('private accessibility request'))
      await page.reload()
      await name.fill('')
      await page.getByRole('button', { name: 'Resume saved draft', exact: true }).click()
      assert.equal(await name.inputValue(), 'Avery Hudson ' + prefix + width)
      assert.equal(await page.getByRole('checkbox', { name: /I have read privacy notice/ }).isChecked(), false)
      assert.equal(await page.getByRole('textbox', { name: /Adjustments you need/ }).inputValue(), '')
      const fullName = 'Avery Hudson ' + prefix + width, status = page.locator('[data-draft-status]')
      const stored = edit => page.evaluate(edit => { const k = Object.keys(localStorage).find(k => k.startsWith('lodge-application-draft:')); if (!k) return false; if (edit) { const d = JSON.parse(localStorage[k]); localStorage[k] = JSON.stringify(Function('d', edit)(d) ?? d) } return true }, edit)
      const resumeRefused = async why => {
        await name.fill(''); await page.getByRole('button', { name: 'Resume saved draft', exact: true }).click()
        assert.equal(await name.inputValue(), '', why)
        assert.equal(await status.textContent(), await status.evaluate(e => e.dataset.unavailable), why + ': the applicant is told no draft was restored')
        assert.equal(await stored(), false, why + ': the refused draft is removed from the device')
      }
      await stored('d.savedAt = Date.now() - 23 * 3600000')
      await name.fill(''); await page.getByRole('button', { name: 'Resume saved draft', exact: true }).click()
      assert.equal(await name.inputValue(), fullName, 'a draft inside 24 hours still resumes')
      await stored('d.savedAt = Date.now() - 24 * 3600000 - 60000')
      await resumeRefused('a draft older than 24 hours')
      await name.fill(fullName)
      await page.getByLabel('Resume (optional, PDF, Word or text, up to 1 MB)', { exact: true }).setInputFiles({ name: 'avery-hudson.txt', mimeType: 'text/plain', buffer: Buffer.from('Avery Hudson: led safe occupied residential works for eight years.') })
      await page.getByRole('checkbox', { name: /I have read privacy notice/ }).check()
      await shot(page, evidence, prefix + 'resumed', width)
      await brandedButton(page.getByRole('button', { name: 'Submit application', exact: true }))
      await page.getByRole('button', { name: 'Submit application', exact: true }).click()
      await page.getByRole('heading', { name: 'Application received', exact: true }).waitFor()
      const code = await page.locator('[data-recovery-code]').textContent()
      const receipt = /LDG-[A-F0-9]{8}/.exec(await page.textContent('main'))[0]
      await shot(page, evidence, prefix + 'receipt', width)
      await page.getByRole('link', { name: 'Recover a receipt', exact: true }).click()
      await shot(page, evidence, prefix + 'recovery-form', width)
      await page.getByRole('textbox', { name: 'Private recovery code', exact: true }).fill('0'.repeat(64))
      await page.getByRole('button', { name: 'Recover receipt', exact: true }).click()
      await page.getByRole('alert').waitFor()
      await shot(page, evidence, prefix + 'recovery-refused', width)
      await page.getByRole('textbox', { name: 'Private recovery code', exact: true }).fill(code)
      await page.getByRole('button', { name: 'Recover receipt', exact: true }).click()
      await page.getByRole('heading', { name: 'Application received', exact: true }).waitFor()
      assert.ok((await page.textContent('main')).includes(receipt))
      assert.equal(await page.locator('[data-recovery-code]').count(), 0, 'recovery never rediscloses the credential')
      await shot(page, evidence, prefix + 'recovered', width)
      await page.goto(origin + '/jobs/' + jobs.onsite.slug)
      await page.getByRole('button', { name: 'Delete saved draft', exact: true }).click()
      assert.equal(await page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('lodge-application-draft:'))), false)
    } finally { await context.close() }
  }
}
export async function careersPage(browser, { root, origin, run, evidence, ownerEmail }) {
  const keeper = await session(browser, root, origin, 'owner', 1440)
  const previousBoard = (await current(keeper.context, origin)).jobBoard
  await keeper.context.close()
  const jobRun = (op, body) => run(op, Object.fromEntries(Object.entries(body).map(([k,v]) => [k, v === 'owner@example.test' ? ownerEmail : v])))
  const jobs = { onsite: await careersJob(jobRun, 'Residential site supervisor'), remote: await careersJob(jobRun, 'Remote project coordinator', 'remote', 'Austin, TX') }
  const logo = await employerLogo()
  await run('job-board', { token: 'synthetic-lodge-1', allowedOrigins: ['https://employer.example.com'] })
  for (const width of browserWidths) {
    const owner = await session(browser, root, origin, 'owner', width)
    try {
      const page = owner.page
      await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'People', exact: true }).click()
      const card = page.getByRole('article', { name: 'Careers branding', exact: true })
      await card.getByLabel('Employer introduction', { exact: false }).fill(brandInput.intro)
      await card.getByLabel('Primary color (#RRGGBB)', { exact: false }).fill('#eeeeee')
      await card.getByLabel('Background color (#RRGGBB)', { exact: false }).fill(brandInput.backgroundColor)
      await card.getByLabel('Text color (#RRGGBB)', { exact: true }).fill(brandInput.textColor)
      await card.getByRole('button', { name: 'Save careers branding', exact: true }).click()
      await card.getByRole('alert').filter({ hasText: /contrast/ }).waitFor()
      await card.getByLabel('Primary color (#RRGGBB)', { exact: false }).fill(brandInput.primaryColor)
      await card.getByLabel(/^Employer logo \(/).setInputFiles({ name: logo.name, mimeType: logo.mediaType, buffer: Buffer.from(logo.base64, 'base64') })
      await card.getByRole('button', { name: 'Save careers branding', exact: true }).click()
      await card.getByText('Saved logo: ' + logo.name, { exact: true }).waitFor()
      await page.waitForFunction(() => document.querySelector('[aria-label="Careers branding"] input[type=file]')?.files.length === 0)
      assert.equal(await card.locator('input[type=file]').evaluate(e => e.files.length), 0, 'saving clears the contributed upload before another edit')
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await page.getByRole('region', { name: 'Employer careers site', exact: true }).screenshot({ path: join(evidence, `careers-settings-${width}.png`) })
    } finally { await owner.context.close() }
  }
  await careersPublicPage(browser, { origin, jobs, evidence })
  const site = await careersSite(root)
  try {
    await run('job-board', { token: 'synthetic-lodge-1', allowedOrigins: [site.origin] })
    for (const width of browserWidths) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } })
      try {
        const page = await context.newPage()
        await page.goto(site.origin + '/embed-host?lodge=' + encodeURIComponent(origin))
        const frame = page.frameLocator('iframe[title="Open roles"]')
        await frame.getByRole('img', { name: /Example Builders/ }).waitFor()
        await frame.getByRole('link', { name: jobs.remote.title, exact: true }).click()
        await frame.getByRole('img', { name: /Example Builders/ }).waitFor()
        await frame.getByRole('textbox', { name: 'Full name', exact: true }).fill('Morgan Embed ' + width)
        await frame.getByRole('textbox', { name: 'Email', exact: true }).fill(`morgan-embed-${width}@example.test`)
        await frame.getByRole('checkbox', { name: /I have read privacy notice/ }).check()
        await shot(page, evidence, 'embed-application', width)
        await brandedButton(frame.getByRole('button', { name: 'Submit application', exact: true }))
        await frame.getByRole('button', { name: 'Submit application', exact: true }).click()
        const code = await frame.locator('[data-recovery-code]').textContent()
        await frame.getByRole('link', { name: 'Recover a receipt', exact: true }).click()
        await shot(page, evidence, 'embed-recovery-form', width)
        await frame.getByRole('textbox', { name: 'Private recovery code', exact: true }).fill('0'.repeat(64))
        await frame.getByRole('button', { name: 'Recover receipt', exact: true }).click()
        await frame.getByRole('alert').waitFor()
        await shot(page, evidence, 'embed-recovery-refused', width)
        await frame.getByRole('textbox', { name: 'Private recovery code', exact: true }).fill(code)
        await frame.getByRole('button', { name: 'Recover receipt', exact: true }).click()
        await frame.getByRole('heading', { name: 'Application received', exact: true }).waitFor()
        await frame.getByRole('img', { name: /Example Builders/ }).waitFor()
        await shot(page, evidence, 'embed-recovered', width)
      } finally { await context.close() }
    }
  } finally { await site.close(); if (previousBoard) await run('job-board', { token: previousBoard.token, allowedOrigins: previousBoard.allowedOrigins }) }
}
