import { handoffEvidence } from '../agents/handoff-exceptions'
import { candidateUpdatesView } from '../agents/candidate-updates'
import { sourcingEvidence } from '../agents/sourcing'
import { assessmentView } from '../assessments/records'
import { delayAnalysis, delayFeedback } from '../views/delay-analysis'
import { integrationApi, integrationManagement } from './integrations'
import { offlineScorecardContext } from '../records/scorecards'
import { cohortReport } from '../views/cohort-report'
import { referenceExport } from '../references/views'
import { bulkInvitationPreview, bulkInvitationSubmit } from '../operations/bulk-invitations'
import { reminderView } from '../reminders/records'
import { crmView } from '../crm/records'
import { applicationEmailEvents } from '../communications/events'
import { captureAddress, captureList, captureRead, resolveCapture } from '../records/capture'
import { surveyReport } from '../surveys/records'
import { careersDomainChallenge, careersDomainOperation } from '../careers/domain'
import { isEmployeeOnly } from '../core/access'
import { referralsView } from '../referrals/views'
import { referralFile } from '../referrals/access'
import { legacyReport } from '../move-in/legacy-links'
import { portal } from '../agency/views'
import { agencyFile } from '../agency/access'
import { fieldResult } from '../views/fields'
import { savedHiringView } from '../views/field-views'
import { blindFor, blindResult } from '../core/blind'
import { Hono, type Context } from 'hono'
import type { Bindings } from '../../auth.server'
import { runtimeBindings } from '../../auth.server'
import { actorFor, load, readBlob, save, signedIn } from '../core/store'
import { isAgency, can, canSeeApplication, isAdmin, managesVacancy, onPanel, requireApplication, requireDocument } from '../core/access'
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
import { mountEsign } from './esign'
import { flushNotices } from '../esign/mail'

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
// OFFER-005: terms-free void and completion notices queued by this request's own transaction go out after it commits.
api.use('/api/lodge/*', async (c, next) => {
  await next()
  if (c.req.method !== 'GET' && c.res.status < 400) await flushNotices(c.env)
})
// ATTR-009: the public job board answers under /api/board with its own errors and CORS.
api.route('/api/board', boardApi)
api.route('/api/integrations/v1', integrationApi)
api.route('/api/lodge/integrations', integrationManagement)
api.post('/api/lodge/application-emails/events', c => applicationEmailEvents(c.req.raw, c.env))

api.onError((error, c) => {
  if (error instanceof Fault) return c.json({ error: error.message }, error.status as 400)
  console.error('lodge request failed', (error as Error)?.name)
  return c.json({ error: 'Something went wrong; nothing was saved' }, 500)
})

/** Routes that change records outside a proposal are for people, not agent members. */
const person = (a: Actor) => requireThat(!a.agent, 'Agent members propose changes; a person approves and applies them', 403)

