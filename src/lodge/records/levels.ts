import type { State } from '../core/state'
import { PERMISSIONS, SEEDED_LEVELS, TEAM_ROLES, levelById, requireAdmin, requireManages, requireMember, type Permission } from '../core/access'
import { email, list, now, requireThat, text, uid, type Actor, type Data } from '../core/types'

// OPS-004: the owner and hiring admins (people, not agents) define named
// permission levels and assign them to a member on a job, to a REQ-003 team
// role on a job, or with a department or office grant (REQ-004, in org.ts).
// Access is computed from these records on every request (core/access.ts), so
// an edit applies at once through every door.

const COMPLIANCE = /monitor|accommodat|equal|eeo|self-?id/i

function admin(a: Actor) {
  requireAdmin(a)
  requireThat(!a.agent, 'People, not agents, set permission levels', 403)
}

const permissions = (value: unknown) => [...new Set(list(value, 'Permissions', PERMISSIONS.length + 5, (x, i) => {
  const p = text(x, `Permission ${i + 1}`, 60)
  requireThat(!COMPLIANCE.test(p), 'Monitoring and accommodation answers stay with the owner and hiring admins; no level can grant them', 409)
  requireThat((PERMISSIONS as readonly string[]).includes(p), `Unknown permission “${p}”; use ${PERMISSIONS.join(', ')}`)
  return p as Permission
}))]

/** Create or edit a named level. Lodge's seeded levels stay as they are. */
export function permissionLevel(s: State, a: Actor, b: Data) {
  admin(a)
  requireThat(!SEEDED_LEVELS.some(l => l.id === b.id), 'Lodge’s seeded levels cannot be changed; create a new level', 409)
  const current = b.id ? s.get('permission-level', b.id, 'permission level') : null
  const name = text(b.name, 'Level name', 80)
  requireThat(![...SEEDED_LEVELS, ...s.all('permission-level')].some(l => l.id !== current?.id && l.name.toLowerCase() === name.toLowerCase()), 'Another level has that name', 409)
  const record = s.put('permission-level', current?.id ?? uid(), { ...(current ?? { createdBy: a.email, createdAt: now() }), name, permissions: permissions(b.permissions), editedBy: a.email, editedAt: now() })
  s.audit(a, current ? 'permission-level-edited' : 'permission-level-created', 'permission-level:' + record.id, { permissions: record.permissions })
  return record
}

/** Where a level is assigned: jobs (members or team roles) and member grants. */
function uses(s: State, id: string) {
  const jobs = s.all('vacancy').filter(v => Object.values(v.levels?.members ?? {}).includes(id) || Object.values(v.levels?.roles ?? {}).includes(id))
  const members = s.all('member').filter(m => Object.values(m.grantLevels ?? {}).includes(id))
  return [...jobs.map(v => `job “${v.title}”`), ...members.map(m => m.email)]
}

export function deletePermissionLevel(s: State, a: Actor, b: Data) {
  admin(a)
  const level = s.get('permission-level', b.id, 'permission level')
  const used = uses(s, level.id)
  requireThat(!used.length, `“${level.name}” is assigned (${used.join(', ')}); assign another level first`, 409)
  s.remove('permission-level', level.id)
  s.audit(a, 'permission-level-deleted', 'permission-level:' + level.id, { name: level.name })
  return { id: level.id, deleted: true }
}

export const requireLevel = (s: State, id: unknown) => {
  const level = typeof id === 'string' ? levelById(s, id) : undefined
  requireThat(level, 'Choose one of the permission levels')
  return level!.id as string
}

/** Assign levels on one job: to members (who then run it, managers only) and to its REQ-003 team roles. */
export function jobLevels(s: State, a: Actor, b: Data) {
  admin(a)
  const v = s.get('vacancy', b.id)
  requireManages(a, v)
  requireThat(!v.imported && v.status !== 'closed', 'Set levels on a live job', 409)
  const members: Record<string, string> = {}
  for (const [who, level] of Object.entries(b.members && typeof b.members === 'object' ? b.members : {})) {
    const m = requireMember(s, email(who, 'Member'))
    requireThat(!m.agent && (m.owner || m.roles.includes('manager')), `${m.email} needs the manager role to hold a level on a job`, 409)
    members[m.email] = requireLevel(s, level)
  }
  const roles: Record<string, string> = {}
  for (const [role, level] of Object.entries(b.roles && typeof b.roles === 'object' ? b.roles : {})) {
    requireThat((TEAM_ROLES as readonly string[]).includes(role), `Unknown team role “${role}”`)
    roles[role] = requireLevel(s, level)
  }
  const record = s.put('vacancy', v.id, { ...v, levels: { members, roles } })
  s.audit(a, 'job-levels', 'vacancy:' + v.id, { members, roles })
  return record
}

/** OPS-004 for REQ-004 grants: the level each granted department or office carries (none = Lodge's manager set). */
export function grantLevels(s: State, given: unknown, granted: string[]) {
  const out: Record<string, string> = {}
  for (const [id, level] of Object.entries(given && typeof given === 'object' ? given : {})) {
    requireThat(granted.includes(id), 'A level goes with a granted department or office')
    out[id] = requireLevel(s, level)
  }
  return out
}
