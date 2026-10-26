import type { Bindings } from '../../auth.server'
import { SEEDED_LEVELS, TEAM_ROLES, managesVacancy, requireAdmin } from '../core/access'
import { invite } from '../core/invitation'
import type { State } from '../core/state'
import { load, save } from '../core/store'
import { Fault, canonical, email, now, requireThat, sha256, text, uid, ROLES as MEMBER_ROLES, type Actor, type Data } from '../core/types'
import { parseCsv } from '../move-in/csv'
import { jobLevels } from '../records/levels'
import { departmentPath, memberOrg } from '../records/org'
import { member } from '../records/people'
import { team } from '../records/team'

const KINDS = ['business', 'member', 'vacancy', 'permission-level', 'department', 'office']
const key = (value: string) => value.trim().toLowerCase().replace(/[ _-]+/g, '')
const parts = (value = '') => value.split(/[;|]/).map(x => x.trim()).filter(Boolean)
const JOB_ROLES: Record<string, string> = { recruiter: 'recruiters', coordinator: 'coordinators', hiringmanager: 'hiringManagers', sourcer: 'sourcers', interviewer: 'interviewers', ...Object.fromEntries(TEAM_ROLES.map(r => [key(r), r])) }
const ROLES: Record<string, string> = { admin: 'admin', hiringadmin: 'admin', manager: 'manager', hiringmanager: 'manager', recruiter: 'manager', coordinator: 'manager', interviewer: 'interviewer', approver: 'approver', employee: 'employee', ...Object.fromEntries(MEMBER_ROLES.map(r => [r, r])) }

function person(a: Actor) {
  requireAdmin(a)
  requireThat(!a.agent, 'People, not agents, invite team members', 403)
}

async function stamp(s: State) {
  return sha256(canonical(KINDS.flatMap(kind => s.scan(kind).map(r => ({ kind, id: r.id, revision: s.revisionOf(kind, r.id) }))).sort((x, y) => (x.kind + x.id).localeCompare(y.kind + y.id))))
}

function readSource(source: unknown) {
  const raw = text(source, 'Pasted invitation list', 200_000).replace(/^\uFEFF/, '')
  const parsed = parseCsv(raw), structured = parsed.headers.some(h => key(h) === 'email')
  // Structured input names its columns; a plain list accepts lines, commas or semicolons.
  const csv = structured ? parsed : parseCsv('email\n' + raw.replace(/[;,]/g, '\n'))
  requireThat(!csv.error, csv.error ?? 'Invalid CSV')
  const headers = csv.headers.map(key)
  requireThat(headers.includes('email') && new Set(headers).size === headers.length, 'Include one email column and unique column names')
  const allowed = ['email', 'name', 'roles', 'permissionlevel', 'level', 'job', 'jobrole', 'department', 'office', 'departments', 'offices']
  requireThat(headers.every(h => allowed.includes(h)), 'Unknown column; use email, name, roles, permission level, job, job role, department, office, departments or offices')
  const offset = structured ? 0 : 1
  const rows = [
    ...csv.rows.map(r => ({ line: r.line - offset, values: Object.fromEntries(Object.entries(r.values).map(([k, v]) => [key(k), v.trim()])) as Record<string, string>, error: '' })),
    ...csv.malformed.map(r => ({ line: r.line - offset, values: {} as Record<string, string>, error: 'Malformed CSV row: ' + r.reason })),
  ].sort((a, b) => a.line - b.line)
  requireThat(rows.length > 0 && rows.length <= 100, 'Paste between 1 and 100 people')
  return rows
}

function resolve(s: State, kind: string, value: string, label: string, actor?: Actor): Data | undefined {
  if (!value) return undefined
  const records = kind === 'permission-level' ? [...SEEDED_LEVELS, ...s.scan(kind)] : s.scan(kind).filter(r => kind !== 'vacancy' || (actor && !r.imported && r.status !== 'closed' && managesVacancy(actor, r)))
  const matches = records.filter(r => r.id === value || (kind === 'department' ? departmentPath(s, r.id) : kind === 'vacancy' ? r.title : r.name).toLowerCase() === value.toLowerCase())
  requireThat(matches.length === 1, matches.length ? `${label} is ambiguous; use its ID` : `Unknown ${label.toLowerCase()}: ${value}`)
  return matches[0]
}

