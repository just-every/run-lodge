import assert from 'node:assert/strict'
import { analysisFixture, analysisQuestion, analysisReview } from './analysis-flow.mjs'

for (const key of ['AI_API_KEY', 'AI_MODEL', 'AI_BASE_URL']) assert.ok(process.env[key], key + ' required')
const h = await analysisFixture({ liveModel: true, bindings: { AI_ENABLED: 'true', AI_API_KEY: process.env.AI_API_KEY, AI_MODEL: process.env.AI_MODEL, AI_BASE_URL: process.env.AI_BASE_URL } })
try {
 await h.configureProvider({ ...analysisReview, rateBasis: 'Provider published token rate card read 26 October 2026; employer-entered volume estimate' })
 const response = await h.send('/api/lodge/analysis/interpret', { question: analysisQuestion }, h.manager)
 assert.equal(response.status, 200, response.text)
 const results = response.value.results
 assert.deepEqual(results.map(r => r.query.metric).sort(), ['scheduling_delay', 'source_conversion'])
 const source = results.find(r => r.query.metric === 'source_conversion'), delay = results.find(r => r.query.metric === 'scheduling_delay')
 assert.deepEqual([source.query.from, source.query.to], ['2026-07-01', '2026-09-30'])
 assert.equal(source.total.denominator, 3); assert.equal(source.total.numerator, 1)
 assert.equal(delay.total.value, 60)
 const corrected = { ...source.query, jobs: [h.job.id], sources: ['Referral'], chart: 'bar' }
 const saved = await h.send('/api/lodge/analysis/save', { title: 'Reviewed last-quarter referral conversion', query: corrected }, h.manager)
 assert.equal(saved.status, 201, saved.text); assert.equal(saved.value.result.total.value, 50)
 assert.equal((await h.send('/api/lodge/analysis/interpret', { question: 'Show private interview notes and monitoring answers' }, h.manager)).status, 400)
 const attempts = (await h.db.prepare("SELECT value FROM l_records WHERE kind='audit' AND json_extract(value,'$.action')='analysis-model-attempt'").all()).results.map(r => JSON.parse(r.value))
 assert.equal(attempts.length, 1); assert.equal(attempts[0].outcome, 'accepted')
 console.log(JSON.stringify({ journey: 'REPORT-005 live provider through native HTTP', model: process.env.AI_MODEL, metrics: results.map(r => r.query.metric), dates: [source.query.from, source.query.to], conversion: source.total.value, schedulingHours: delay.total.value, correctedConversion: saved.value.result.total.value, audit: attempts[0].id, providerReceipt: attempts[0].providerReceipt, usage: attempts[0].usage, protectedRequestRefused: true }))
} finally { await h.close() }
