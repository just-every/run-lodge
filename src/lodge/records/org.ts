import type { State } from '../core/state'
import { requireAdmin } from '../core/access'
import { list, now, requireThat, text, uid, type Actor, type Data } from '../core/types'
import { grantLevels } from './levels'

// REQ-004: the business's department hierarchy and its US office list. Jobs,
// openings and members attach to them; the careers page filters by them.
// Renaming keeps the earlier names; deleting one still in use is refused.

const MAX_DEPTH = 6

/** "Operations › Warehouse": a department's path from its top-level parent. */
export function departmentPath(s: State, id: unknown): string {
  const names: string[] = []
  for (let d = s.find('department', id), hops = 0; d && hops < MAX_DEPTH + 1; d = d.parent ? s.find('department', d.parent) : undefined, hops++) names.unshift(d.name)
  return names.join(' › ')
}

/** A department and every department below it. */
export function subtree(s: State, id: string): Set<string> {
  const ids = new Set([id])
  for (let grew = true; grew;) {
    grew = false
    for (const d of s.all('department')) if (d.parent && ids.has(d.parent) && !ids.has(d.id)) { ids.add(d.id); grew = true }
  }
  return ids
}

function named(s: State, kind: 'department' | 'office', b: Data, label: string, siblings: (x: Data) => boolean) {
  const name = text(b.name, label, 120)
  const clash = s.all(kind).some(x => x.id !== b.id && siblings(x) && x.name.toLowerCase() === name.toLowerCase())
  requireThat(!clash, `${label} “${name}” already exists here`, 409)
  return name
}

/** Create a department, or with `id` rename or move it; earlier names are kept. */
export function department(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const parent = b.parent ? s.get('department', b.parent).id as string : null
  const current = b.id ? s.get('department', b.id) : null
  if (current && parent) requireThat(!subtree(s, current.id).has(parent), 'A department cannot sit inside itself', 409)
  let depth = 1
  for (let p = parent; p; p = s.find('department', p)?.parent ?? null) depth++
  requireThat(depth <= MAX_DEPTH, `Departments go at most ${MAX_DEPTH} levels deep`)
  const name = named(s, 'department', b, 'Department', x => (x.parent ?? null) === parent)
  const renamed = current && current.name !== name ? [...(current.names ?? []), { name: current.name, until: now(), by: a.email }] : current?.names ?? []
  const record = s.put('department', current?.id ?? uid(), { ...(current ?? { createdBy: a.email, createdAt: now() }), name, parent, names: renamed })
  s.audit(a, current ? 'department-updated' : 'department-created', 'department:' + record.id, { name, parent })
  return record
}

/** Create an office (a US location, for example "Denver, CO" or "Remote (US)"), or rename it. */
export function office(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const current = b.id ? s.get('office', b.id) : null
  const name = named(s, 'office', b, 'Office', () => true)
  const renamed = current && current.name !== name ? [...(current.names ?? []), { name: current.name, until: now(), by: a.email }] : current?.names ?? []
  const record = s.put('office', current?.id ?? uid(), { ...(current ?? { createdBy: a.email, createdAt: now() }), name, names: renamed })
  s.audit(a, current ? 'office-updated' : 'office-created', 'office:' + record.id, { name })
  return record
}

/** What still uses a department or office: jobs, their openings, members and sub-departments. */
function users(s: State, kind: 'department' | 'office', id: string) {
  const key = kind === 'department' ? 'departmentId' : 'officeId'
  const jobs = s.scan('vacancy').filter(v => v[key] === id || (kind === 'office' && (v.openings ?? []).some((o: Data) => o.officeId === id)))
  const grantKey = kind === 'department' ? 'grantDepartments' : 'grantOffices'
  const members = s.scan('member').filter(m => m[key] === id || (m[grantKey] ?? []).includes(id))
  const children = kind === 'department' ? s.scan('department').filter(d => d.parent === id) : []
  return [...jobs.map(v => `job “${v.title}”`), ...members.map(m => `member ${m.email}`), ...children.map(d => `department “${d.name}”`)]
}

export function deleteOrg(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const kind = b.kind === 'office' ? 'office' : 'department'
  const record = s.get(kind, b.id)
  const using = users(s, kind, record.id)
  requireThat(!using.length, `${record.name} is still used by ${using.slice(0, 3).join(', ')}${using.length > 3 ? ` and ${using.length - 3} more` : ''}`, 409)
  s.remove(kind, record.id)
  s.audit(a, kind + '-deleted', `${kind}:${record.id}`, { name: record.name })
  return { id: record.id, deleted: true }
}

/**
 * A member's home department and office, and for a manager the departments and
 * offices whose jobs they also run (grants). Changing grants changes access at once.
 */
export function memberOrg(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const m = s.get('member', typeof b.email === 'string' ? b.email.toLowerCase() : b.email, 'member')
  const grantDepartments = list(b.grantDepartments ?? [], 'Granted departments', 50, x => s.get('department', x).id as string)
  const grantOffices = list(b.grantOffices ?? [], 'Granted offices', 50, x => s.get('office', x).id as string)
  requireThat(!(grantDepartments.length || grantOffices.length) || (m.roles.includes('manager') && !m.agent), 'Department and office grants are for managers', 409)
  const record = s.put('member', m.email, { ...m, departmentId: b.department ? s.get('department', b.department).id : undefined, officeId: b.office ? s.get('office', b.office).id : undefined, grantDepartments: [...new Set(grantDepartments)], grantOffices: [...new Set(grantOffices)], grantLevels: grantLevels(s, b.grantLevels, [...grantDepartments, ...grantOffices]) })
  s.audit(a, 'member-org', 'member:' + m.email, { department: record.departmentId ?? null, office: record.officeId ?? null, grantDepartments: record.grantDepartments, grantOffices: record.grantOffices, grantLevels: record.grantLevels })
  return record
}

/** Validate a job's or opening's department and office references. */
export const departmentRef = (s: State, id: unknown) => id ? s.get('department', id).id as string : undefined
export const officeRef = (s: State, id: unknown) => id ? s.get('office', id).id as string : undefined
