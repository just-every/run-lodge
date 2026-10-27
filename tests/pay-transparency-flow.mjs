import assert from 'node:assert/strict'
import { hiringScenario, RANGE, RUBRIC } from './hiring-fixture.mjs'

export async function payFixture(t) {
  const h = await hiringScenario(t)
  const { cmd, owner } = h
  const denver = await cmd('office', { name: 'Denver, CO' }), nyc = await cmd('office', { name: 'New York City, NY' })
  const rules = [
    { place: 'Colorado', reviewedOn: '2026-01-15', rangeRequired: true, benefitsRequired: true, salaryHistoryBan: true },
    { place: 'New York City', reviewedOn: '2026-02-01', rangeRequired: true, benefitsRequired: false, salaryHistoryBan: true },
  ]
  await cmd('pay-rules', { rules })
  const co = { officeId: denver.id, compensation: { currency: 'USD', min: 6000000, max: 8000000, period: 'year' } }
  const ny = { officeId: nyc.id, compensation: { currency: 'USD', min: 7000000, max: 9000000, period: 'year' } }
  let job = await cmd('vacancy', { title: 'Multi-location supervisor', officeId: denver.id, locations: [nyc.id], headcount: 1, compensation: RANGE, payRanges: [co], benefits: 'Health insurance; annual bonus eligibility.', manager: 'morgan@example.test' })
  job = await cmd('rubric', { id: job.id, criteria: RUBRIC })
  job = await cmd('interview-plan', { id: job.id, plan: [{ name: 'Safety review', stage: job.stages[1].id }] })
  const approve = async () => {
    const asked = await cmd('request-vacancy-approval', { id: job.id, approver: 'owner@example.test' })
    await cmd('decide-approval', { id: asked.id, decision: 'approved', reason: 'Exact good-faith location terms reviewed', version: asked.version }, owner)
  }
  return { ...h, denver, nyc, rules, co, ny, job, approve }
}

