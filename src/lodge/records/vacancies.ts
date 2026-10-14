import type { State } from '../core/state'
import { managesVacancy, requireManages, requireMember, requireRole } from '../core/access'
import { currency, integer, list, money, now, oneOf, optionalText, requireThat, text, uid, type Actor, type Data } from '../core/types'
import { approvedNow, requestApproval } from './approvals'

// Flows 1 and 2: a vacancy with its compensation range, manager and headcount
// approval, and the stages, rubric and interview plan agreed before anyone is
// evaluated. Approved terms cannot drift: editing them needs a new approval.

const DEFAULT_STAGES = ['Applied', 'Screen', 'Interview', 'Decision']
const shortId = () => uid().slice(0, 8)

export function missingTerms(v: Data): string[] {
  const missing: string[] = []
  if (!v.location) missing.push('location')
  if (!v.compensation) missing.push('compensation range')
  if (!v.headcount) missing.push('headcount')
  if ((v.stages ?? []).length < 2) missing.push('at least two stages')
  if (!(v.rubrics ?? []).at(-1)?.criteria?.length) missing.push('a job-related rubric')
  if (!(v.plan ?? []).length) missing.push('an interview plan')
  return missing
}

function compensation(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  const c = value as Data
  const min = money(c.min, 'Minimum pay'), max = money(c.max, 'Maximum pay')
  requireThat(min <= max, 'Minimum pay must not exceed maximum pay')
  return { currency: currency(c.currency), min, max, period: oneOf(c.period, ['year', 'month', 'hour'] as const, 'Pay period') }
}

function editable(s: State, a: Actor, id: unknown) {
  const v = s.get('vacancy', id)
  requireManages(a, v)
  requireThat(!v.imported, 'Imported vacancies are kept as history; create a new vacancy to hire again', 409)
  requireThat(v.status !== 'open', 'This vacancy is published; unpublish it before changing approved terms', 409)
  requireThat(v.status !== 'closed', 'This vacancy is closed', 409)
  return v
}

export function vacancy(s: State, a: Actor, b: Data) {
  requireRole(a, 'admin', 'manager')
  const fields = {
    title: text(b.title, 'Title', 160),
    department: optionalText(b.department, 'Department', 120),
    location: optionalText(b.location, 'Location', 160),
    workMode: oneOf(b.workMode ?? 'onsite', ['onsite', 'hybrid', 'remote'] as const, 'Work mode'),
    employmentType: oneOf(b.employmentType ?? 'full-time', ['full-time', 'part-time', 'contract', 'temporary'] as const, 'Employment type'),
    description: optionalText(b.description, 'Description', 20000),
    compensation: compensation(b.compensation),
    headcount: b.headcount === undefined || b.headcount === '' ? null : integer(b.headcount, 'Headcount', 1, 500),
    manager: text(b.manager ?? a.email, 'Hiring manager').toLowerCase(),
  }
  requireMember(s, fields.manager, 'manager')
  // A manager creates vacancies for themselves; admins may assign anyone.
  requireThat(managesVacancy(a, { manager: fields.manager }), 'Managers can only create vacancies they manage', 403)
  if (b.id) {
    const current = editable(s, a, b.id)
    const record = s.put('vacancy', current.id, { ...current, ...fields, updatedAt: now() })
    s.audit(a, 'vacancy-updated', 'vacancy:' + record.id)
    return record
  }
  const record = s.put('vacancy', uid(), { ...fields, status: 'draft', stages: DEFAULT_STAGES.map(name => ({ id: shortId(), name })), rubrics: [], plan: [], createdBy: a.email, createdAt: now(), hires: 0 })
  s.audit(a, 'vacancy-created', 'vacancy:' + record.id)
  return record
}

export function stages(s: State, a: Actor, b: Data) {
  const v = editable(s, a, b.id)
  const next = list(b.stages, 'Stages', 12, (x: any) => ({ id: typeof x?.id === 'string' && x.id ? x.id : shortId(), name: text(x?.name, 'Stage name', 80) }))
  requireThat(next.length >= 2, 'Keep at least two stages')
  requireThat(new Set(next.map(x => x.id)).size === next.length, 'Stage ids must be unique')
  for (const app of s.all('application').filter(x => x.vacancy === v.id)) requireThat(next.some(x => x.id === app.stage), `Stage of ${app.id} is in use; move its applications first`, 409)
  const record = s.put('vacancy', v.id, { ...v, stages: next, plan: v.plan.filter((p: Data) => next.some(x => x.id === p.stage)) })
  s.audit(a, 'stages-defined', 'vacancy:' + v.id, { stages: next.map(x => x.name) })
  return record
}

