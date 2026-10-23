import { browserWidths } from './browser-widths.mjs'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { current, session } from './browser-journey.mjs'

export async function operationsPage(browser, { root, origin, run, evidence, ownerEmail }) {
  const round = crypto.randomUUID().slice(0, 6)
  const job = await run('vacancy', { title: 'Workflow trial operator', location: 'New York', headcount: 1, manager: 'manager@dev.localhost', compensation: { currency: 'USD', min: 5000000, max: 6500000, period: 'year' } })
  await run('rubric', { id: job.id, criteria: [{ name: 'Safe work', description: 'Describes safe operating steps' }] })
  const ready = await run('interview-plan', { id: job.id, plan: [{ name: 'Work review', stageName: 'Interview' }] })
  const question = await run('question', { text: 'Can you work the published shift?', type: 'yes-no', required: false })
  await run('job-questions', { id: job.id, questions: [{ question: question.id, required: false }] })
  for (const width of browserWidths) {
    const s = await session(browser, root, origin, 'owner', width)
    try {
      const { page } = s
      await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Workflow sandbox', exact: true }).click()
      await page.getByLabel('Sandbox name').fill('Shift trial ' + width + ' ' + round)
      await page.getByLabel('Source vacancy').selectOption(job.id)
      await page.getByRole('combobox', { name: /^Test data/ }).selectOption('synthetic')
      await page.getByLabel('Synthetic test cases (JSON array)').fill(JSON.stringify([{ label: 'Explicit shift test', answers: { [question.id]: 'yes' }, interview: { planItem: ready.plan[0].id, participants: ['interviewer@dev.localhost'], slots: ['2026-12-08T15:00:00Z'], slot: 0 } }]))
      await page.getByLabel('I selected synthetic test data; these are not live candidates or recipients').check()
      await page.getByRole('button', { name: 'Clone into sandbox', exact: true }).click()
      const box = page.getByRole('article', { name: 'Sandbox Shift trial ' + width + ' ' + round, exact: true })
      await box.getByLabel('Stage names, in order (one per line)').fill(job.stages.map((st, i) => i === 1 ? 'Shift screen' : st.name).join('\n'))
      await box.getByLabel('Interview duration (minutes)').fill('30')
      await box.getByLabel('vacancy approval route').selectOption(ownerEmail)
      await box.getByRole('button', { name: 'Save trial configuration', exact: true }).click()
      await box.getByLabel('Rule name').fill('Published-shift route')
      await box.getByLabel('Objective screening question').selectOption(question.id)
      await box.getByLabel('Matching answers (comma-separated)').fill('yes')
      await box.getByLabel('Stage action').selectOption('route')
      await box.getByRole('combobox', { name: /^Route to stage/ }).selectOption(job.stages[1].id)
      await box.getByRole('button', { name: 'Save trial rule', exact: true }).click()
      await box.getByText(/Published-shift route · version/).waitFor()
      const before = await current(s.context, origin)
      await box.getByRole('button', { name: 'Preview expected outcomes', exact: true }).click()
      await box.getByRole('heading', { name: 'Reviewed impact', exact: true }).waitFor()
      await box.getByText('Production contact: 0; production signatures: 0; production HR records: 0.', { exact: true }).waitFor()
      const preview = await current(s.context, origin)
      for (const key of ['candidates', 'applications', 'messages', 'offers', 'interviews']) assert.deepEqual(preview[key], before[key], 'sandbox leaves live ' + key + ' unchanged')
      await page.screenshot({ path: join(evidence, `OPS-003-preview-${width}.png`), fullPage: true })
      await box.getByLabel('I approve this exact reviewed configuration for production').check()
      await box.getByRole('button', { name: 'Deploy this reviewed version', exact: true }).click()
      await box.getByRole('button', { name: 'Rollback prior configuration', exact: true }).waitFor()
      const deployed = await current(s.context, origin)
      assert.equal(deployed.vacancies.find(v => v.id === job.id).stages[1].name, 'Shift screen')
      await box.getByRole('button', { name: 'Rollback prior configuration', exact: true }).click()
      await box.getByText('rolled-back', { exact: true }).waitFor()
      const restored = await current(s.context, origin)
      assert.deepEqual(restored.vacancies.find(v => v.id === job.id).stages, before.vacancies.find(v => v.id === job.id).stages)
      for (const [id, name, volume, price] of [['twilio', 'Twilio SMS', '1000', '0.0083'], ['acrobat-sign', 'Acrobat Sign', '20', '2.25'], ['checkr', 'Checkr', '5', '35.99']]) {
        const setup = page.getByRole('article', { name: name + ' setup', exact: true })
        await setup.getByLabel('Employer plan or package').fill('Employer production package')
        await setup.getByLabel(/Monthly volume/).fill(volume)
        await setup.getByLabel('Employer-entered unit price (USD)').fill(price)
        await setup.getByLabel('Fixed monthly fees (USD)').fill('12.00')
        await setup.getByLabel('Pricing source and date').fill('Employer agreement 2026-10-20')
        await setup.getByRole('button', { name: 'Save ' + name + ' estimate', exact: true }).click()
        await setup.getByRole('button', { name: 'Review ' + name + ' setup', exact: true }).waitFor()
        if (id === 'twilio') {
          await setup.getByRole('button', { name: 'Review ' + name + ' setup', exact: true }).click()
          await setup.getByRole('alert').filter({ hasText: /missing employer confirmation.*plan/ }).waitFor()
        }
      }
      await page.getByText('Estimated monthly total: $269.25 USD', { exact: true }).waitFor()
      await page.screenshot({ path: join(evidence, `OPS-003-costs-${width}.png`), fullPage: true })
      await page.getByRole('article', { name: 'Twilio SMS setup', exact: true }).getByRole('button', { name: 'Disable Twilio SMS', exact: true }).click()
      await page.getByText('Estimated monthly total: $248.95 USD', { exact: true }).waitFor()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'sandbox and setup fit the viewport')
      // Reset only our setup records between widths; no provider is contacted.
      await run('provider-setup', { provider: 'acrobat-sign', enabled: false })
      await run('provider-setup', { provider: 'checkr', enabled: false })
    } finally { await s.context.close() }
  }
}
