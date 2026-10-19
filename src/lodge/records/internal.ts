import type { State } from '../core/state'
import { cleared, requireAdmin, requireManages, requireMember } from '../core/access'
import { now, optionalEmail, requireThat, scope, uid, type Actor, type Data } from '../core/types'
import { retentionUntil, startApplication } from './candidates'
import { ensureSource } from './sources'

// ATTR-005: the internal job board. Every active person member is an employee
// who sees published public and internal-only jobs in /app and applies with their
// member identity. The people who run a job mark it internal-only; such a job
// never reaches /jobs, the ATTR-008 embed, the ATTR-009 board or any feed. An
// internal application (source "Internal") is visible only to the owner, admins
// and the job's REQ-003 hiring team; the applicant sees only that they applied
// and when. An applicant's manager (the member's "reports to") hears of it only
// when the admins turn that on.

export const INTERNAL_SOURCE = 'Internal'

/** The people who run a job mark it internal-only, or public again. */
export function vacancyInternal(s: State, a: Actor, b: Data) {
  const v = s.get('vacancy', b.id)
  requireManages(a, v)
  requireThat(!v.imported && v.status !== 'closed', 'Only a live job can change who sees it', 409)
  const record = s.put('vacancy', v.id, { ...v, internalOnly: b.internalOnly === true })
  s.audit(a, record.internalOnly ? 'vacancy-internal-only' : 'vacancy-public', 'vacancy:' + v.id)
  return record
}

/** Admins choose whether an internal applicant's manager is told, and record who each member reports to. */
export function internalPolicy(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const record = s.put('internal-policy', 'main', { notifyManager: b.notifyManager === true, by: a.email, at: now() })
  s.audit(a, 'internal-policy', 'internal-policy:main', { notifyManager: record.notifyManager })
  return record
}

export function reportsTo(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const member = requireMember(s, String(b.email ?? '').toLowerCase())
  const manager = optionalEmail(b.reportsTo, 'Reports to')
  if (manager) requireThat(manager !== member.email && requireMember(s, manager), 'Choose another active member')
  const record = s.put('member', member.email, { ...member, reportsTo: manager || null })
  s.audit(a, 'member-reports-to', 'member:' + member.email, { reportsTo: record.reportsTo })
  return record
}

const person = (a: Actor) => !a.agent && (a.owner || a.roles.length > 0)

/** Published jobs an employee may apply to inside Lodge: public and internal-only, never a confidential one they are not cleared for. */
export function internalBoard(s: State, a: Actor) {
  if (!person(a)) return []
  const mine = s.all('application').filter(x => x.internal && x.memberEmail === scope(a))
  return s.all('vacancy').filter(v => v.status === 'open' && !v.imported && cleared(a, v, 'confidential')).sort((x, y) => x.title.localeCompare(y.title))
    .map(v => ({ id: v.id, title: v.title, department: v.department, location: v.location, workMode: v.workMode, employmentType: v.employmentType, description: v.description, internalOnly: v.internalOnly === true, applied: mine.find(x => x.vacancy === v.id)?.submittedAt ?? null }))
}

/** An employee applies with their member identity; a candidate with the same email is offered for LDG-005 review, never merged. */
export function applyInternal(s: State, a: Actor, b: Data) {
  requireThat(person(a), 'Only a person who is a member applies internally', 403)
  const v = s.get('vacancy', b.vacancy)
  requireThat(v.status === 'open' && !v.imported && cleared(a, v, 'confidential'), 'This job is not open', 404)
  const me = s.get('member', a.email)
  requireThat(!s.scan('application').some(x => x.internal && x.memberEmail === me.email && x.vacancy === v.id), 'You have already applied to this job', 409)
  const business = s.get('business', 'main')
  const notice = business.notices.at(-1)
  ensureSource(s, INTERNAL_SOURCE, 'internal')
  const candidate = s.put('candidate', uid(), {
    name: me.name, email: me.email, phone: '', location: '', headline: '', skills: '', source: INTERNAL_SOURCE, internal: true, memberEmail: me.email, createdAt: now(), retainUntil: retentionUntil(s),
    consent: { basis: 'internal application', noticeVersion: notice.version, talentPool: false, at: now(), recordedBy: me.email },
  })
  const application = startApplication(s, a, candidate, v, INTERNAL_SOURCE, { internal: true, memberEmail: me.email }, 'Internal application received')
  s.audit(a, 'internal-application', 'application:' + application.id)
  const policy = s.find('internal-policy', 'main')
  if (policy?.notifyManager && me.reportsTo && s.find('member', me.reportsTo)?.active) {
    // The manager learns who applied to which job, nothing about the application itself.
    s.put('notification', uid(), { to: me.reportsTo, kind: 'internal-applicant', who: me.name, email: me.email, title: v.title, at: now() })
  }
  return { id: application.id, vacancy: v.id, submittedAt: application.submittedAt }
}

/** The internal-applicant notices addressed to the reader. */
export const internalNotices = (s: State, a: Actor) => s.all('notification').filter(n => n.kind === 'internal-applicant' && n.to === scope(a)).sort((x, y) => y.at.localeCompare(x.at))
