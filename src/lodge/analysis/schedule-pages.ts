import { Hono, type Context } from 'hono'
import type { Bindings } from '../../auth.server'
import { actorFor, load, save, signedIn } from '../core/store'
import { Fault, requireThat, type Data } from '../core/types'
import { esc, formBody, page, sameOrigin } from '../http/public'
import { analysisScope } from './scope'
import { reopenChart } from './saved'
import { cancelSchedule, enableSchedule, ownSchedules, scheduleAccess, schedulePreview } from './schedules'
import { scheduleNewDocument, schedulesDocument } from './schedule-render'

type C = Context<{ Bindings: Bindings }>
const json = (c: C) => c.req.path.startsWith('/api/lodge/analysis')
export const schedulePages = new Hono<{ Bindings: Bindings }>()
schedulePages.use('*', async (c, next) => { await next(); c.header('cache-control', 'no-store'); c.header('referrer-policy', 'same-origin') })
schedulePages.onError((error, c) => {
  const fault = error instanceof Fault ? error : new Fault(503, 'Scheduled chart delivery is unavailable; no new delivery was enabled')
  return json(c) ? Response.json({ error: fault.message }, { status: fault.status }) : page('Scheduled chart delivery', `<h1>Scheduled chart delivery</h1><p role="alert">${esc(fault.message)}</p><p><a href="/analysis/schedules">My scheduled deliveries</a> · <a href="/analysis">Recruiting analysis</a></p>`, fault.status)
})
async function native(c: C) {
  const session = await signedIn(c.req.raw, c.env), s = await load(c.env.DB), a = actorFor(session, s)
  scheduleAccess(a)
  return { s, a }
}
async function body(c: C): Promise<Data> {
  requireThat(Number(c.req.header('content-length') ?? 0) <= 8192, 'Schedule request is too large', 413)
  let value: unknown
  if (json(c)) {
    try { value = await c.req.json() } catch { throw new Fault(400, 'Send a JSON schedule request') }
  } else {
    const form = await formBody(c)
    value = { ...Object.fromEntries(form.entries()), reviewed: form.get('reviewed') === 'yes', enabled: form.get('enabled') === 'yes' }
  }
  requireThat(value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(value).length <= 8192, 'Send a bounded schedule object')
  const fields = ['chart', 'dueAt', 'reviewKey', 'reviewed', 'enabled']
  requireThat(Object.keys(value).every(k => fields.includes(k)), 'Only an owned chart, future time and explicit review are accepted')
  return value as Data
}
schedulePages.get('/analysis/schedules/new', async c => {
  const { s, a } = await native(c), scope = await analysisScope(s, a, c.env)
  return scheduleNewDocument(reopenChart(s, a, scope, c.req.query('chart') ?? ''))
})
async function preview(c: C) {
  await sameOrigin(c)
  const { s, a } = await native(c), draft = await schedulePreview(c.env, s, a, await body(c))
  return json(c) ? Response.json(draft) : scheduleNewDocument({ id: draft.preview.chart, title: draft.preview.title }, draft)
}
async function enable(c: C) {
  await sameOrigin(c)
  const { s, a } = await native(c), schedule = await enableSchedule(c.env, s, a, await body(c))
  await save(c.env.DB, s, a)
  return json(c) ? Response.json({ schedule }, { status: 201 }) : c.redirect('/analysis/schedules', 303)
}
async function list(c: C) {
  const { s, a } = await native(c), schedules = ownSchedules(s, a)
  return json(c) ? Response.json({ schedules }) : schedulesDocument(schedules)
}
async function cancel(c: C) {
  await sameOrigin(c)
  const { s, a } = await native(c), schedule = cancelSchedule(s, a, c.req.param('id') ?? '')
  await save(c.env.DB, s, a)
  return json(c) ? Response.json({ schedule }) : c.redirect('/analysis/schedules', 303)
}
for (const prefix of ['/analysis/schedules', '/api/lodge/analysis/schedules']) {
  schedulePages.get(prefix, list)
  schedulePages.post(prefix + '/preview', preview)
  schedulePages.post(prefix, enable)
  schedulePages.post(prefix + '/:id/cancel', cancel)
}
