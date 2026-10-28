import { AuthStore } from '../../modules/operator-auth/accounts/store.mjs'
import { actorFor, load, save, type Session } from '../core/store'
import { can, canReview, cleared, isAdmin, managesVacancy } from '../core/access'
import type { State } from '../core/state'
import { requireThat, text, list, oneOf, now, sha256, uid, type Actor, type Data } from '../core/types'

export const APP_FIELDS = ['identity', 'contact'] as const
export interface Credential {
  id: string; revision: string; token_hash: string; author_session: string; author_id: string
  name: string; jobs: string; fields: string; created_at: string; revoked_at: string | null
}
const metadata = (row: Credential) => ({ id: row.id, revision: row.revision, name: row.name, jobs: JSON.parse(row.jobs), fields: JSON.parse(row.fields), createdAt: row.created_at, revokedAt: row.revoked_at })

export function requireManagement(actor: Actor) {
  requireThat(!actor.agent && isAdmin(actor), 'Only a human owner or hiring admin manages app credentials', 403)
}
export function requireJobs(state: State, actor: Actor, jobs: string[]) {
  for (const id of jobs) {
    const job = state.get('vacancy', id)
    requireThat(cleared(actor, job, 'confidential') && managesVacancy(actor, job) && can(state, actor, job, 'settings'), 'Current job settings authority required', 403)
  }
}
export async function credentialList(db: D1Database, actor: Actor) {
  requireManagement(actor)
  const rows = await db.prepare('SELECT * FROM l_app_credentials WHERE author_id=? ORDER BY created_at,id').bind(actor.id).all<Credential>()
  return rows.results.map(metadata)
}

/** A native human authorizes only their own current view; raw tokens are returned once. */
export async function manageCredential(db: D1Database, state: State, actor: Actor, input: Data, id?: string, action?: string) {
  requireManagement(actor)
  const prior = id ? await db.prepare('SELECT * FROM l_app_credentials WHERE id=? AND author_id=?').bind(id, actor.id).first<Credential>() : null
  requireThat(!id || prior, 'Credential not found', 404)
  requireThat(!prior || prior.revision === input.revision, 'Credential changed; reload first', 409)
  requireThat(!prior?.revoked_at, 'Credential is revoked', 409)
  const revoked = action === 'revoke'
  const jobs = prior ? JSON.parse(prior.jobs) as string[] : [...new Set(list(input.jobs, 'Jobs', 100, j => text(j, 'Job', 200))) ]
  requireThat(jobs.length, 'Choose at least one job')
  // Revocation remains available even after the author loses a job.
  if (!revoked) requireJobs(state, actor, jobs)
  const fields = prior ? JSON.parse(prior.fields) : [...new Set(list(input.fields ?? [], 'Fields', APP_FIELDS.length, f => oneOf(f, APP_FIELDS, 'Field')))]
  const name = prior?.name ?? text(input.name, 'Integration name', 100)
  const credentialId = prior?.id ?? uid(), revision = uid(), at = now()
  const raw = revoked ? null : 'lodge-app.' + [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('')
  const hash = raw ? await sha256(raw) : prior!.token_hash
  const extra: D1PreparedStatement[] = []
  if (prior) {
    extra.push(db.prepare('INSERT INTO l_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM l_app_credentials WHERE id=? AND revision=? AND revoked_at IS NULL) THEN 1 ELSE 0 END').bind(prior.id, prior.revision))
    extra.push(db.prepare('UPDATE l_app_credentials SET revision=?,token_hash=?,author_session=?,revoked_at=? WHERE id=?').bind(revision, hash, revoked ? prior.author_session : actor.session, revoked ? at : null, credentialId))
  } else {
    extra.push(db.prepare('INSERT INTO l_app_credentials(id,revision,token_hash,author_session,author_id,name,jobs,fields,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(credentialId, revision, hash, actor.session, actor.id, name, JSON.stringify(jobs), JSON.stringify(fields), at))
  }
  state.audit(actor, 'app-credential-' + (revoked ? 'revoked' : prior ? 'rotated' : 'created'), 'app-credential:' + credentialId)
  await save(db, state, actor, extra)
  return { credential: { id: credentialId, revision, name, jobs, fields, createdAt: prior?.created_at ?? at, revokedAt: revoked ? at : null }, ...(raw ? { token: raw } : {}) }
}

/** Reuse Base's live session validation, including provider pins and deprovisioning. */
export async function integrationContext(db: D1Database, authorization: string | undefined) {
  requireThat(authorization && /^Bearer lodge-app\.[a-f0-9]{64}$/.test(authorization), 'App credential required', 401)
  const row = await db.prepare('SELECT * FROM l_app_credentials WHERE token_hash=? AND revoked_at IS NULL').bind(await sha256(authorization.slice(7))).first<Credential>()
  requireThat(row, 'App credential is no longer active', 401)
  const native = await db.prepare('SELECT token_hash FROM oa_sessions WHERE id=? AND operator_id=?').bind(row.author_session, row.author_id).first<{ token_hash: string }>()
  const session = native && await new AuthStore(db).session(native.token_hash, Date.now()) as Session | null
  requireThat(session, 'Authorizing session is no longer active', 401)
  const state = await load(db), actor = actorFor(session, state)
  requireThat(!actor.agent && canReview(actor), 'Recruiting membership required', 403)
  return { state, actor, credential: row, jobs: JSON.parse(row.jobs) as string[], fields: JSON.parse(row.fields) as string[] }
}
