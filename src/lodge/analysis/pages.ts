import { Hono, type Context } from 'hono'
import type { Bindings } from '../../auth.server'
import { actorFor, load, save, signedIn } from '../core/store'
import { Fault, requireThat, type Data } from '../core/types'
import { esc, formBody, page, sameOrigin } from '../http/public'
import { analysisScope } from './scope'
import { execute } from './execute'
import { safeQuestion, requireProvider, interpret, safeProviderError, auditAttempt, providerStatus, providerTuple, reviewDraft, enableProvider, type Usage } from './provider'
import { validatePlan, validateQuery } from './query'
import { reopenChart, savedCharts, saveChart } from './saved'
import { analysisDocument } from './render'
import { providerPublicReview, setupAccess, setupDocument } from './setup'

type C = Context<{ Bindings: Bindings }>
const envRecord = (env: Bindings) => env as unknown as Record<string, unknown>
const json = (c: C) => c.req.path.startsWith('/api/lodge/analysis')
export const analysisPages = new Hono<{ Bindings: Bindings }>()
analysisPages.use('*', async (c, next) => { await next(); c.header('cache-control', 'no-store'); c.header('referrer-policy', 'same-origin') })
analysisPages.onError((error, c) => {
  const fault = error instanceof Fault ? error : new Fault(500, 'Analysis could not be completed. No chart was saved.')
  return json(c) ? Response.json({ error: fault.message }, { status: fault.status }) : page('Recruiting analysis', `<h1>Recruiting analysis</h1><p role="alert">${esc(fault.message)}</p><p><a href="/analysis">Back to analysis</a> · <a href="/analysis/setup">Provider setup</a></p>`, fault.status)
})
async function native(c: C) {
  const session = await signedIn(c.req.raw, c.env), s = await load(c.env.DB), a = actorFor(session, s)
  requireThat(!a.agent, 'A native operator must review recruiting analysis', 403)
  return { s, a }
}
async function staff(c: C) {
  const { s, a } = await native(c), scope = await analysisScope(s, a, c.env)
  return { s, a, scope }
}
async function body(c: C): Promise<Data> {
  requireThat(Number(c.req.header('content-length') ?? 0) <= 32768, 'Analysis request is too large', 413)
  if (json(c)) {
    let value: unknown
    try { value = await c.req.json() } catch { throw new Fault(400, 'Send a JSON analysis request') }
    requireThat(!!value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(value).length <= 32768, 'Send a bounded analysis object')
    return value as Data
  }
  const form = await formBody(c), value: Data = Object.fromEntries(form.entries())
  value.jobs = form.getAll('jobs').map(String)
  value.sources = form.getAll('sources').map(String)
  for (const key of ['employerPlan', 'appAccess', 'legalReviewed', 'reviewed', 'enabled']) value[key] = form.get(key) === 'yes'
  return value
}
function queryBody(c: C, value: Data) {
  if (json(c)) return value.query
  const { metric, from, to, jobs, sources, groupBy, chart } = value
  return { metric, from, to, jobs, sources, groupBy, chart }
}
function document(c: C, current: Awaited<ReturnType<typeof staff>>, results: ReturnType<typeof execute>[] = [], extra: Parameters<typeof analysisDocument>[4] = {}) {
  return analysisDocument(current.scope, savedCharts(current.s, current.a), providerStatus(current.s, envRecord(c.env)), results, extra)
}
analysisPages.get('/analysis', async c => document(c, await staff(c)))
analysisPages.get('/api/lodge/analysis', async c => {
  const { s, a, scope } = await staff(c)
  return Response.json({ dates: scope.dates, metrics: ['source_conversion', 'scheduling_delay', 'stage_moves', 'offer_outcomes'], jobs: scope.jobs.map(j => ({ id: j.id, title: j.title, offers: j.offers })), sources: scope.sources, saved: savedCharts(s, a), providerReady: providerStatus(s, envRecord(c.env)).ready })
})
async function ask(c: C) {
  await sameOrigin(c)
  const initial = await staff(c), value = await body(c), question = safeQuestion(value.question)
  requireProvider(initial.s, envRecord(c.env))
  let usage: Usage | null = null, outcome: 'accepted' | 'refused' | 'failed' = 'failed', plan: unknown, failure: Fault | undefined, providerReceipt: string | undefined
  try { plan = await interpret(envRecord(c.env), initial.scope, question, (value, receipt) => { usage = value; providerReceipt = receipt }) }
  catch (error) { failure = safeProviderError(error) }
  // A paid request may outlive a membership or job change. Re-read current native authority before returning evidence.
  const current = await staff(c)
  let queries: ReturnType<typeof validatePlan> = []
  if (!failure) {
    try { queries = validatePlan(plan, current.scope); outcome = 'accepted' }
    catch (error) { outcome = 'refused'; failure = error instanceof Fault ? error : new Fault(502, 'The provider returned an unsupported query') }
  }
  auditAttempt(current.s, current.a, envRecord(c.env), outcome, usage, providerReceipt)
  await save(c.env.DB, current.s, current.a)
  if (failure) throw failure
  const results = queries.map(q => execute(current.scope, q))
  return json(c) ? Response.json({ results }) : document(c, current, results)
}
async function preview(c: C) {
  await sameOrigin(c)
  const current = await staff(c), value = await body(c), query = validateQuery(queryBody(c, value), current.scope), result = execute(current.scope, query)
  return json(c) ? Response.json({ result }) : document(c, current, [result])
}
async function persist(c: C) {
  await sameOrigin(c)
  const current = await staff(c), value = await body(c), query = validateQuery(queryBody(c, value), current.scope)
  const result = execute(current.scope, query), chart = saveChart(current.s, current.a, current.scope, value.title, query)
  await save(c.env.DB, current.s, current.a)
  return json(c) ? Response.json({ chart, result }, { status: 201 }) : c.redirect('/analysis/saved/' + encodeURIComponent(chart.id) + '?saved=1', 303)
}
async function reopen(c: C) {
  const current = await staff(c), chart = reopenChart(current.s, current.a, current.scope, c.req.param('id')!), result = execute(current.scope, chart.query)
  return json(c) ? Response.json({ chart, result }) : document(c, current, [result], { title: chart.title, savedId: c.req.query('saved') ? chart.id : undefined })
}
for (const prefix of ['/analysis', '/api/lodge/analysis']) {
  analysisPages.post(prefix + '/interpret', ask)
  analysisPages.post(prefix + '/preview', preview)
  analysisPages.post(prefix + '/save', persist)
  analysisPages.get(prefix + '/saved/:id', reopen)
}

