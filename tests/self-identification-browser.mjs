import assert from 'node:assert/strict'
import { browserWidths } from './browser-widths.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { api, current, session } from './browser-journey.mjs'
import { questionnaireInput, selfIdentificationJob, syntheticAddress } from './self-identification-flow.mjs'

/** Configure through built Settings, apply on the public form and inspect restricted custody. */
export async function selfIdentificationPage(browser, { root, origin, run, evidence, ownerEmail }) {
  const job = await selfIdentificationJob(run, ownerEmail, 'Synthetic voluntary browser role')
  await run('job-board', { token: 'synthetic-voluntary-browser', allowedOrigins: [origin] })
  const input = questionnaireInput(job.id)
  let config
  for (const width of browserWidths) {
    const owner = await session(browser, root, origin, 'owner', width), page = owner.page
    const publicContext = await browser.newContext({ viewport: { width, height: 1000 } }), applicant = await publicContext.newPage()
    const fit = async p => assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'self-identification fits ' + width)
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    try {
      await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Settings', exact: true }).click()
      const settings = page.getByRole('region', { name: 'Voluntary self-identification settings' })
      await settings.getByLabel('Questionnaire job').selectOption(job.id)
      if (!config) {
        await settings.getByLabel('Questionnaire title', { exact: true }).fill(input.title)
        await settings.getByLabel('Voluntary notice', { exact: true }).fill(input.notice)
        await settings.getByLabel('Questions:', { exact: false }).fill([input.questions[0].text, ...input.questions[0].options].join(' | '))
        for (const [label, key] of [['Answer label','answerLabel'], ['Unanswered choice label','unansweredLabel'], ['Explicit decline label','declineLabel'], ['Voluntary consent label','consentLabel']]) await settings.getByLabel(label, { exact: true }).fill(input[key])
        await settings.getByLabel('Reviewed retention days').fill(String(input.retentionDays))
        for (const key of Object.keys(input.review)) await settings.getByLabel(key[0].toUpperCase() + key.slice(1) + ' review evidence', { exact: true }).fill(input.review[key])
        await settings.getByLabel('I confirm review of this exact questionnaire and notice', { exact: true }).check()
        await settings.getByRole('button', { name: 'Save reviewed questionnaire', exact: true }).click()
        await settings.getByText('Version 1 · Available', { exact: true }).waitFor()
        config = (await current(owner.context, origin)).selfIdentification.configurations.find(q => q.vacancy === job.id)
      }
      await settings.getByText('Version 1 · Available', { exact: true }).waitFor()
      await fit(page); await iconTooltips(page)
      await settings.screenshot({ path: evidence + '/self-identification-settings-' + width + '.png' })
      await applicant.goto(origin + '/jobs/' + job.slug)
      const voluntary = applicant.getByRole('group', { name: input.title, exact: true })
      await voluntary.getByLabel(input.questions[0].text).selectOption('Synthetic response one')
      await voluntary.getByLabel(input.consentLabel, { exact: true }).check()
      await applicant.getByLabel('Full name', { exact: true }).fill('Synthetic browser applicant ' + width)
      await applicant.getByLabel('Email', { exact: true }).fill(syntheticAddress('browser-' + width))
      await applicant.getByRole('button', { name: 'Save draft on this device', exact: true }).click()
      if (width === 1440) {
        const storage = await applicant.evaluate(() => JSON.stringify({ ...localStorage }))
        assert.equal(storage.includes('Synthetic response one'), false, 'restricted answer never enters a resumable draft')
        assert.equal(storage.includes('-q1'), false)
        assert.equal(storage.includes('-consent'), false)
      }
      await fit(applicant)
      await applicant.screenshot({ path: evidence + '/self-identification-hosted-' + width + '.png', fullPage: true })
      await applicant.locator('input[name="consent"]').check()
      await applicant.getByRole('button', { name: 'Submit application', exact: true }).click()
      await applicant.getByRole('heading', { name: 'Application received', exact: true }).waitFor()
      await applicant.goto(origin + '/embed/jobs/' + job.slug)
      await applicant.getByRole('group', { name: input.title, exact: true }).getByLabel(input.questions[0].text).selectOption('__declined__')
      await fit(applicant)
      await applicant.screenshot({ path: evidence + '/self-identification-embedded-' + width + '.png', fullPage: true })
      await page.goto(origin + '/enterprise/compliance')
      await page.getByRole('heading', { name: 'US self-identification', exact: true }).waitFor()
      await page.locator('summary').filter({ hasText: input.title }).first().click()
      await page.getByText('Synthetic response one', { exact: true }).first().waitFor()
      if (width === 1440) {
        const state = await current(owner.context, origin)
        const app = state.applications.find(a => a.candidateName === 'Synthetic browser applicant ' + width)
        const response = state.selfIdentification.responses.find(r => r.application === app.id)
        assert.equal(response.versions[0].state, 'answered')
        assert.equal(JSON.stringify(app).includes('Synthetic response one'), false)
        assert.deepEqual(app.answers ?? [], [])
      }
      await fit(page)
      await page.screenshot({ path: evidence + '/self-identification-restricted-' + width + '.png', fullPage: true })
    } catch (error) {
      await page.screenshot({ path: evidence + '/self-identification-failure-' + width + '.png', fullPage: true })
      console.error('Self-identification browser errors:', errors, (await page.locator('body').innerText()).slice(0,2000))
      throw error
    } finally { await publicContext.close(); await owner.context.close() }
  }
}