/** Each rubric change is a new version; scorecards keep the version they were written against. */
export function rubric(s: State, a: Actor, b: Data) {
  const v = editable(s, a, b.id)
  const criteria = list(b.criteria, 'Criteria', 20, (x: any) => ({ id: typeof x?.id === 'string' && x.id ? x.id : shortId(), name: text(x?.name, 'Criterion', 120), description: text(x?.description, 'What job-related evidence this criterion looks for', 1000) }))
  requireThat(criteria.length > 0, 'Add at least one criterion')
  const version = (v.rubrics.at(-1)?.version ?? 0) + 1
  const record = s.put('vacancy', v.id, { ...v, rubrics: [...v.rubrics, { version, criteria, by: a.email, at: now() }] })
  s.audit(a, 'rubric-version', 'vacancy:' + v.id, { version })
  return record
}

export function plan(s: State, a: Actor, b: Data) {
  const v = editable(s, a, b.id)
  const criteria = (v.rubrics.at(-1)?.criteria ?? []) as Data[]
  requireThat(criteria.length, 'Define the rubric before the interview plan', 409)
  const items = list(b.plan, 'Interview plan', 12, (x: any) => {
    // Agents and the plan editor may name the stage instead of its id.
    if (x && !x.stage && x.stageName) x.stage = v.stages.find((st: Data) => st.name === x.stageName)?.id
    requireThat(v.stages.some((st: Data) => st.id === x?.stage), 'Each interview must belong to a stage')
    const focus = list(x?.criteria ?? [], 'Interview focus', 20, c => { requireThat(criteria.some(k => k.id === c), 'Interview focus must be rubric criteria'); return c as string })
    return { id: typeof x?.id === 'string' && x.id ? x.id : shortId(), name: text(x?.name, 'Interview name', 120), stage: x.stage as string, durationMinutes: integer(x?.durationMinutes ?? 45, 'Duration', 10, 480), criteria: focus }
  })
  requireThat(items.length > 0, 'Plan at least one interview')
  const record = s.put('vacancy', v.id, { ...v, plan: items })
  s.audit(a, 'interview-plan', 'vacancy:' + v.id)
  return record
}

export async function requestVacancyApproval(s: State, a: Actor, b: Data) {
  const v = editable(s, a, b.id)
  const missing = missingTerms(v)
  requireThat(!missing.length, 'Add before requesting approval: ' + missing.join(', '), 409)
  return requestApproval(s, a, 'vacancy', v, b.approver)
}

export async function publish(s: State, a: Actor, b: Data) {
  const v = editable(s, a, b.id)
  const business = s.get('business', 'main', 'business settings')
  requireThat(await approvedNow(s, 'vacancy', v), 'Publishing needs a current approval of these exact terms', 409)
  const slug = v.slug ?? `${v.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'role'}-${uid().slice(0, 6)}`
  const record = s.put('vacancy', v.id, { ...v, status: 'open', slug, publishedAt: now(), noticeVersion: business.notices.at(-1).version })
  s.audit(a, 'vacancy-published', 'vacancy:' + v.id, { slug })
  return record
}

export function unpublish(s: State, a: Actor, b: Data) {
  const v = s.get('vacancy', b.id)
  requireManages(a, v)
  requireThat(v.status === 'open', 'Only a published vacancy can be unpublished', 409)
  const record = s.put('vacancy', v.id, { ...v, status: 'draft' })
  s.audit(a, 'vacancy-unpublished', 'vacancy:' + v.id, { reason: text(b.reason, 'Reason', 500) })
  return record
}

export function close(s: State, a: Actor, b: Data) {
  const v = s.get('vacancy', b.id)
  requireManages(a, v)
  requireThat(v.status !== 'closed', 'Already closed', 409)
  const record = s.put('vacancy', v.id, { ...v, status: 'closed', closedAt: now(), closeReason: text(b.reason, 'Reason', 500) })
  s.audit(a, 'vacancy-closed', 'vacancy:' + v.id, { reason: record.closeReason })
  return record
}