export async function checkPayTransparency(t) {
  const h = await payFixture(t)
  const { cmd, state, manager, ivy, denver, nyc, rules, co, ny, approve } = h
  const send = (path, body, cookie, extra) => h.send(path, body, cookie ?? (path.startsWith('/api/lodge/') ? h.owner : ''), extra)
  let job = h.job
  await approve()
  const missingRange = await send('/api/lodge/command/publish', { id: job.id })
  assert.equal(missingRange.status, 409)
  assert.match(missingRange.value.error, /pay range for New York City/)
  job = await cmd('vacancy', { ...job, payRanges: [co, ny] })
  assert.equal((await send('/api/lodge/command/publish', { id: job.id })).status, 409, 'location pay changes invalidate approval')
  job = await cmd('vacancy', { ...job, benefits: '' })
  await approve()
  const missingBenefits = await send('/api/lodge/command/publish', { id: job.id })
  assert.equal(missingBenefits.status, 409)
  assert.match(missingBenefits.value.error, /benefits and bonus text for Denver/)
  job = await cmd('vacancy', { ...job, benefits: 'Health insurance; annual bonus eligibility.', payRanges: [co, { ...ny, compensation: { ...ny.compensation, currency: 'EUR' } }] })
  await approve()
  const nonUsd = await send('/api/lodge/command/publish', { id: job.id })
  assert.equal(nonUsd.status, 409)
  assert.match(nonUsd.value.error, /must use USD/)
  job = await cmd('vacancy', { ...job, payRanges: [co, ny] })
  await approve()
  job = await cmd('publish', { id: job.id })
  await cmd('job-board', { token: 'synthetic-lodge-board', allowedOrigins: [] })
  const path = '/api/board/v1/synthetic-lodge-board/jobs/' + job.id
  const board = await send(path)
  assert.equal(board.status, 200)
  assert.deepEqual(board.value.pay, [
    { location: 'Denver, CO', currency: 'USD', min: 6000000, max: 8000000, period: 'year', minorUnits: 2 },
    { location: 'New York City, NY', currency: 'USD', min: 7000000, max: 9000000, period: 'year', minorUnits: 2 },
  ], 'each approved location retains its independently expected range')
  const expectedText = 'Pay for Denver, CO: $60,000–$80,000 a year\nPay for New York City, NY: $70,000–$90,000 a year\nHealth insurance; annual bonus eligibility.'
  assert.equal(board.value.payTransparency, expectedText)
  const page = await send('/jobs/' + job.slug)
  assert.equal(page.status, 200)
  for (const line of expectedText.split('\n')) assert.ok(page.text.includes(line), 'hosted text: ' + line)
  assert.ok(!page.text.includes('$90,000–$110,000'), 'do not show the obsolete job-wide range')
  for (const cookie of [manager, ivy]) assert.equal((await send('/api/lodge/command/pay-rules', { rules: [] }, cookie)).status, 403)
  assert.equal((await send('/api/lodge/command/pay-rules', { rules: [{ ...rules[0], reviewedOn: '' }] })).status, 400)
  await cmd('business', { ...(await state()).business, privacyNotice: (await state()).business.notices.at(-1).text })
  assert.deepEqual((await state()).payRules, rules, 'ordinary business edits retain reviewed rules')
  const salary = await send('/api/lodge/command/question', { text: 'Your current salary?', type: 'number' })
  assert.equal(salary.status, 400)
  assert.match(salary.value.error, /salary-history/)
  const desired = await cmd('question', { text: 'What compensation do you seek?', type: 'number' })
  await cmd('job-questions', { id: job.id, questions: [{ question: desired.id }] })
  assert.match((await send('/jobs/' + job.slug)).text, /What compensation do you seek/)
  job = await cmd('job-post', { vacancy: job.id, title: 'Denver supervisor', locations: [denver.id], destinations: ['careers', 'embed', 'api'], language: 'en' })
  const post = job.posts.at(-1)
  await cmd('post-status', { vacancy: job.id, post: post.id, status: 'live' })
  const postBoard = await send('/api/board/v1/synthetic-lodge-board/jobs/' + post.id)
  assert.deepEqual(postBoard.value.pay, [{ location: 'Denver, CO', currency: 'USD', min: 6000000, max: 8000000, period: 'year', minorUnits: 2 }])
  assert.equal(postBoard.value.payTransparency, 'Pay for Denver, CO: $60,000–$80,000 a year\nHealth insurance; annual bonus eligibility.')
  const postPage = await send('/jobs/' + post.slug)
  assert.ok(postPage.text.includes('$60,000–$80,000'))
  assert.ok(!postPage.text.includes('$70,000–$90,000'))
  const { spanishText } = await import('./languages-driver.mjs')
  job = await cmd('job-post', { vacancy: job.id, title: 'Supervisor de Denver', language: 'es', locations: [denver.id], destinations: ['careers', 'api'], translation: { ...spanishText(desired), questions: { [desired.id]: { text: '¿Qué remuneración busca?', help: '', options: [] } } } })
  const spanish = job.posts.at(-1)
  const untranslated = await send('/api/lodge/command/post-status', { vacancy: job.id, post: spanish.id, status: 'live' })
  assert.equal(untranslated.status, 409)
  assert.match(untranslated.value.error, /benefits and bonus/)
  await cmd('post-translation', { vacancy: job.id, post: spanish.id, translation: { ...spanish.translation, reviewed: true, benefits: 'Seguro médico; posibilidad de bono anual.' } })
  await cmd('post-status', { vacancy: job.id, post: spanish.id, status: 'live' })
  const translated = await send('/api/board/v1/synthetic-lodge-board/jobs/' + spanish.id)
  assert.equal(translated.value.payTransparency, 'Salario: $60,000–$80,000 al año (Denver, CO)\nSeguro médico; posibilidad de bono anual.')
  assert.ok((await send('/jobs/' + spanish.slug)).text.includes('Seguro médico; posibilidad de bono anual.'))
  // Existing live listings are withheld if a newly reviewed rule needs missing content.
  await cmd('unpublish', { id: job.id, reason: 'Remove optional benefits before re-review' })
  job = (await state()).vacancies.find(v => v.id === job.id)
  await cmd('pay-rules', { rules: rules.map(r => ({ ...r, benefitsRequired: false })) })
  job = await cmd('vacancy', { ...job, benefits: '' })
  await approve()
  await cmd('publish', { id: job.id })
  await cmd('pay-rules', { rules })
  assert.equal((await send('/jobs/' + post.slug)).status, 404)
  assert.equal((await send('/api/board/v1/synthetic-lodge-board/jobs/' + post.id)).status, 404)
}