async function setup(c: C) {
  const { s, a } = await native(c); setupAccess(a)
  const status = providerStatus(s, envRecord(c.env))
  return json(c) ? Response.json({ tuple: status.tuple, ready: status.ready, reason: status.reason, review: providerPublicReview(status.review) }) : setupDocument(s, envRecord(c.env), undefined, c.req.query('saved') === '1')
}
async function setupPreview(c: C) {
  await sameOrigin(c)
  const { s, a } = await native(c); setupAccess(a)
  const value = await body(c), draft = reviewDraft(value, providerTuple(envRecord(c.env)))
  return json(c) ? Response.json({ preview: draft }) : setupDocument(s, envRecord(c.env), draft)
}
async function setupSave(c: C) {
  await sameOrigin(c)
  const { s, a } = await native(c); setupAccess(a)
  const review = enableProvider(s, a, envRecord(c.env), await body(c))
  await save(c.env.DB, s, a)
  return json(c) ? Response.json({ review: providerPublicReview(review) }) : c.redirect('/analysis/setup?saved=1', 303)
}
async function setupDisable(c: C) {
  await sameOrigin(c)
  const { s, a } = await native(c); setupAccess(a)
  const review = s.find('analysis-provider', 'main')
  if (review) { s.put('analysis-provider', 'main', { ...review, enabled: false }); s.audit(a, 'analysis-provider-disabled', 'analysis-provider:main') }
  await save(c.env.DB, s, a)
  return json(c) ? Response.json({ enabled: false }) : c.redirect('/analysis/setup?saved=1', 303)
}
for (const prefix of ['/analysis', '/api/lodge/analysis']) {
  analysisPages.get(prefix + '/setup', setup)
  analysisPages.post(prefix + '/setup/preview', setupPreview)
  analysisPages.post(prefix + '/setup', setupSave)
  analysisPages.post(prefix + '/setup/disable', setupDisable)
}
