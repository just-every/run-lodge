import type { State } from '../core/state'
import { canReview, onTeam, requireAdmin, requireManages, requireMember, TEAM_ROLES, teamOf, type TeamRole } from '../core/access'
import { email, list, now, requireThat, type Actor, type Data } from '../core/types'

// REQ-003: each job's hiring team. Recruiters, coordinators and hiring managers
// run the job like its hiring manager (approving offers and terms stays with
// the approver role); sourcers see the job and add candidates to it;
// interviewers are the job's panel pool. Access is read from the team on every
// request, so a change reaches every door at once.

const LABELS: Record<TeamRole, string> = { recruiters: 'Recruiter', coordinators: 'Coordinator', hiringManagers: 'Hiring manager', sourcers: 'Sourcer', interviewers: 'Interviewer' }

/** Until OPS-004 levels exist, each team role needs the Lodge role that carries its access. */
function eligible(s: State, role: TeamRole, address: string) {
  const m = requireMember(s, address)
  requireThat(!m.agent, `${LABELS[role]}s are people; ${address} is an agent member`)
  if (role === 'interviewers') requireThat(m.owner || canReview({ owner: m.owner === true, roles: m.roles }), `${address} needs the interviewer, manager or admin role to interview for this job`)
  else if (role !== 'sourcers') requireThat(m.owner || m.roles.includes('manager') || m.roles.includes('admin'), `${address} needs the manager or admin role to be a ${LABELS[role].toLowerCase()} on this job`)
  return m.email as string
}

/** A team by role, each person checked as eligible today; the job's own hiring manager is not listed again. */
export function validTeam(s: State, b: Data, manager: string) {
  const next = Object.fromEntries(TEAM_ROLES.map(r => [r, [...new Set(list(b[r] ?? [], LABELS[r] + 's', 20, x => eligible(s, r, email(x, LABELS[r]))))]])) as Record<TeamRole, string[]>
  next.hiringManagers = next.hiringManagers.filter(x => x !== manager)
  return next
}

/**
 * Set the whole team of one job. Someone taken off the team loses access at
 * once, and their open follow-ups and tasks on the job's applications go to
 * whoever took their place in the same role, else the job's first recruiter,
 * else its own hiring manager.
 */
export function team(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const v = s.get('vacancy', b.id)
  requireManages(a, v)
  requireThat(!v.imported && v.status !== 'closed', 'Set the hiring team of a live job', 409)
  const before = Object.fromEntries(TEAM_ROLES.map(r => [r, teamOf(v, r)])) as Record<TeamRole, string[]>
  const next = validTeam(s, b, v.manager)
  const record = s.put('vacancy', v.id, { ...v, team: next })
  s.audit(a, 'hiring-team', 'vacancy:' + v.id, { team: next })

  const removed = new Map<string, TeamRole>()
  for (const r of TEAM_ROLES) for (const who of before[r]) if (!onTeam(who, record) && !removed.has(who)) removed.set(who, r)
  for (const [from, role] of removed) {
    const to = next[role].find(x => !before[role].includes(x)) ?? next.recruiters[0] ?? v.manager
    for (const t of s.all('task').filter(t => t.owner === from && t.status === 'open' && t.application && s.find('application', t.application)?.vacancy === v.id)) {
      s.put('task', t.id, { ...s.get('task', t.id), owner: to, history: [...(t.history ?? []), { from, to, at: now(), reason: `Removed from the hiring team of ${v.title}` }] })
      s.audit(a, 'task-reassigned', t.candidate ? 'candidate:' + t.candidate : 'task:' + t.id, { task: t.id, from, to })
    }
  }
  return record
}
