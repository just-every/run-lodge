import { careersSite } from './board-page.mjs'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { brandInput, careersJob, employerLogo } from './careers-flow.mjs'
import { current, session } from './browser-journey.mjs'

async function shot(page, evidence, name, width) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' fits viewport')
  await page.screenshot({ path: join(evidence, `careers-${name}-${width}.png`), fullPage: true })
}
export async function careersPublicPage(browser, { origin, jobs, evidence, prefix = '' }) {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } })
    try {
      const page = await context.newPage()
      await page.goto(origin + '/jobs')
      await page.getByRole('img', { name: /Hudson Builders|Example Builders/ }).waitFor()
      await page.getByRole('textbox', { name: 'Search roles', exact: true }).fill('coordinator')
      await page.getByRole('combobox', { name: /^Location/ }).selectOption('Austin, TX')
      await page.getByRole('combobox', { name: /^Work mode/ }).selectOption('true')
      await page.getByRole('button', { name: 'Show roles', exact: true }).click()
      await page.getByRole('link', { name: jobs.remote.title, exact: true }).waitFor()
      assert.equal(await page.getByRole('link', { name: jobs.onsite.title, exact: true }).count(), 0)
      await shot(page, evidence, prefix + 'filtered', width)
      await page.goto(origin + '/jobs/' + jobs.onsite.slug)
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
      await page.getByLabel('Resume (optional, PDF, Word or text, up to 1 MB)', { exact: true }).setInputFiles({ name: 'avery-hudson.txt', mimeType: 'text/plain', buffer: Buffer.from('Avery Hudson: led safe occupied residential works for eight years.') })
      await page.getByRole('checkbox', { name: /I have read privacy notice/ }).check()
      await shot(page, evidence, prefix + 'resumed', width)
      await page.getByRole('button', { name: 'Submit application', exact: true }).click()
      await page.getByRole('heading', { name: 'Application received', exact: true }).waitFor()
      const code = await page.locator('[data-recovery-code]').textContent()
      const receipt = /LDG-[A-F0-9]{8}/.exec(await page.textContent('main'))[0]
      await shot(page, evidence, prefix + 'receipt', width)
      await page.getByRole('link', { name: 'Recover a receipt', exact: true }).click()
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
  for (const width of [1440,390]) {
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
    for (const width of [1440,390]) {
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
        await frame.getByRole('button', { name: 'Submit application', exact: true }).click()
        const code = await frame.locator('[data-recovery-code]').textContent()
        await frame.getByRole('link', { name: 'Recover a receipt', exact: true }).click()
        await frame.getByRole('textbox', { name: 'Private recovery code', exact: true }).fill(code)
        await frame.getByRole('button', { name: 'Recover receipt', exact: true }).click()
        await frame.getByRole('heading', { name: 'Application received', exact: true }).waitFor()
        await frame.getByRole('img', { name: /Example Builders/ }).waitFor()
        await shot(page, evidence, 'embed-recovered', width)
      } finally { await context.close() }
    }
  } finally { await site.close(); if (previousBoard) await run('job-board', { token: previousBoard.token, allowedOrigins: previousBoard.allowedOrigins }) }
}
