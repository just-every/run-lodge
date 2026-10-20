import { blindFor, blindResult } from '../core/blind'
import { Hono, type Context } from 'hono'
import type { Bindings } from '../../auth.server'
import { runtimeBindings } from '../../auth.server'
import { actorFor, load, readBlob, save, signedIn } from '../core/store'
import { can, canSeeApplication, isAdmin, managesVacancy, onPanel, requireApplication, requireDocument } from '../core/access'
import { Fault, requireThat, type Actor, type Data } from '../core/types'
import type { State } from '../core/state'
import { run } from '../commands'
import { invite } from '../core/invitation'
import { workspace, workspaceRecords } from '../views/workspace'
import { search, talentPool } from '../views/search'
import { candidateActivity, candidateExport, vacancyHistory } from '../views/exports'
import { calendarFile } from '../records/interviews'
import { emlFile } from '../records/messages'
import { handoff, packet } from '../views/offer-exports'
import { approvedNow } from '../records/approvals'
import { kitView } from '../views/kits'
import { board } from '../views/board'
import { home } from '../views/home'
import { openingsReport } from '../views/openings-report'
import { rejectionsReport } from '../views/rejections-report'
import { sourcesReport } from '../views/sources-report'
import { auditQuery, auditTrail } from '../views/audit'
import { deleteCandidate } from '../records/retention'
import { erasureTransfers } from '../records/erasure-transfers'
import { retentionUntil } from '../records/candidates'
import { importJobs, imports } from '../move-in/imports'
import { deploymentHealth } from '../../base/deployment-health'
import { requireIntake } from '../resumes/intake'
import { boardApi } from './board'

// Lodge's private HTTP surface. The app and an owner's coding agent use the
// same routes (see API.md); each request resolves the person from the native
// session and saved membership, and every write is fenced in one D1 batch.

type C = Context<{ Bindings: Bindings }>
export const api = new Hono<{ Bindings: Bindings }>()

// The readiness check rer, setup and deploy use.
api.get('/health', c => c.json({ status: 'ok', ...deploymentHealth(c.env) }))

api.use('/api/lodge/*', async (c, next) => {
  await next()
  c.header('cache-control', 'no-store'); c.header('x-content-type-options', 'nosniff'); c.header('referrer-policy', 'no-referrer')
})
// ATTR-009: the public job board answers under /api/board with its own errors and CORS.
api.route('/api/board', boardApi)

api.onError((error, c) => {
  if (error instanceof Fault) return c.json({ error: error.message }, error.status as 400)
  console.error('lodge request failed', (error as Error)?.name)
  return c.json({ error: 'Something went wrong; nothing was saved' }, 500)
})

/** Routes that change records outside a proposal are for people, not agent members. */
const person = (a: Actor) => requireThat(!a.agent, 'Agent members propose changes; a person approves and applies them', 403)

async function context(c: C) {
  const session = await signedIn(c.req.raw, c.env)
  const state = await load(c.env.DB)
  const actor = actorFor(session, state)
  return { state, actor }
}

async function body(c: C, limit = 1_600_000): Promise<Data> {
  requireThat(Number(c.req.header('content-length') ?? 0) <= limit, 'Request too large', 413)
  const text = await c.req.text()
  requireThat(text.length <= limit, 'Request too large', 413)
  try { const value = JSON.parse(text); requireThat(value && typeof value === 'object' && !Array.isArray(value), 'Send a JSON object'); return value } catch (e) { if (e instanceof Fault) throw e; throw new Fault(400, 'Send a JSON object') }
}

