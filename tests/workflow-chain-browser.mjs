import assert from 'node:assert/strict'
import { join } from 'node:path'
import { browserWidths } from './browser-widths.mjs'
import { current, session } from './browser-journey.mjs'

export async function workflowChainPage(browser, { root, origin, run, evidence, ownerEmail }) {
  const address = name => [name, 'dev.localhost'].join('@')
  const approverEmail = address('approver'), finalEmail = address('interviewer')
  await run('member', { email: finalEmail, name: 'Ivy Chen', roles: ['interviewer', 'approver'] })
  const steps = [{ approvers: [ownerEmail] }, { approvers: [approverEmail, finalEmail] }]
  try {
    for (const width of browserWidths) {
      const owner = await session(browser, root, origin, 'owner', width)
      const approver = await session(browser, root, origin, 'approver', width)
      const final = await session(browser, root, origin, 'interviewer', width)
      try {
        const job = await run('vacancy', { title: 'Headcount chain ' + width, location: 'Denver', headcount: 1, manager: address('manager'), compensation: { currency: 'USD', min: 6000000, max: 8000000, period: 'year' } })
        await run('rubric', { id: job.id, criteria: [{ name: 'Safe work', description: 'Explains safe operating steps' }] })
        await run('interview-plan', { id: job.id, plan: [{ name: 'Work review', stageName: 'Interview' }] })
        const { page } = owner
        await page.reload()
        await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Workflow sandbox', exact: true }).click()
        const name = 'Headcount review ' + width
        await page.getByLabel('Sandbox name').fill(name)
        await page.getByLabel('Source vacancy').selectOption(job.id)
        await page.getByRole('combobox', { name: /^Test data/ }).selectOption('synthetic')
        await page.getByLabel('Synthetic test cases (JSON array)').fill(JSON.stringify([{ label: 'synthetic-lodge-1' }]))
        await page.getByLabel('Headcount trial decisions (JSON array)').fill(JSON.stringify([ownerEmail, finalEmail, approverEmail].map(approver => ({ approver, decision: 'approved' }))))
        await page.getByLabel('I selected synthetic test data; these are not live candidates or recipients').check()
        await page.getByRole('button', { name: 'Clone into sandbox', exact: true }).click()
        const box = page.getByRole('article', { name: 'Sandbox ' + name, exact: true })
        await box.getByLabel('Headcount approval steps', { exact: false }).fill(steps.map(step => step.approvers.join(', ')).join('\n'))
        await box.getByRole('button', { name: 'Save trial configuration', exact: true }).click()
        await box.getByRole('button', { name: 'Preview expected outcomes', exact: true }).click()
        await box.getByRole('heading', { name: 'Headcount chain preview', exact: true }).waitFor()
        await box.getByText('Trial result: approved. No production decision or opening is created.', { exact: true }).waitFor()
        if (width === 1440) {
          const before = await current(owner.context, origin)
          assert.equal(before.approvals.some(x => x.subjectId === job.id), false)
          assert.equal((before.vacancies.find(x => x.id === job.id).openings ?? []).length, 0)
        }
        await page.screenshot({ path: join(evidence, `headcount-chain-preview-${width}.png`), fullPage: true })
        const deploy = async () => {
          await box.getByLabel('I approve this exact reviewed configuration for production').check()
          await box.getByRole('button', { name: 'Deploy this reviewed version', exact: true }).click()
          await box.getByRole('button', { name: 'Rollback prior configuration', exact: true }).waitFor()
        }
        await deploy()
        await box.getByRole('button', { name: 'Rollback prior configuration', exact: true }).click()
        await box.getByText('rolled-back', { exact: true }).waitFor()
        if (width === 1440) assert.equal((await current(owner.context, origin)).vacancies.find(x => x.id === job.id).approvalChain, null)
        await page.screenshot({ path: join(evidence, `headcount-chain-rollback-${width}.png`), fullPage: true })
        await box.getByRole('button', { name: 'Preview expected outcomes', exact: true }).click()
        await box.getByRole('heading', { name: 'Headcount chain preview', exact: true }).waitFor()
        await deploy()
        // Request through the actual vacancy form, which uses the saved chain.
        await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Vacancies', exact: true }).click()
        await page.getByRole('button', { name: 'Open ' + job.title, exact: true }).click()
        await page.getByRole('button', { name: 'Request approval', exact: true }).click()
        const asked = (await current(owner.context, origin)).approvals.find(x => x.subjectId === job.id)
        const open = async actor => {
          await actor.page.reload()
          await actor.page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Approvals', exact: true }).click()
          return actor.page.locator('#approval-' + asked.id)
        }
        const decide = async (actor, reason) => {
          const card = await open(actor)
          await card.getByRole('combobox', { name: /^Decision/ }).selectOption('approved')
          await card.getByLabel('Reason', { exact: true }).fill(reason)
          await card.getByRole('button', { name: 'Record decision', exact: true }).click()
          await actor.page.getByText('Saved.', { exact: true }).waitFor()
        }
        let card = await open(owner)
        await card.getByRole('heading', { name: 'Headcount approval chain', exact: true }).waitFor()
        await page.screenshot({ path: join(evidence, `headcount-chain-sequential-${width}.png`), fullPage: true })
        await decide(owner, 'Reviewed sequential budget')
        await decide(approver, 'Reviewed finance terms')
        card = await open(final)
        await card.getByText(/Parker Jones: approved/).waitFor()
        if (width === 1440) {
          const state = await current(owner.context, origin), jobState = state.vacancies.find(x => x.id === job.id)
          assert.equal(jobState.approvedNow, false)
          assert.equal((jobState.openings ?? []).length, 0)
          assert.equal(state.approvals.find(x => x.id === asked.id).status, 'pending')
        }
        await final.page.screenshot({ path: join(evidence, `headcount-chain-parallel-${width}.png`), fullPage: true })
        await decide(final, 'Reviewed department terms')
        await final.page.getByRole('heading', { name: 'History', exact: true }).waitFor()
        if (width === 1440) {
          const state = await current(owner.context, origin)
          assert.equal(state.approvals.find(x => x.id === asked.id).status, 'approved')
          assert.equal(state.vacancies.find(x => x.id === job.id).openings.length, 1)
        }
        await final.page.screenshot({ path: join(evidence, `headcount-chain-complete-${width}.png`), fullPage: true })
        assert.ok(await final.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'chain decisions fit the viewport')
      } finally { await owner.context.close(); await approver.context.close(); await final.context.close() }
    }
  } finally { await run('member', { email: finalEmail, name: 'Ivy Chen', roles: ['interviewer'] }) }
}
