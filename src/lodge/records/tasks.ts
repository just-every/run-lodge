import type { State } from '../core/state'
import { requireCan, canReview, canSeeApplication, canSeeCandidate, requireApplication, requireMember, requireRole } from '../core/access'
import { date, now, oneOf, requireThat, text, uid, type Actor, type Data } from '../core/types'
import { businessZone, toWall } from '../core/time'

// Follow-up reminders and recruiters' tasks: a date, a note and an owner. They
// show on their owner's home, come due on their date, close with the
// application they belong to and move to another person when their owner is
// deprovisioned.

/** The saved member as an actor, to ask whether they could see what a task points at. */
const asActor = (m: Data): Actor => ({ id: m.email, email: m.email, name: m.name, session: '', version: 0, owner: m.owner === true, roles: m.roles ?? [], agent: false })

function canReach(s: State, owner: Data, task: Data) {
  const who = asActor(owner)
  if (task.application) return canSeeApplication(s, who, s.get('application', task.application))
  return !task.candidate || canSeeCandidate(s, who, s.get('candidate', task.candidate))
}

/** Any hiring-team member sets a follow-up on a candidate or application; recruiters (admins and managers) also create tasks. */
export function task(s: State, a: Actor, b: Data) {
  const kind = oneOf(b.kind ?? 'follow-up', ['follow-up', 'task'] as const, 'Kind')
  requireThat(canReview(a), 'Only the hiring team sets follow-ups', 403)
  if (kind === 'task') requireRole(a, 'admin', 'manager')
  const app = b.application ? requireApplication(s, a, b.application) : null
  const candidate = app || b.candidate ? s.find('candidate', app?.candidate ?? b.candidate) : null
  if (app || b.candidate) requireThat(candidate && !candidate.deleted && !candidate.mergedInto && canSeeCandidate(s, a, candidate), 'Candidate not found', 404)
  requireThat(kind === 'task' || candidate, 'A follow-up is set on a candidate or an application')
  if (app) requireThat(app.status === 'active', 'This application is closed', 409)
  const purpose = b.purpose ? oneOf(b.purpose, ['call-references'] as const, 'Task purpose') : null
  if (purpose) {
    requireThat(kind === 'task' && app, 'Call references needs an application-linked task')
    requireCan(s, a, s.get('vacancy', app.vacancy), 'contact')
  }
  const owner = requireMember(s, text(b.owner ?? a.email, 'Owner', 254).toLowerCase())
  requireThat(!owner.agent, 'An agent cannot own a follow-up; choose a person')
  const record = { kind, purpose, candidate: candidate?.id ?? null, application: app?.id ?? null, owner: owner.email, createdBy: a.email, note: text(b.note, 'Note', 1000), due: date(b.due, 'Due date'), status: 'open', createdAt: now(), history: [] }
  requireThat(canReach(s, owner, record), `${owner.email} cannot see this candidate`)
  const saved = s.put('task', uid(), record)
  s.audit(a, 'task-created', candidate ? 'candidate:' + candidate.id : 'task:' + saved.id, { task: saved.id, owner: owner.email, due: saved.due })
  return saved
}

export function completeTask(s: State, a: Actor, b: Data) {
  const t = s.get('task', b.id, 'task')
  requireThat(t.owner === a.email || t.createdBy === a.email, 'Only its owner or the person who set it closes a task', 403)
  requireThat(t.status === 'open', 'This task is already closed', 409)
  const record = s.put('task', t.id, { ...t, status: 'done', closedAt: now(), closedBy: a.email })
  s.audit(a, 'task-done', t.candidate ? 'candidate:' + t.candidate : 'task:' + t.id, { task: t.id })
  return record
}

/** Closing an application cancels the follow-ups and tasks set on it. */
export function cancelTasks(s: State, applicationId: string, reason: string) {
  for (const t of s.all('task').filter(t => t.application === applicationId && t.status === 'open'))
    s.put('task', t.id, { ...s.get('task', t.id), status: 'cancelled', closedAt: now(), closedReason: reason })
}

/** A deprovisioned member's open tasks go to whoever set them, or else to the person deprovisioning them. */
export function reassignTasks(s: State, a: Actor, from: string) {
  for (const t of s.all('task').filter(t => t.owner === from && t.status === 'open')) {
    const creator = s.find('member', t.createdBy)
    const to = creator?.active && !creator.agent && creator.email !== from && canReach(s, creator, t) ? creator.email : a.email
    s.put('task', t.id, { ...s.get('task', t.id), owner: to, history: [...(t.history ?? []), { from, to, at: now(), reason: 'Owner deprovisioned' }] })
    s.audit(a, 'task-reassigned', t.candidate ? 'candidate:' + t.candidate : 'task:' + t.id, { task: t.id, from, to })
  }
}

/** Today's date where the business works: a task comes due at the start of its day there. */
export const businessToday = (s: State) => new Date(toWall(Date.now(), businessZone(s.find('business', 'main')))).toISOString().slice(0, 10)