function normalize(s: State, a: Actor, b: Record<string, string>) {
  const address = email(b.email)
  const roles = [...new Set(parts(b.roles || 'interviewer').map(role => { const found = ROLES[key(role)]; requireThat(found, `Unknown role: ${role}`); return found }))]
  const job = resolve(s, 'vacancy', b.job || '', 'Job', a), level = resolve(s, 'permission-level', b.permissionlevel || b.level || '', 'Permission level')
  const jobRole = b.jobrole ? JOB_ROLES[key(b.jobrole)] : undefined
  requireThat(!b.jobrole || jobRole, 'Unknown job role')
  requireThat(!jobRole || job, 'Choose a job for the job role')
  requireThat(!job || jobRole || level, 'Choose a job role or permission level for this job')
  const department = resolve(s, 'department', b.department || '', 'Department'), office = resolve(s, 'office', b.office || '', 'Office')
  const departments = [...new Set(parts(b.departments).map(d => resolve(s, 'department', d, 'Department')!.id as string))]
  const offices = [...new Set(parts(b.offices).map(o => resolve(s, 'office', o, 'Office')!.id as string))]
  requireThat(!level || job || departments.length || offices.length, 'A permission level needs a job or a department or office grant')
  return { email: address, name: text(b.name || address.split('@')[0], 'Name', 120), roles, job: job?.id, jobTitle: job?.title, jobRole, level: level?.id, levelName: level?.name, department: department?.id, departmentName: department?.name, office: office?.id, officeName: office?.name, departments, departmentNames: departments.map(id => departmentPath(s, id)), offices, officeNames: offices.map(id => s.get('office', id).name) }
}

/** Run the same saved-role, grant and hiring-team validators as individual changes. */
function apply(s: State, a: Actor, row: Data) {
  member(s, a, row)
  memberOrg(s, a, { email: row.email, department: row.department, office: row.office, grantDepartments: row.departments, grantOffices: row.offices, grantLevels: row.level ? Object.fromEntries([...row.departments, ...row.offices].map(id => [id, row.level])) : {} })
  if (!row.job) return
  let v = s.get('vacancy', row.job)
  if (row.jobRole) {
    team(s, a, { id: v.id, ...v.team, [row.jobRole]: [...(v.team?.[row.jobRole] ?? []), row.email] })
    v = s.get('vacancy', row.job)
  }
  if (row.level) jobLevels(s, a, { id: v.id, members: { ...v.levels?.members, [row.email]: row.level }, roles: v.levels?.roles })
}

/** Only the preview record and its audit are persisted; membership changes run on an isolated State. */
export async function bulkInvitationPreview(s: State, a: Actor, b: Data) {
  person(a)
  requireThat(s.find('business', 'main'), 'Save the business settings first', 409)
  let draft = s.clone()
  const seen = new Set<string>()
  const rows = readSource(b.source).map(input => {
    let row: Data = { line: input.line, email: input.values.email ?? '', name: input.values.name ?? '' }
    try {
      requireThat(!input.error, input.error)
      const address = email(input.values.email)
      row.email = address
      if (s.find('member', address)) return { ...row, status: 'existing', reason: 'Already a member' }
      requireThat(!seen.has(address), 'Duplicate email in this list')
      seen.add(address)
      row = { ...row, ...normalize(s, a, input.values) }
      requireThat(!/[\x00-\x1f]/.test(row.name), 'Name must not contain control characters')
      const next = draft.clone()
      apply(next, a, row)
      draft = next
      return { ...row, status: 'new', reason: '' }
    } catch (error) {
      if (!(error instanceof Fault)) throw error
      return { ...row, status: 'refused', reason: error.message }
    }
  })
  const record = s.put('bulk-invitations', uid(), { createdBy: a.email, createdAt: now(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), status: 'preview', token: uid(), stamp: await stamp(s), rows })
  s.audit(a, 'bulk-invitations-previewed', 'bulk-invitations:' + record.id, { new: rows.filter(r => r.status === 'new').length, flagged: rows.filter(r => r.status !== 'new').length })
  return record
}