async function context(c: C, agencyDoor = false, employeeDoor = false) {
  const session = await signedIn(c.req.raw, c.env)
  const state = await load(c.env.DB)
  const actor = actorFor(session, state)
  requireThat(!isEmployeeOnly(actor) || (employeeDoor && !actor.agent), 'Referral not found', 404)
  requireThat(!isAgency(actor) || (agencyDoor && !actor.agent), 'Agency record not found', 404)
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

api.post('/api/lodge/capture/address', async c => {
  const { state, actor } = await context(c)
  const result = captureAddress(state, actor, c.env.CAPTURE_DOMAIN)
  await save(c.env.DB, state, actor)
  return c.json(result)
})
api.get('/api/lodge/capture', async c => {
  const { state, actor } = await context(c)
  return c.json(captureList(state, actor, c.req.query('candidate')))
})
api.get('/api/lodge/capture/:id', async c => {
  const { state, actor } = await context(c)
  return c.json(captureRead(state, actor, c.req.param('id')))
})
api.get('/api/lodge/capture/:id/file/:file', async c => {
  const { state, actor } = await context(c)
  const m = captureRead(state, actor, c.req.param('id'))
  const f = m.attachments.find((f: Data) => f.id === c.req.param('file'))
  requireThat(f, 'Capture not found', 404)
  const blob = await readBlob(c.env.DB, f.id)
  requireThat(blob, 'Capture not found', 404)
  const bytes = Uint8Array.from(atob(blob.base64), v => v.charCodeAt(0))
  state.audit(actor, 'capture-file-downloaded', m.candidate ? 'candidate:' + m.candidate : 'member:' + actor.email)
  await save(c.env.DB, state, actor)
  return attachment(bytes, blob.mediaType, f.name)
})
api.post('/api/lodge/capture/:id/resolve', async c => {
  const { state, actor } = await context(c)
  const result = resolveCapture(state, actor, { ...await body(c), id: c.req.param('id') })
  await save(c.env.DB, state, actor)
  return c.json(result)
})

api.get('/api/lodge/sourcing-evidence', async c => {
  const { state, actor } = await context(c)
  return c.json(sourcingEvidence(state, actor, c.req.query('brief'), c.req.query('candidate')))
})

const delayInput = (c: C) => ({ vacancy: c.req.query('vacancy'), from: c.req.query('from'), to: c.req.query('to'), timeZone: c.req.query('timeZone') })
api.get('/api/lodge/handoff-preflight/:id', async c => {
  const { state, actor } = await context(c)
  return c.json(await handoffEvidence(state, actor, c.req.param('id')))
})
api.get('/api/lodge/candidate-updates', async c => {
  const { state, actor } = await context(c)
  return c.json(candidateUpdatesView(state, actor))
})
api.get('/api/lodge/delay-analysis', async c => {
  const { state, actor } = await context(c)
  return c.json(delayAnalysis(state, actor, await workspaceRecords(state, actor), delayInput(c)))
})
api.get('/api/lodge/delay-feedback', async c => {
  const { state, actor } = await context(c)
  return c.json(delayFeedback(state, actor, await workspaceRecords(state, actor), delayInput(c)))
})
api.get('/api/lodge/delay-analysis/:id', async c => {
  const { state, actor } = await context(c)
  const report = delayAnalysis(state, actor, await workspaceRecords(state, actor), delayInput(c))
  const row = report.cases.find(x => x.application === c.req.param('id'))
  requireThat(row, 'Delay case not found', 404)
  return c.json({ cohort: report.cohort, definitions: report.definitions, unknowns: report.unknowns, ...row })
})

api.get('/api/lodge/state', async c => {
  const { state, actor } = await context(c, true, true)
  if (isEmployeeOnly(actor)) return c.json({ actor: { email: actor.email, name: actor.name, roles: actor.roles }, referralPortal: { name: state.get('business', 'main').name, timeZone: state.get('business', 'main').timeZone }, referrals: referralsView(state, actor, c.env) })
  if (isAgency(actor)) return c.json(portal(state, actor))
  return c.json({ ...await workspace(state, actor, runtimeBindings(c.env)), importJobs: await importJobs(c.env.DB, actor, state) })
})

api.post('/api/lodge/command/:op', async c => {
  const { state, actor } = await context(c, c.req.param('op') === 'agency-submit', ['referral-alerts', 'referral-submit', 'apply-internal'].includes(c.req.param('op')))
  const op = c.req.param('op'), input = await body(c)
  if (op === 'member' && input.businessAgentId) {
    requireThat(actor.owner && input.agent === true, 'Only the owner binds a Business agent', 403)
    const sponsor = await c.env.DB.prepare("SELECT id FROM oa_operators WHERE email=? AND status='active'").bind(String(input.actsFor ?? '').toLowerCase()).first<{id:string}>()
    requireThat(sponsor, 'Current native sponsor required', 403)
    input.sponsorNativeId = sponsor.id
  }
  if (op === 'crm-enroll' || op === 'crm-enable') { input.origin = runtimeBindings(c.env).AUTH_ORIGIN; input.replyAddress = c.env.CRM_REPLY_ADDRESS ?? state.find('application-email-transport', 'main')?.replyTo }
  if (['careers-domain-verify', 'careers-domain-connect', 'careers-domain-disconnect'].includes(op)) return c.json(await careersDomainOperation(runtimeBindings(c.env), actor, op.slice('careers-domain-'.length) as 'verify' | 'connect' | 'disconnect', input))
  const result = op === 'careers-domain-challenge' ? careersDomainChallenge(state, actor, input, runtimeBindings(c.env)) : await run(state, actor, op, input)
  await save(c.env.DB, state, actor)
  return c.json(fieldResult(state, actor, blindResult(state, actor, result)))
})

api.get('/api/lodge/referral/export', async c => {
  const { state, actor } = await context(c, false, true)
  const result = referralsView(state, actor, c.env)
  state.audit(actor, 'referral-own-exported', 'member:' + actor.email)
  return recorded(c, state, actor, json(result, 'employee-referrals.json'))
})
api.get('/api/lodge/referral/file/:id', async c => {
  const { state, actor } = await context(c, false, true)
  const file = referralFile(state, actor, c.req.param('id'))
  const blob = await readBlob(c.env.DB, file.id)
  requireThat(blob, 'Referral not found', 404)
  state.audit(actor, 'referral-original-downloaded', 'referral-file:' + file.id)
  return recorded(c, state, actor, attachment(Uint8Array.from(atob(blob.base64), ch => ch.charCodeAt(0)), file.mediaType, file.name))
})

api.get('/api/lodge/agency/export', async c => {
  const { state, actor } = await context(c, true)
  const result = portal(state, actor)
  state.audit(actor, 'agency-own-exported', 'agency:' + result.agencyPortal.name)
  return recorded(c, state, actor, json(result.agencyPortal, 'agency-submissions.json'))
})
api.get('/api/lodge/agency/file/:id', async c => {
  const { state, actor } = await context(c, true)
  const file = agencyFile(state, actor, c.req.param('id'))
  const blob = await readBlob(c.env.DB, file.id)
  requireThat(blob, 'Agency record not found', 404)
  const data = Uint8Array.from(atob(blob.base64), ch => ch.charCodeAt(0))
  state.audit(actor, 'agency-original-downloaded', 'agency-file:' + file.id)
  return recorded(c, state, actor, attachment(data, file.mediaType, file.name))
})

api.get('/api/lodge/search', async c => {
  const { state, actor } = await context(c)
  return c.json({ results: search(await workspace(state, actor), c.req.query('q')) })
})

api.get('/api/lodge/views/:vacancy/:viewId', async c => {
  const { state, actor } = await context(c)
  return c.json(savedHiringView(await workspaceRecords(state, actor), c.req.param('vacancy'), c.req.param('viewId')))
})

api.get('/api/lodge/kit/:id', async c => {
  const { state, actor } = await context(c)
  const kit = kitView(await workspace(state, actor), c.req.param('id'))
  return c.json({ ...kit, ...(!actor.agent && kit.interview.participants.includes(actor.email) ? { offlineContext: await offlineScorecardContext(state, actor, kit.application, kit.interview.id) } : {}) })
})

api.get('/api/lodge/reports/surveys', async c => { const { state, actor } = await context(c); person(actor); return c.json(surveyReport(state, actor)) })

api.get('/api/lodge/reminders', async c => { const { state, actor } = await context(c); return c.json(reminderView(state, actor)) })

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

const cohortInput = (c: C) => ({ vacancy: c.req.query('vacancy'), from: c.req.query('from'), to: c.req.query('to'), timeZone: c.req.query('timeZone'), history: c.req.query('history') })
api.get('/api/lodge/reports/cohort', async c => {
  const { state, actor } = await context(c)
  return c.json(cohortReport(state, actor, await workspaceRecords(state, actor), cohortInput(c)))
})
api.get('/api/lodge/reports/cohort/:id', async c => {
  const { state, actor } = await context(c)
  const report = cohortReport(state, actor, await workspaceRecords(state, actor), cohortInput(c))
  const row = report.rows.find(r => r.application === c.req.param('id'))
  requireThat(row, 'Report application not found', 404)
  return c.json({ ...row, definitions: report.definitions, filter: report.filter })
})
api.get('/api/lodge/download/cohort', async c => {
  const { state, actor } = await context(c)
  const report = cohortReport(state, actor, await workspaceRecords(state, actor), cohortInput(c), true)
  state.audit(actor, 'cohort-report-exported', 'business:main', { filter: report.filter, applications: report.rows.length })
  await save(c.env.DB, state, actor)
  return json(report, 'lodge-cohort-report.json')
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

api.get('/api/lodge/reports/cutover', async c => {
  const { state, actor } = await context(c)
  return c.json(legacyReport(state, await workspaceRecords(state, actor)))
})

api.get('/api/lodge/reports/events', async c => {
  const { state, actor } = await context(c)
  return c.json({ events: (await workspaceRecords(state, actor)).events.map(e => ({ id: e.id, name: e.name, kind: e.kind, date: e.date, location: e.location, owner: e.owner, jobs: e.jobs, ...e.report })) })
})

api.get('/api/lodge/audit', async c => {
  const { state, actor } = await context(c)
  return c.json(auditTrail(state, actor, auditQuery(c.req.query())))
})

api.get('/api/lodge/crm', async c => { const { state, actor } = await context(c); return c.json(await crmView(state, actor, c.req.query('q'))) })

api.get('/api/lodge/talent', async c => {
  const { state, actor } = await context(c)
  return c.json({ matches: talentPool(state, actor, c.req.query('q')) })
})

api.post('/api/lodge/bulk-invitations/preview', async c => {
  const { state, actor } = await context(c); person(actor)
  const result = await bulkInvitationPreview(state, actor, await body(c))
  await save(c.env.DB, state, actor)
  return c.json(result)
})
api.post('/api/lodge/bulk-invitations/send', async c => {
  const { state, actor } = await context(c); person(actor)
  return c.json(await bulkInvitationSubmit(c.req.raw, c.env, state, actor, await body(c)))
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
  const result = await imports(c.env.DB, actor, op, input, retentionUntil(state), state)
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
  const receipt = await deleteCandidate(state, actor, await body(c))
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

api.get('/api/lodge/download/take-home/:id', async c => {
  const { state, actor } = await context(c)
  const app = requireApplication(state, actor, c.req.param('id')), job = state.get('vacancy', app.vacancy)
  requireThat(can(state, actor, job, 'export'), 'Your permission level does not let you export', 403)
  const view = assessmentView(state, actor)
  requireThat(view.assignments.some(r => r.application === app.id), 'Take-home not found', 404)
  const records = Object.fromEntries(['assignments', 'submissions', 'grades'].map(key => [key, (view as Data)[key].filter((r: Data) => r.application === app.id)]))
  state.audit(actor, 'take-home-exported', 'application:' + app.id)
  return recorded(c, state, actor, attachment(JSON.stringify(blindResult(state, actor, records, app), null, 2), 'application/json', 'take-home.json'))
})

api.get('/api/lodge/download/references/:id', async c => {
  const { state, actor } = await context(c)
  return recorded(c, state, actor, json(referenceExport(state, actor, c.req.param('id')), 'manual-references.json'))
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

mountEsign(api, { context, person, body })
