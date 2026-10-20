import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { recordBlindReveals } from '../records/blind-review'
import { State, type Row } from './state'
import { Fault, requireThat, uid, type Actor, type Data, type Role } from './types'

/** Scalar SQL that is true only while the actor's exact session and operator version are current. */
export function authority(actor: Actor, owner = false) {
  return {
    sql: `EXISTS(SELECT 1 FROM oa_sessions se JOIN oa_operators o ON o.id=se.operator_id WHERE se.id=? AND o.id=? AND o.version=se.operator_version AND o.status='active' AND se.revoked_at IS NULL AND se.expires_at>unixepoch()*1000${owner ? " AND o.role='owner'" : ''})${(actor.memberships ?? []).map(() => " AND (SELECT revision FROM l_records WHERE kind='member' AND id=?) IS ?").join('')}`,
    params: [actor.session, actor.id, ...(actor.memberships ?? []).flatMap(m => [m.email, m.revision])] as unknown[],
  }
}

export async function load(db: D1Database): Promise<State> {
  const { results } = await db.prepare("SELECT kind,id,revision,value FROM l_records WHERE kind <> 'blob'").all<{ kind: string; id: string; revision: string; value: string }>()
  const state = new State(results.map(r => ({ kind: r.kind, id: r.id, revision: r.revision, value: JSON.parse(r.value) }) as Row))
  // Read only UTF-8 resume bytes for the sanitized REVIEW-002 text projection.
  const texts = await db.prepare("SELECT b.id,b.value FROM l_records b JOIN l_records d ON d.id=b.id AND d.kind='document' WHERE b.kind='blob' AND json_extract(d.value,'$.kind')='resume' AND (json_extract(d.value,'$.mediaType') LIKE 'text/%' OR json_extract(d.value,'$.name') LIKE '%.txt')").all<{ id: string; value: string }>()
  for (const row of texts.results) {
    try { const raw = atob(JSON.parse(row.value).base64); state.resumeTexts.set(row.id, new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(raw, c => c.charCodeAt(0)))) } catch { /* Invalid UTF-8 remains unavailable, never expose original bytes. */ }
  }
  return state
}

export async function readBlob(db: D1Database, id: string): Promise<{ base64: string; mediaType: string } | null> {
  const row = await db.prepare("SELECT value FROM l_records WHERE kind='blob' AND id=?").bind(id).first<{ value: string }>()
  return row ? JSON.parse(row.value) : null
}

/**
 * Commit a command's changes in one D1 batch. Each record the command read is
 * fenced at the revision it saw, and a signed-in actor's session is checked at
 * both ends, so concurrent or revoked work fails with 409 and changes nothing.
 */
export async function save(db: D1Database, state: State, actor: Actor | null, extra: D1PreparedStatement[] = []) {
  recordBlindReveals(state, actor)
  const { writes, fences, scans } = state.pending()
  if (!writes.length && !extra.length) return
  const guard = (sql: string, params: unknown[]) => db.prepare(`INSERT INTO l_guard SELECT CASE WHEN ${sql} THEN 1 ELSE 0 END`).bind(...params)
  const statements: D1PreparedStatement[] = []
  const auth = actor && authority(actor)
  if (auth) statements.push(guard(`(${auth.sql})`, auth.params))
  for (const scan of scans) statements.push(guard('(SELECT COUNT(*) FROM l_records WHERE kind=?)=?', [scan.kind, scan.count]))
  for (const fence of fences) statements.push(guard('(SELECT revision FROM l_records WHERE kind=? AND id=?) IS ?', [fence.kind, fence.id, fence.revision]))
  for (const write of writes) {
    if (write.value) statements.push(db.prepare('INSERT INTO l_records(kind,id,revision,value) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision,value=excluded.value').bind(write.kind, write.id, uid(), JSON.stringify(write.value)))
    else statements.push(db.prepare('DELETE FROM l_records WHERE kind=? AND id=?').bind(write.kind, write.id))
  }
  statements.push(...extra)
  if (actor) { const live = authority({ ...actor, memberships: [] }); statements.push(guard(`(${live.sql})`, live.params)) }
  statements.push(db.prepare('DELETE FROM l_guard'))
  try {
    await db.batch(statements)
  } catch (error) {
    if (String(error).includes('CHECK constraint')) throw new Fault(409, 'These records or your access changed since you opened them; reload and try again')
    throw error
  }
}

