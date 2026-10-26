import { Hono, type Context } from 'hono'
import type { Bindings } from '../../auth.server'
import { requireAdmin } from '../core/access'
import { actorFor, load, save, signedIn } from '../core/store'
import { Fault, requireThat, type Data } from '../core/types'
import { esc, formBody, page } from '../http/public'
import { bulkInvitationPreview, bulkInvitationSubmit } from './bulk-invitations'

export const bulkInvitationPages = new Hono<{ Bindings: Bindings }>()
const ROOT = '/enterprise/invitations'
const nav = `<p><a href="/app">Back to Settings</a> · <a href="${ROOT}">Review another list</a></p>`
const statusNames: Record<string, string> = { new: 'New', existing: 'Already a member', refused: 'Refused', pending: 'Waiting', attempted: 'Attempt recorded', accepted: 'Accepted by mail provider', failed: 'Failed' }
const jobRoles: Record<string, string> = { recruiters: 'Recruiter', coordinators: 'Coordinator', hiringManagers: 'Hiring manager', sourcers: 'Sourcer', interviewers: 'Interviewer' }
bulkInvitationPages.use('*', async (c, next) => { await next(); c.header('cache-control', 'no-store'); c.header('referrer-policy', 'same-origin'); c.header('x-content-type-options', 'nosniff') })
bulkInvitationPages.onError(e => page('Invitations unavailable', `<h1>Invitations unavailable</h1><p role="alert">${esc(e instanceof Fault ? e.message : 'Please try again later.')}</p>${nav}`, e instanceof Fault ? e.status : 500))

async function context(c: Context<{ Bindings: Bindings }>) {
  const session = await signedIn(c.req.raw, c.env), s = await load(c.env.DB), a = actorFor(session, s)
  requireAdmin(a); requireThat(!a.agent, 'People, not agents, invite team members', 403)
  return { s, a }
}
const hidden = (name: string, value: unknown) => `<input type="hidden" name="${name}" value="${esc(value)}">`
function rowCard(r: Data) {
  const scopes = [r.departmentName && 'Home department: ' + r.departmentName, r.officeName && 'Home office: ' + r.officeName, r.departmentNames?.length && 'Department grants: ' + r.departmentNames.join('; '), r.officeNames?.length && 'Office grants: ' + r.officeNames.join('; ')].filter(Boolean)
  return `<article aria-label="Invitation row ${esc(r.line)}"><h3>Row ${esc(r.line)} · ${esc(r.name || r.email || 'Malformed row')}</h3><p>${esc(statusNames[r.status] ?? r.status)}${r.reason ? ' · ' + esc(r.reason) : ''}</p><p><code>${esc(r.email)}</code></p>${r.roles ? `<p>Roles: ${esc(r.roles.join(', '))}${r.levelName ? ' · Permission level: ' + esc(r.levelName) : ''}</p>` : ''}${r.jobTitle ? `<p>Job: ${esc(r.jobTitle)}${r.jobRole ? ' · ' + esc(jobRoles[r.jobRole] ?? r.jobRole) : ''}</p>` : ''}${scopes.length ? `<p>${scopes.map(esc).join('<br>')}</p>` : ''}</article>`
}

bulkInvitationPages.get(ROOT, async c => {
  await context(c)
  return page('Invite people in bulk', `<h1>Invite people in bulk</h1><p>Paste email addresses or a CSV. Review the roles and job access before invitations are sent.</p>${nav}<form method="post" action="${ROOT}/preview"><label>Invitation list<textarea name="source" rows="10" maxlength="200000" required></textarea></label><button>Preview invitations</button></form><details><summary>CSV columns and roles</summary><p>Use a header with these columns: email, name, roles, permission level, job, job role, department, office, departments, offices. Only email is required. Separate multiple roles or places with a semicolon. Jobs, permission levels and places accept names or IDs.</p><p>Roles: admin, manager, interviewer, approver, compliance, employee. Empty roles use interviewer. Job roles: recruiter, coordinator, hiring manager, sourcer, interviewer.</p><p>Department and office set someone’s home. Departments and offices grant managers access to jobs in those places. A permission level applies to a manager on a job or with department or office grants. Only the owner sends sign-in invitations.</p></details>`)
})
bulkInvitationPages.post(ROOT + '/preview', async c => {
  const { s, a } = await context(c)
  requireThat(Number(c.req.header('content-length') ?? 0) <= 900_000, 'Invitation list too large', 413)
  const input = await formBody(c), preview = await bulkInvitationPreview(s, a, { source: input.get('source') })
  await save(c.env.DB, s, a)
  return c.redirect(ROOT + '/preview/' + preview.id, 303)
})
bulkInvitationPages.get(ROOT + '/preview/:id', async c => {
  const { s, a } = await context(c), plan = s.get('bulk-invitations', c.req.param('id'), 'Invitation preview')
  requireThat(plan.createdBy === a.email, 'Invitation preview not found', 404)
  if (plan.status !== 'preview') return c.redirect(ROOT + '/result/' + plan.id, 303)
  const ready = plan.rows.filter((r: Data) => r.status === 'new').length
  return page('Review invitations', `<h1>Review invitations</h1>${nav}<p role="status">${ready} new people ready. ${plan.rows.length - ready} rows flagged.</p><p>Flagged rows will be skipped. Sending adds the new members with the roles and access shown below.</p>${a.owner && ready ? `<form method="post" action="${ROOT}/send">${hidden('id', plan.id)}${hidden('token', plan.token)}<button>Send ${ready} invitations</button></form>` : a.owner ? '<p>No new people to invite.</p>' : '<p>The owner must review and send sign-in invitations.</p>'}<section aria-label="Invitation preview">${plan.rows.map(rowCard).join('')}</section>`)
})
bulkInvitationPages.post(ROOT + '/send', async c => {
  const { s, a } = await context(c), input = await formBody(c)
  const result = await bulkInvitationSubmit(c.req.raw, c.env, s, a, { id: input.get('id'), token: input.get('token') })
  return c.redirect(ROOT + '/result/' + result.id, 303)
})
bulkInvitationPages.get(ROOT + '/result/:id', async c => {
  const { s, a } = await context(c), plan = s.get('bulk-invitations', c.req.param('id'), 'Invitation batch')
  requireThat(plan.createdBy === a.email, 'Invitation batch not found', 404)
  const accepted = plan.rows.filter((r: Data) => r.status === 'accepted').length
  const failed = plan.rows.filter((r: Data) => r.status === 'failed' || r.status === 'attempted').length
  return page('Invitation results', `<h1>Invitation results</h1>${nav}<p role="status">${accepted} invitations accepted by the mail provider.</p>${plan.status === 'sending' ? '<p>This batch has started sending. Attempts are saved before each provider request. Review any incomplete attempts individually.</p>' : '<p>This batch is complete. Reviewing the same file again sends no duplicate invitation.</p>'}${failed ? `<p>${failed} attempts need individual review before inviting again.</p>` : ''}<section aria-label="Invitation results">${plan.rows.map(rowCard).join('')}</section>`)
})