function receipt(plan: Data, sent: number) {
  return { id: plan.id, status: plan.status, sent, previouslySent: plan.rows.filter((r: Data) => r.status === 'accepted').length - sent, rows: plan.rows }
}

/** Claim the exact preview before any provider attempt. Replays never claim or send twice.
 * Failed and interrupted attempts remain explicit, requiring individual review rather than automatic retries. */
export async function bulkInvitationSubmit(request: Request, env: Bindings, s: State, a: Actor, b: Data) {
  person(a)
  requireThat(a.owner, 'Only the owner can invite people to sign in', 403)
  let plan = s.get('bulk-invitations', b.id, 'Invitation preview')
  requireThat(plan.createdBy === a.email && plan.token === b.token, 'Review this invitation preview before sending', 409)
  if (plan.status !== 'preview') return receipt(plan, 0)
  requireThat(plan.expiresAt > now() && plan.stamp === await stamp(s), 'Membership or job settings changed; preview the list again', 409)
  for (const row of plan.rows) if (row.status === 'new') {
    requireThat(!s.find('member', row.email), 'Membership changed; preview the list again', 409)
    apply(s, a, row)
  }
  plan = s.put('bulk-invitations', plan.id, { ...plan, status: 'sending', rows: plan.rows.map((r: Data) => r.status === 'new' ? { ...r, status: 'pending' } : r) })
  s.audit(a, 'bulk-invitations-confirmed', 'bulk-invitations:' + plan.id)
  await save(env.DB, s, a)
  let sent = 0
  for (const row of plan.rows.filter((r: Data) => r.status === 'pending')) {
    // A durable claim precedes the native invitation's token write and network request.
    const current = await load(env.DB), live = current.get('bulk-invitations', plan.id)
    const target = current.get('member', row.email)
    const index = live.rows.findIndex((r: Data) => r.line === row.line)
    requireThat(target.active && !target.agent && canonical(target.roles) === canonical(row.roles), 'Membership changed during invitation send', 409)
    const rows = live.rows.map((r: Data, i: number) => i === index ? { ...r, status: 'attempted' } : r)
    current.put('bulk-invitations', plan.id, { ...live, rows })
    await save(env.DB, current, a)
    const delivery = await load(env.DB)
    delivery.get('bulk-invitations', plan.id)
    const memberRecord = delivery.get('member', row.email)
    let status = 'accepted', reason = ''
    try {
      requireThat(memberRecord.active && !memberRecord.agent && canonical(memberRecord.roles) === canonical(row.roles), 'Membership changed during invitation send', 409)
      await invite(request, env, delivery, a, memberRecord)
      sent++
    } catch (error) { status = 'failed'; reason = error instanceof Fault ? error.message : 'Mail provider error' }
    const after = await load(env.DB), saved = after.get('bulk-invitations', plan.id)
    after.put('bulk-invitations', plan.id, { ...saved, rows: saved.rows.map((r: Data, i: number) => i === index ? { ...r, status, reason } : r) })
    after.audit(a, status === 'accepted' ? 'invitation-handed-to-mail-provider' : 'invitation-failed', 'member:' + row.email, { provider: env.MAIL_PROVIDER ?? 'not configured', batch: plan.id, outcome: status, ...(reason ? { error: reason } : {}) })
    await save(env.DB, after, a)
  }
  const final = await load(env.DB)
  plan = final.put('bulk-invitations', plan.id, { ...final.get('bulk-invitations', plan.id), status: 'complete', completedAt: now() })
  await save(env.DB, final, a)
  return receipt(plan, sent)
}
