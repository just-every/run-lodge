// Shared HTTP and browser driver; each public-door journey retains its own assertions.
import assert from "node:assert/strict"
import { browserWidths } from "./browser-widths.mjs"
import { join } from "node:path"
import { current, session } from "./browser-journey.mjs"

const durableHiring = async h => (await h.db.prepare("SELECT kind,id,value FROM l_records WHERE kind NOT IN ('audit','workflow-sandbox','provider-setup') ORDER BY kind,id").all()).results
const refused = (h, op, body, cookie = h.owner) => h.send('/api/lodge/command/' + op, body, cookie)

export async function checkOperations(h) {
  const cmd = h.command, v = h.vacancy
  const question = await cmd('question', { text: 'Can you work the published shift?', type: 'yes-no', required: false })
  await cmd('job-questions', { id: v.id, questions: [{ question: question.id, required: false }] })
  await cmd('unpublish', { id: v.id, reason: 'Review workflow before activation' })
  const create = { name: 'Shift routing trial', vacancy: v.id, mode: 'synthetic', confirmSynthetic: true, samples: [{ label: 'Shift available', answers: { [question.id]: 'yes' }, interview: { planItem: v.plan[0].id, participants: ['panel@example.test'], slots: ['2026-12-05T15:00:00Z'], slot: 0 } }, { label: 'Shift unavailable', answers: { [question.id]: 'no' } }] }
  assert.equal((await refused(h, 'sandbox-create', create, h.panel)).status, 403)
  assert.equal((await refused(h, 'sandbox-create', create, h.otherManager)).status, 403)
  assert.equal((await refused(h, 'sandbox-create', create, h.agent)).status, 403)
  assert.equal((await refused(h, 'sandbox-create', { ...create, confirmSynthetic: false })).status, 400)
  const box = await cmd('sandbox-create', create, h.manager)
  const rule = { op: 'screening-rule', input: { name: 'Shift route', question: question.id, when: { equals: 'yes' }, then: { kind: 'route', stage: v.stages[1].id } } }
  assert.equal((await refused(h, 'sandbox-edit', { id: box.id, edits: [rule] }, h.manager)).status, 403, 'existing rule authoring stays admin-only')
  await cmd('sandbox-edit', { id: box.id, edits: [
    { op: 'vacancy-stages', input: { stages: v.stages.map((s, i) => ({ ...s, name: i === 1 ? 'Shift screen' : s.name })) } },
    { op: 'rubric', input: { criteria: [{ name: 'Shift coverage', description: 'Describes availability for the published shift' }] } },
    { op: 'interview-plan', input: { plan: [{ ...v.plan[0], durationMinutes: 30, criteria: [] }] } },
    { op: 'approval-routing', input: { routing: { vacancy: 'approve@example.test', offer: 'approve@example.test', message: 'm1@example.test' } } }, rule,
    { op: 'screening-rule', input: { name: 'Shift tag', question: question.id, when: { equals: 'yes' }, then: { kind: 'tag', tag: 'shift-covered' } } },
    { op: 'screening-rule', input: { name: 'Shift reviewer', question: question.id, when: { equals: 'yes' }, then: { kind: 'assign', reviewer: 'review@example.test' } } },
    { op: 'screening-rule', input: { name: 'Shift review queue', question: question.id, when: { equals: 'no' }, then: { kind: 'propose-reject', closeReason: 'skills', reason: 'Shift requirement needs review', send: 'none' } } },
  ] })
  const before = await durableHiring(h)
  let preview = await cmd('sandbox-preview', { id: box.id })
  assert.deepEqual(await durableHiring(h), before, 'preview changes no live hiring record, contact, signature, HR record or provider outbox')
  assert.equal(preview.impact.outcomes[0].after.stage, v.stages[1].id)
  assert.deepEqual(preview.impact.outcomes[0].after.tags, ['shift-covered'])
  assert.deepEqual(preview.impact.outcomes[0].after.reviewers, ['review@example.test'])
  assert.equal(preview.impact.outcomes[0].scheduling.durationMinutes, 30)
  assert.equal(preview.impact.outcomes[0].scheduling.status, 'scheduled')
  assert.equal(preview.impact.outcomes[1].rules[0].status, 'queued')
  assert.equal(preview.impact.outcomes[1].after.stage, v.stages[0].id)
  assert.equal(preview.impact.approval.approver, 'approve@example.test')
  assert.deepEqual([preview.impact.productionContact, preview.impact.productionSignatures, preview.impact.productionHrRecords], [0, 0, 0])
  const deploy = token => ({ id: box.id, token, confirmProduction: true })
  assert.equal((await refused(h, 'sandbox-deploy', deploy('unreviewed'))).status, 409)
  assert.equal((await refused(h, 'sandbox-deploy', { ...deploy(preview.token), confirmProduction: false })).status, 400)
  await cmd('interview-kit', { id: v.id, item: v.plan[0].id, purpose: 'Updated source kit', questions: [] })
  assert.equal((await refused(h, 'sandbox-deploy', deploy(preview.token))).status, 409, 'source revision changes invalidate the exact preview')
  preview = await cmd('sandbox-preview', { id: box.id })
  const current = (await h.state()).vacancies.find(x => x.id === v.id)
  const original = { stages: current.stages, rubrics: current.rubrics, plan: current.plan, questions: current.questions, approvalRouting: current.approvalRouting ?? {} }
  await cmd('sandbox-deploy', deploy(preview.token))
  let live = (await h.state()).vacancies.find(x => x.id === v.id)
  assert.equal(live.stages[1].name, 'Shift screen')
  assert.equal(live.plan[0].durationMinutes, 30)
  assert.equal(live.approvalRouting.vacancy, 'approve@example.test')
  assert.equal((await refused(h, 'request-vacancy-approval', { id: v.id, approver: 'owner@example.test' }, h.manager)).status, 409, 'deployed routing governs the real approval request')
  // Exercise all existing approval kinds through their production request/decision doors.
  assert.equal((await refused(h, 'request-message-approval', { id: h.message.id, approver: 'owner@example.test' }, h.manager)).status, 409)
  const routedMessage = await cmd('request-message-approval', { id: h.message.id })
  assert.equal(routedMessage.approver, 'm1@example.test')
  await cmd('decide-approval', { id: routedMessage.id, version: routedMessage.version, decision: 'approved', reason: 'Reviewed the routed exact message' }, h.manager)
  assert.equal((await refused(h, 'request-offer-approval', { id: h.offer.id, approver: 'owner@example.test' }, h.manager)).status, 409)
  const routedOffer = await cmd('request-offer-approval', { id: h.offer.id })
  assert.equal(routedOffer.approver, 'approve@example.test')
  await cmd('decide-approval', { id: routedOffer.id, version: routedOffer.version, decision: 'approved', reason: 'Reviewed the routed exact offer' }, h.approver)
  const template = await cmd('offer-template', { name: 'Document route precedes workflow default', body: '{{candidateName}}: {{title}}, {{pay}}', normalApprover: 'owner@example.test', exceptionApprover: 'owner@example.test', reviewed: true })
  await cmd('offer', { ...h.offer, id: h.offer.id, application: h.app.id, offerTemplate: { id: template.id, version: 1 } }, h.manager)
  assert.equal((await refused(h, 'request-offer-approval', { id: h.offer.id, approver: 'approve@example.test' }, h.manager)).status, 409)
  const documentApproval = await cmd('request-offer-approval', { id: h.offer.id }, h.manager)
  assert.equal(documentApproval.approver, 'owner@example.test', 'the exact document route cannot be overridden by the workflow default')
  await cmd('decide-approval', { id: documentApproval.id, version: documentApproval.version, decision: 'approved', reason: 'Reviewed document-bound approval route' })
  await cmd('sandbox-rollback', { id: box.id })
  live = (await h.state()).vacancies.find(x => x.id === v.id)
  assert.deepEqual({ stages: live.stages, rubrics: live.rubrics, plan: live.plan, questions: live.questions, approvalRouting: live.approvalRouting ?? {} }, original)
  assert.equal((await h.state()).screeningRules.filter(r => r.vacancy === v.id).length, 0)
  const historical = await cmd('sandbox-create', { name: 'Historical selection', vacancy: v.id, mode: 'historical', samples: [{ application: h.app.id }] }, h.manager)
  const historyBefore = await durableHiring(h)
  await cmd('sandbox-preview', { id: historical.id }, h.manager)
  assert.deepEqual(await durableHiring(h), historyBefore)
  assert.equal((await refused(h, 'sandbox-create', { name: 'Wrong history', vacancy: v.id, mode: 'historical', samples: [{ application: 'hidden-or-missing' }] }, h.manager)).status, 404)
  const level = await cmd('permission-level', { name: 'No workflow settings', permissions: [] })
  await cmd('job-levels', { id: v.id, members: { 'm1@example.test': level.id } })
  assert.equal((await refused(h, 'sandbox-preview', { id: historical.id }, h.manager)).status, 403)
  assert.equal((await h.state(h.manager)).sandboxes.length, 0)
  await cmd('job-levels', { id: v.id, members: {} })

  const setup = { enabled: true, plan: 'Employer-confirmed production package', volume: 1000, unitPriceUsd: '0.0083', monthlyBaseUsd: '12.00', oneTimeUsd: '4.00', priceBasis: 'Employer agreement reviewed 2026-10-20', planConfirmed: false, appConfirmed: true, legalConfirmed: true }
  assert.equal((await refused(h, 'provider-setup', { ...setup, provider: 'twilio' }, h.manager)).status, 403)
  for (const [provider, volume, price] of [['twilio', 1000, '0.0083'], ['acrobat-sign', 20, '2.25'], ['checkr', 5, '35.99']]) await cmd('provider-setup', { ...setup, provider, volume, unitPriceUsd: price })
  let summary = (await h.state()).providerSetup
  assert.equal(summary.lines.length, 3)
  assert.equal(summary.lines.find(p => p.id === 'twilio').setup.monthlyCents, 2030, 'sub-cent SMS rate is multiplied before rounding to exact cents')
  assert.equal(summary.totalMonthlyCents, 26925)
  const missing = await refused(h, 'provider-review', { provider: 'twilio', version: summary.catalog.find(p => p.id === 'twilio').version })
  assert.equal(missing.status, 409); assert.match(missing.value.error, /Twilio SMS.*missing employer confirmation.*plan/)
  const connected = await cmd('sandbox-create', { ...create, name: 'Explicit connector configuration' })
  await cmd('sandbox-edit', { id: connected.id, edits: [{ op: 'workflow-connectors', input: { connectors: ['twilio'] } }] })
  const connectorPreview = await cmd('sandbox-preview', { id: connected.id })
  const deniedActivation = await refused(h, 'sandbox-deploy', { id: connected.id, token: connectorPreview.token, confirmProduction: true })
  assert.equal(deniedActivation.status, 409); assert.match(deniedActivation.value.error, /Twilio SMS.*missing employer confirmation.*plan/)
  await cmd('provider-setup', { ...setup, provider: 'twilio', planConfirmed: true })
  summary = (await h.state()).providerSetup
  await cmd('provider-review', { provider: 'twilio', version: summary.catalog.find(p => p.id === 'twilio').version })
  assert.equal((await refused(h, 'sandbox-deploy', { id: connected.id, token: connectorPreview.token, confirmProduction: true })).status, 409, 'provider setup revisions also invalidate activation preview')
  const confirmedPreview = await cmd('sandbox-preview', { id: connected.id })
  await cmd('sandbox-deploy', { id: connected.id, token: confirmedPreview.token, confirmProduction: true })
  assert.deepEqual((await h.state()).vacancies.find(vacancy => vacancy.id === v.id).workflowConnectors, ['twilio'])
  await cmd('sandbox-rollback', { id: connected.id })
  await cmd('provider-setup', { provider: 'twilio', enabled: false })
  summary = (await h.state()).providerSetup
  assert.equal(summary.lines.some(p => p.id === 'twilio'), false)
  assert.equal(summary.totalMonthlyCents, 24895)
  assert.ok(summary.catalog.every(p => p.connection.includes('unavailable')), 'review never pretends to connect a missing provider')
}

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

