import { Hono, type Context } from 'hono'
import type { Bindings } from '../../auth.server'
import { actorFor, load, signedIn } from '../core/store'
import { can, canSeeApplication, canSeeContact, cleared } from '../core/access'
import { blindFor } from '../core/blind'
import { requireThat, type Data } from '../core/types'
import { credentialList, integrationContext, manageCredential, requireManagement } from '../integrations/credentials'

type C = Context<{ Bindings: Bindings }>

export const integrationManagement = new Hono<{ Bindings: Bindings }>()
integrationManagement.get('/', async c => {
  const session = await signedIn(c.req.raw, c.env), state = await load(c.env.DB), actor = actorFor(session, state)
  requireManagement(actor)
  return c.json({ credentials: await credentialList(c.env.DB, actor), jobs: state.all('vacancy').filter(v => cleared(actor, v, 'confidential') && can(state, actor, v, 'settings')).map(v => ({ id: v.id, title: v.title })) })
})
const manage = async (c: C, id?: string, action?: string) => {
  const session = await signedIn(c.req.raw, c.env), state = await load(c.env.DB), actor = actorFor(session, state)
  requireThat(Number(c.req.header('content-length') ?? 0) <= 16000, 'Request too large', 413)
  const raw = await c.req.text()
  requireThat(raw.length <= 16000, 'Request too large', 413)
  let input: Data
  try { input = JSON.parse(raw) } catch { return c.json({ error: 'Send a JSON object' }, 400) }
  requireThat(input && typeof input === 'object' && !Array.isArray(input), 'Send a JSON object')
  return c.json(await manageCredential(c.env.DB, state, actor, input, id, action))
}
integrationManagement.post('/', c => manage(c))
integrationManagement.post('/:id/rotate', c => manage(c, c.req.param('id'), 'rotate'))
integrationManagement.post('/:id/revoke', c => manage(c, c.req.param('id'), 'revoke'))

export const integrationApi = new Hono<{ Bindings: Bindings }>()
integrationApi.use('*', async (c, next) => {
  await next()
  c.header('cache-control', 'no-store'); c.header('x-content-type-options', 'nosniff'); c.header('referrer-policy', 'no-referrer')
})
const applications = async (c: C, id?: string) => {
  const { state, actor, jobs, fields } = await integrationContext(c.env.DB, c.req.raw)
  const requested = c.req.query('fields')?.split(',') ?? fields
  requireThat(requested.every((f: string) => fields.includes(f)), 'Field scope refused', 403)
  const jobFilter = c.req.query('job')
  requireThat(!jobFilter || jobs.includes(jobFilter), 'Application not found', 404)
  // Bound the record set before looking at any person or projecting any fields.
  const visible = state.all('application').filter(app => jobs.includes(app.vacancy) && (!jobFilter || app.vacancy === jobFilter) && (!id || app.id === id)).filter(app => {
    const job = state.find('vacancy', app.vacancy), person = state.find('candidate', app.candidate)
    return job && cleared(actor, job, 'confidential') && person && !person.deleted && !person.mergedInto && canSeeApplication(state, actor, app)
  })
  requireThat(!id || visible.length, 'Application not found', 404)
  const result = visible.map(app => {
    const job = state.get('vacancy', app.vacancy), candidate = state.get('candidate', app.candidate)
    const blind = blindFor(state, actor, app)
    return { id: app.id, job: app.vacancy, stage: app.stage, status: app.status, submittedAt: app.submittedAt ?? null,
      ...(!blind && requested.includes('identity') ? { candidateName: candidate.name } : {}),
      ...(!blind && requested.includes('contact') && can(state, actor, job, 'contact') && canSeeContact(state, actor, candidate) ? { email: candidate.email ?? null, phone: candidate.phone ?? null } : {}) }
  })
  return c.json(id ? result[0] : { applications: result })
}
integrationApi.get('/applications', c => applications(c))
integrationApi.get('/applications/:id', c => applications(c, c.req.param('id')))
// No write or other resource door is delegated by an app credential.
integrationApi.all('*', c => c.json({ error: 'This application API supports read-only application routes' }, 405))