const attachment = (content: BodyInit, type: string, name: string) => new Response(content, { headers: { 'content-type': type, 'content-disposition': `attachment; filename="${name.replace(/[^\w.-]+/g, '_')}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } })
const json = (value: unknown, name: string) => attachment(JSON.stringify(value, null, 2), 'application/json; charset=utf-8', name)

api.get('/api/lodge/state', async c => {
  const { state, actor } = await context(c)
  return c.json({ ...await workspace(state, actor), importJobs: await importJobs(c.env.DB, actor, state) })
})

api.post('/api/lodge/command/:op', async c => {
  const { state, actor } = await context(c)
  const result = await run(state, actor, c.req.param('op'), await body(c))
  await save(c.env.DB, state, actor)
  return c.json(blindResult(state, actor, result))
})

api.get('/api/lodge/search', async c => {
  const { state, actor } = await context(c)
  return c.json({ results: search(await workspace(state, actor), c.req.query('q')) })
})

api.get('/api/lodge/kit/:id', async c => {
  const { state, actor } = await context(c)
  return c.json(kitView(await workspace(state, actor), c.req.param('id')))
})

api.get('/api/lodge/home', async c => {
  const { state, actor } = await context(c)
  return c.json(home(await workspaceRecords(state, actor)))
})

api.get('/api/lodge/board/:vacancy', async c => {
  const { state, actor } = await context(c)
  const view = board(await workspaceRecords(state, actor), c.req.param('vacancy'))
  requireThat(view, 'Vacancy not found', 404)
  return c.json(view)
})

api.get('/api/lodge/reports/interviewers', async c => {
  const { state, actor } = await context(c)
  const report = (await workspace(state, actor)).interviewerActivity
  requireThat(report, 'Only admins and hiring managers see interviewer activity', 403)
  return c.json(report)
})

api.get('/api/lodge/reports/openings', async c => {
  const { state, actor } = await context(c)
  const report = openingsReport(state, actor, await workspaceRecords(state, actor), { department: c.req.query('department') || undefined, office: c.req.query('office') || undefined })
  requireThat(report, 'Only admins and hiring managers see openings and funnels', 403)
  return c.json(report)
})

api.get('/api/lodge/reports/rejections', async c => {
  const { state, actor } = await context(c)
  const report = rejectionsReport(state, actor, await workspaceRecords(state, actor))
  requireThat(report, 'Only admins and hiring managers see rejection reasons', 403)
  return c.json(report)
})

api.get('/api/lodge/reports/sources', async c => {
  const { state, actor } = await context(c)
  const report = sourcesReport(state, actor, await workspaceRecords(state, actor))
  requireThat(report, 'Only admins and hiring managers see sources of hire', 403)
  return c.json(report)
})

api.get('/api/lodge/reports/events', async c => {
  const { state, actor } = await context(c)
  return c.json({ events: (await workspaceRecords(state, actor)).events.map(e => ({ id: e.id, name: e.name, kind: e.kind, date: e.date, location: e.location, owner: e.owner, jobs: e.jobs, ...e.report })) })
})

api.get('/api/lodge/audit', async c => {
  const { state, actor } = await context(c)
  return c.json(auditTrail(state, actor, auditQuery(c.req.query())))
})

api.get('/api/lodge/talent', async c => {
  const { state, actor } = await context(c)
  return c.json({ matches: talentPool(state, actor, c.req.query('q')) })
})

api.post('/api/lodge/invite', async c => {
  const { state, actor } = await context(c)
  // Lodge invites through Base, which lets only the owner invite.
  requireThat(actor.owner, 'Only the owner can invite people to sign in', 403); person(actor)
  const b = await body(c), member = state.get('member', String(b.email ?? '').toLowerCase())
  requireThat(member.active && !member.owner, 'Invite an active member', 409)
  // OPS-001: each provider attempt is audited as handed to the mail provider or failed, never as delivered.
  const provider = c.env.MAIL_PROVIDER ?? 'not configured'
  try {
    const result = await invite(c.req.raw, c.env, state, actor, member)
    state.audit(actor, 'invitation-handed-to-mail-provider', 'member:' + member.email, { provider, outcome: result?.status ?? 'accepted' })
    return recorded(c, state, actor, c.json(result))
  } catch (error) {
    const failed = await load(c.env.DB)
    failed.audit(actor, 'invitation-failed', 'member:' + member.email, { provider, error: error instanceof Fault ? error.message : 'Mail provider error' })
    try { await save(c.env.DB, failed, actor) } finally { throw error }
  }
})

api.post('/api/lodge/import/:op', async c => {
  const { state, actor } = await context(c)
  // Refuse before reading a body of up to 30 MB.
  requireThat(actor.owner, 'Only the owner moves data in', 403)
  const op = c.req.param('op'), input = await body(c, 30_000_000)
  const result = await imports(c.env.DB, actor, op, input, retentionUntil(state))
  if (['commit', 'undo', 'resume'].includes(op)) {
    const after = await load(c.env.DB)
    // The commit names its package, so the batch list can show it.
    after.audit(actor, 'import-' + op, 'import:' + (result as Data).job?.id, op === 'commit' ? { package: input.filename } : {})
    await save(c.env.DB, after, actor)
  }
  return c.json(result)
})

api.post('/api/lodge/delete-candidate', async c => {
  const { state, actor } = await context(c)
  person(actor)
  const receipt = deleteCandidate(state, actor, await body(c))
  await save(c.env.DB, state, actor, await erasureTransfers(c.env.DB))
  return c.json(receipt)
})

/** Downloads that change nothing still save their audit entry, fenced like any write. */
async function recorded(c: C, state: State, actor: Actor, response: Response) {
  await save(c.env.DB, state, actor)
  return response
}

async function documentResponse(c: C, viewing: boolean) {
  const { state, actor } = await context(c)
  const doc = (await workspace(state, actor)).documents.find(d => d.id === c.req.param('id'))
  requireThat(doc, 'Document not found', 404)
  requireDocument(state, actor, doc.id)
  if (viewing && c.req.query('access') === '1') return c.body(null, 204)
  const bytes = await readBlob(c.env.DB, doc.id)
  requireThat(bytes, 'The file bytes are missing', 404)
  state.audit(actor, viewing ? 'document-viewed' : 'document-downloaded', 'document:' + doc.id, viewing ? { restricted: doc.restricted } : {})
  const raw = atob(bytes.base64), data = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) data[i] = raw.charCodeAt(i)
  return recorded(c, state, actor, attachment(data, doc.mediaType, doc.name))
}

api.get('/api/lodge/download/resume-intake/:id', async c => {
  const { state, actor } = await context(c)
  const intake = requireIntake(state, actor, c.req.param('id'))
  const file = intake.status === 'committed' ? requireDocument(state, actor, intake.id) : intake
  const blob = await readBlob(c.env.DB, intake.id)
  requireThat(blob, 'The original bytes are missing', 404)
  state.audit(actor, 'resume-original-downloaded', intake.candidate ? 'candidate:' + intake.candidate : 'resume-intake:' + intake.id)
  const raw = atob(blob.base64), bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return recorded(c, state, actor, attachment(bytes, file.mediaType, file.name))
})

api.get('/api/lodge/download/document/:id', c => documentResponse(c, false))
api.get('/api/lodge/view/document/:id', c => documentResponse(c, true))

// OFFER-001: a prepared unsent document is released only on the exact approved terms.
api.get('/api/lodge/download/prepared-offer/:id', async c => {
  const { state, actor } = await context(c)
  person(actor)
  const offer = (await workspace(state, actor)).offers.find(o => o.id === c.req.param('id'))
  requireThat(offer?.document, 'Prepared offer document not found', 404)
  requireThat(!blindFor(state, actor, state.get('application', offer.application)), 'Prepared offer document not found', 404)
  const stored = state.get('offer', offer.id)
  requireThat(await approvedNow(state, 'offer', stored), 'The offer document needs current approval before release; nothing was sent', 409)
  state.audit(actor, 'unsent-offer-document-downloaded', 'offer:' + offer.id, { sha256: offer.document.sha256, sent: false })
  return recorded(c, state, actor, attachment(offer.document.text, 'text/plain; charset=utf-8', 'prepared-unsent-offer.txt'))
})

api.get('/api/lodge/download/calendar/:id', async c => {
  const { state, actor } = await context(c)
  const view = await workspace(state, actor)
  const iv = view.interviews.find(i => i.id === c.req.param('id'))
  requireThat(iv, 'Interview not found', 404)
  const app = requireApplication(state, actor, iv.application)
  requireThat(onPanel(actor, iv) || managesVacancy(actor, state.get('vacancy', app.vacancy)), 'Interview not found', 404)
  const projected = view.applications.find(x => x.id === app.id)!
  const candidate = view.candidates.find(c => c.id === projected.candidate)!
  return attachment(calendarFile(iv, candidate.name, runtimeBindings(c.env).AUTH_ORIGIN), 'text/calendar; charset=utf-8', 'interview.ics')
})

api.get('/api/lodge/download/message/:id', async c => {
  const { state, actor } = await context(c)
  person(actor)
  const m = (await workspace(state, actor)).messages.find(m => m.id === c.req.param('id'))
  requireThat(m, 'Message not found', 404)
  state.get('message', m.id)
  const app = requireApplication(state, actor, m.application)
  requireThat(!blindFor(state, actor, app), 'Message not found', 404)
  const business = state.get('business', 'main')
  const vacancy = state.get('vacancy', app.vacancy)
  const eml = await emlFile(state, actor, state.get('message', m.id), `${business.name} <${vacancy.manager}>`)
  return recorded(c, state, actor, attachment(eml, 'message/rfc822', `message-${m.id.slice(0, 8)}.eml`))
})

api.get('/api/lodge/download/packet/:id', async c => {
  const { state, actor } = await context(c)
  return json(await packet(state, await workspace(state, actor), c.req.param('id')), 'offer-approval-packet.json')
})

api.get('/api/lodge/download/audit', async c => {
  const { state, actor } = await context(c)
  const trail = auditTrail(state, actor, auditQuery(c.req.query()))
  // The export is itself an event, recorded after the events it contains.
  state.audit(actor, 'audit-exported', 'audit:export', { period: trail.period, filters: trail.filters, events: trail.total })
  const name = `lodge-audit-${trail.period.from ?? 'start'}-to-${trail.period.to ?? 'now'}.json`
  return recorded(c, state, actor, json({ exportedAt: new Date().toISOString(), exportedBy: actor.email, ...trail }, name))
})

api.get('/api/lodge/download/handoff/:id', async c => {
  const { state, actor } = await context(c)
  const result = handoff(await workspace(state, actor), c.req.param('id'))
  state.audit(actor, 'handoff-exported', 'offer:' + c.req.param('id'))
  return recorded(c, state, actor, json(result, 'hr-handoff.json'))
})

api.get('/api/lodge/download/vacancy/:id', async c => {
  const { state, actor } = await context(c)
  const result = vacancyHistory(await workspace(state, actor), c.req.param('id'))
  state.audit(actor, 'vacancy-exported', 'vacancy:' + c.req.param('id'))
  return recorded(c, state, actor, json(result, 'vacancy-history.json'))
})

api.get('/api/lodge/download/activity/:id', async c => {
  const { state, actor } = await context(c)
  const result = candidateActivity(await workspace(state, actor), c.req.param('id'))
  // OPS-004: a level without "export" on every job through which the reader sees the candidate refuses the download.
  const through = state.all('application').filter(app => app.candidate === c.req.param('id') && canSeeApplication(state, actor, app))
  requireThat(isAdmin(actor) || !through.length || through.some(app => can(state, actor, state.get('vacancy', app.vacancy), 'export')), 'Your permission level does not let you export this candidate', 403)
  state.audit(actor, 'activity-exported', 'candidate:' + c.req.param('id'))
  return recorded(c, state, actor, json(result, 'candidate-activity.json'))
})

api.get('/api/lodge/download/candidate/:id', async c => {
  const { state, actor } = await context(c)
  if (c.req.query('request')) person(actor)
  const { body: result } = await candidateExport(c.env.DB, state, actor, c.req.param('id'), c.req.query('request') || undefined)
  return recorded(c, state, actor, json(result, 'candidate-export.json'))
})