// Uses the same production configuration doors as the workflow sandbox.
export async function reviewStatusTiming(h, timing, eventAt, expected) {
  const cmd = h.command
  const reviewer = await h.member('status-timing-admin@example.test', ['admin'])
  await cmd('unpublish', { id: h.job.id, reason: 'Review delayed status timing' })
  const box = await cmd('sandbox-create', { name: 'Timing trial', vacancy: h.job.id, mode: 'historical', samples: [{ application: h.timingApplication, eventAt }] })
  await cmd('sandbox-edit', { id: box.id, edits: [{ op: 'application-email-timing', input: { timing } }] })
  let preview = await cmd('sandbox-preview', { id: box.id })
  assert.equal(preview.impact.outcomes[0].statusEmail.dueAt, expected)
  assert.equal(preview.impact.outcomes[0].statusEmail.productionContact, 0)
  assert.equal((await h.state()).vacancies.find(v => v.id === h.job.id).applicationEmailTiming, undefined)
  const deploy = token => ({ id: box.id, token, confirmProduction: true })
  await h.policy(false)
  await cmd('sandbox-deploy', deploy(preview.token), h.owner, 409)
  preview = await cmd('sandbox-preview', { id: box.id })
  await cmd('sandbox-deploy', deploy(preview.token))
  assert.deepEqual((await h.state()).vacancies.find(v => v.id === h.job.id).applicationEmailTiming, timing)
  await cmd('sandbox-rollback', { id: box.id })
  assert.equal((await h.state()).vacancies.find(v => v.id === h.job.id).applicationEmailTiming, null)
  preview = await cmd('sandbox-preview', { id: box.id })
  await cmd('sandbox-deploy', deploy(preview.token), reviewer)
  assert.deepEqual((await h.state()).vacancies.find(v => v.id === h.job.id).applicationEmailTiming, timing)
  assert.equal((await h.state()).vacancies.find(v => v.id === h.job.id).applicationEmailTimingBy, 'status-timing-admin@example.test')
  await cmd('publish', { id: h.job.id })
}
