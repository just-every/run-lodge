import type { State } from '../core/state'
import { canReview, isAdmin, requireAdmin, requireMember, requireRole } from '../core/access'
import { date, email, integer, list, money, now, requireThat, text, uid, type Actor, type Data } from '../core/types'
import { plan, rubric, vacancy } from './vacancies'

// A job can start from the hiring manager's kickoff: what the role is for, the
// must-have and nice-to-have criteria, a proposed interview plan with its
// interviewers, the USD pay range asked for, headcount and target start. A
// recruiter turns it into the job draft; the kickoff stays linked, and its
// requested pay and headcount are part of the job's approved terms.

function payRange(value: unknown) {
  const c = (value ?? {}) as Data
  requireThat(c.currency === 'USD', 'Request the pay range in USD')
  const min = money(c.min, 'Minimum pay'), max = money(c.max, 'Maximum pay')
  requireThat(min <= max, 'Minimum pay must not exceed maximum pay')
  requireThat(['year', 'hour'].includes(c.period), 'Pay period must be per year or per hour')
  return { currency: 'USD', min, max, period: c.period as string }
}

const criteria = (value: unknown, label: string, min: number) => {
  const items = list(value ?? [], label, 10, x => text(x, label, 120))
  requireThat(items.length >= min, `Add at least one ${label.toLowerCase()} criterion`)
  return items
}

/** The hiring manager's kickoff; its author or an admin edits it, and each pay or headcount change is kept. */
export function kickoff(s: State, a: Actor, b: Data) {
  requireRole(a, 'admin', 'manager')
  const fields = {
    title: text(b.title, 'Role', 160), purpose: text(b.purpose, 'Role purpose', 4000),
    mustHave: criteria(b.mustHave, 'Must-have', 1), niceToHave: criteria(b.niceToHave, 'Nice-to-have', 0),
    plan: list(b.plan, 'Proposed interview plan', 12, (x: any) => ({
      name: text(x?.name, 'Interview name', 120),
      interviewers: list(x?.interviewers ?? [], 'Interviewers', 8, i => {
        const m = requireMember(s, email(i, 'Interviewer'))
        requireThat(!m.agent && canReview({ owner: m.owner, roles: m.roles }), `${m.email} needs the interviewer role`)
        return m.email
      }),
    })),
    payRange: payRange(b.payRange), headcount: integer(b.headcount, 'Headcount', 1, 500), targetStart: date(b.targetStart, 'Target start date'),
  }
  requireThat(fields.plan.length > 0, 'Propose at least one interview')
  if (b.id) {
    const current = s.get('kickoff', b.id)
    requireThat(current.author === a.email || isAdmin(a), 'This kickoff belongs to another hiring manager', 403)
    const changed = current.payRange.min !== fields.payRange.min || current.payRange.max !== fields.payRange.max || current.payRange.period !== fields.payRange.period || current.headcount !== fields.headcount
    const record = s.put('kickoff', current.id, { ...current, ...fields, updatedAt: now(), changes: changed ? [...(current.changes ?? []), { payRange: current.payRange, headcount: current.headcount, by: a.email, at: now() }] : current.changes ?? [] })
    s.audit(a, 'kickoff-updated', 'kickoff:' + current.id, { payOrHeadcountChanged: changed })
    return record
  }
  const record = s.put('kickoff', uid(), { ...fields, author: a.email, status: 'submitted', vacancy: null, createdAt: now(), changes: [] })
  s.audit(a, 'kickoff-submitted', 'kickoff:' + record.id)
  return record
}

/**
 * A recruiter turns a kickoff into the job draft: the requested pay range and
 * headcount, a rubric from its criteria and a plan from its interviews, each
 * changeable before approval. The job and the kickoff point at each other.
 */
export function vacancyFromKickoff(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const k = s.get('kickoff', b.kickoff)
  requireThat(!k.vacancy, 'This kickoff already has its job', 409)
  const draft = vacancy(s, a, {
    title: b.title ?? k.title, department: b.department, location: b.location, workMode: b.workMode, employmentType: b.employmentType,
    description: b.description ?? k.purpose, compensation: k.payRange, headcount: k.headcount, manager: k.author,
  })
  rubric(s, a, { id: draft.id, criteria: b.criteria ?? [...k.mustHave.map((name: string) => ({ name, description: `Must have: ${name}` })), ...k.niceToHave.map((name: string) => ({ name, description: `Nice to have: ${name}` }))] })
  const interview = draft.stages.find((st: Data) => st.name === 'Interview') ?? draft.stages[1]
  plan(s, a, { id: draft.id, plan: b.plan ?? k.plan.map((p: Data) => ({ name: p.name, stage: interview.id })) })
  const record = s.put('vacancy', draft.id, { ...s.get('vacancy', draft.id), kickoff: k.id })
  s.put('kickoff', k.id, { ...k, status: 'converted', vacancy: draft.id, convertedBy: a.email, convertedAt: now() })
  s.audit(a, 'vacancy-from-kickoff', 'vacancy:' + draft.id, { kickoff: k.id })
  return record
}

/** The kickoff's requested pay and headcount, bound into the linked job's approval. */
export const kickoffTerms = (k: Data | undefined) => k && { payRange: k.payRange, headcount: k.headcount }