export interface Session { operator: { id: string; email: string; displayName: string; role: string; version: number }; id: string }

/** The current person, from the native session; mutations also need an exact same-origin request. */
export async function signedIn(request: Request, original: Bindings): Promise<Session> {
  const env = runtimeBindings(original)
  requireThat(new URL(request.url).origin === env.AUTH_ORIGIN, 'Invalid host', 403)
  // Downloads record who took them, so even reads refuse other sites' requests.
  requireThat(request.headers.get('sec-fetch-site') !== 'cross-site', 'Invalid origin', 403)
  if (!['GET', 'HEAD'].includes(request.method)) requireThat(request.headers.get('origin') === env.AUTH_ORIGIN && request.headers.get('sec-fetch-site') !== 'cross-site', 'Invalid origin', 403)
  const session = await operatorAuth(env).getSession(request)
  requireThat(session, 'Sign in required', 401)
  return session as unknown as Session
}

/** REQ-004: a member's department grants with every sub-department, and office grants; none when empty. */
function grantsOf(state: State, m: Data) {
  if (!m.grantDepartments?.length && !m.grantOffices?.length) return undefined
  const departments = new Set<string>(m.grantDepartments ?? [])
  // OPS-004: a granted department's level reaches its sub-departments; levels met twice combine.
  const levels: Record<string, string[]> = {}
  const add = (id: string, level?: string) => { if (level && !(levels[id] ??= []).includes(level)) levels[id].push(level) }
  for (const id of [...departments, ...(m.grantOffices ?? [])]) add(id, m.grantLevels?.[id])
  for (let grew = true; grew;) {
    grew = false
    for (const d of state.all('department')) if (d.parent && departments.has(d.parent)) {
      if (!departments.has(d.id)) { departments.add(d.id); grew = true }
      for (const l of levels[d.parent] ?? []) if (!(levels[d.id] ?? []).includes(l)) { add(d.id, l); grew = true }
    }
  }
  return { departments: [...departments], offices: [...(m.grantOffices ?? [])], levels }
}

/** Lodge capabilities come from the saved member record, never from the request body. */
export function actorFor(session: Session, state: State): Actor {
  const owner = session.operator.role === 'owner'
  // Members are keyed by email; reading it here fences the membership in any save.
  const member = state.find('member', session.operator.email.toLowerCase())
  requireThat(member?.active || (owner && !member && !state.find('business', 'main')), 'Active Lodge membership required', 403)
  const memberships = [{ email: session.operator.email.toLowerCase(), revision: state.revisionOf('member', session.operator.email.toLowerCase()) }]
  const all: Role[] = ['admin', 'manager', 'interviewer', 'approver']
  const base = { id: session.operator.id, email: session.operator.email.toLowerCase(), name: member?.name ?? session.operator.displayName, session: session.id, version: session.operator.version, owner, memberships }
  if (!owner && member?.agent) {
    // An agent member shares the view of the active person it acts for, and can only propose.
    const principal = member.active && member.actsFor ? state.find('member', member.actsFor) : null
    requireThat(principal?.active && !principal.agent, 'Active Lodge principal required', 403)
    memberships.push({ email: principal.email, revision: state.revisionOf('member', principal.email) })
    const roles: Role[] = principal.owner ? all : principal.roles
    requireThat(roles.length, 'Active Lodge principal capability required', 403)
    return { ...base, roles, agent: true, scopeAs: principal?.email, seePrivate: principal.owner === true || principal.seePrivate === true, grants: grantsOf(state, principal) }
  }
  requireThat(owner || member?.roles?.length, 'Active Lodge capability required', 403)
  return { ...base, roles: owner ? all : member!.roles, agent: false, seePrivate: member?.seePrivate === true, grants: owner ? undefined : grantsOf(state, member!) }
}
