import assert from 'node:assert/strict'

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
