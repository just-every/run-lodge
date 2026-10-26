import type { Bindings } from '../../auth.server'
import { load, save } from '../core/store'
import { email, now, requireThat, text, uid, type Actor, type Data } from '../core/types'
import { suspendOwnedWork } from './work'

const schema = 'urn:ietf:params:scim:schemas:core:2.0:User'
export const scimUser = (m: Data) => ({ schemas: [schema], id: m.enterprise.subject, externalId: m.enterprise.subject, userName: m.email, name: { formatted: m.name }, displayName: m.name, active: m.active, emails: [{ value: m.email, primary: true }], meta: { resourceType: 'User' } })

export async function scimAuthorized(request: Request, env: Bindings) {
  const actual = request.headers.get('authorization') ?? '', expected = 'Bearer ' + (env.ENTERPRISE_SCIM_TOKEN ?? '')
  requireThat((env.ENTERPRISE_SCIM_TOKEN?.length ?? 0) >= 32, 'Provisioning is not configured', 503)
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  const [a, b] = await Promise.all([digest(actual), digest(expected)])
  let different = 0; for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i]
  requireThat(different === 0, 'Provisioning credential refused', 401)
}

/** Trusted SCIM can create employee-only members. Hiring privileges need an explicit human grant. */
export async function provision(env: Bindings, input: Data, subject?: string) {
  const s = await load(env.DB), settings = s.get('enterprise-settings', 'main')
  requireThat(settings.enabled && settings.issuer === env.ENTERPRISE_OKTA_ISSUER, 'Enterprise provisioning is disabled', 403)
  const id = text(subject ?? input.externalId, 'Stable provider subject', 255)
  requireThat(/^[A-Za-z0-9._-]+$/.test(id), 'Use a stable provider subject')
  const current = s.scan('member').find(m => m.enterprise?.issuer === settings.issuer && m.enterprise.subject === id)
  requireThat(!subject || current, 'Provisioned member not found', 404)
  const address = input.userName === undefined && current ? current.email : email(input.userName, 'User name')
  requireThat(!current || current.email === address, 'Provider identity email changes require owner review', 409)
  requireThat(!input.externalId || input.externalId === id, 'The provider subject cannot change', 409)
  const existing = s.find('member', address)
  requireThat(!existing || existing === current, 'An existing identity requires owner review; it cannot be linked by email', 409)
  requireThat(!existing?.owner && !existing?.agent && !existing?.roles?.includes('agency'), 'This identity cannot be provisioned', 409)
  const active = input.active === undefined ? current?.active ?? true : input.active
  requireThat(typeof active === 'boolean', 'Active must be a boolean')
  const name = text(input.displayName ?? input.name?.formatted ?? ([input.name?.givenName, input.name?.familyName].filter(Boolean).join(' ') || current?.name || address), 'Display name', 120)
  const member = s.put('member', address, { ...current, email: address, name, roles: current?.roles ?? ['employee'], active, owner: false, agent: false, enterprise: { issuer: settings.issuer, subject: id }, provisionedAt: now() })
  const owner = s.get('member', env.OWNER_EMAIL.toLowerCase())
  requireThat(owner.owner && owner.active, 'An active owner is required', 409)
  const actor: Actor = { id: 'okta-scim', email: owner.email, name: 'Okta provisioning', owner: true, roles: ['admin'], agent: false, session: '', version: 0 }
  if (current?.active && !active) suspendOwnedWork(s, actor, address)
  s.audit(null, active ? 'okta-member-provisioned' : 'okta-member-deprovisioned', 'member:' + address, { issuer: settings.issuer, subject: id })
  const db = env.DB, native = await db.prepare('SELECT id,status,role,version FROM oa_operators WHERE email=?').bind(address).first<{ id: string; status: string; role: string; version: number }>()
  requireThat(!native || (current && native.role === 'member'), 'An existing native account cannot be adopted by email', 409)
  const extra = native ? [db.prepare('UPDATE oa_operators SET status=?,display_name=? WHERE id=? AND role=\'member\'').bind(active ? 'active' : 'inactive', name, native.id)] : [db.prepare('INSERT INTO oa_operators(id,email,display_name,role,status,version,created_at) VALUES(?,?,?,\'member\',?,1,?)').bind(uid(), address, name, active ? 'active' : 'inactive', Date.now())]
  if (native) extra.unshift(db.prepare("INSERT INTO l_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND role='member') THEN 1 ELSE 0 END").bind(native.id, native.version))
  if (!active) extra.push(db.prepare('UPDATE oa_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE operator_id IN (SELECT id FROM oa_operators WHERE email=?)').bind(Date.now(), address))
  await save(db, s, null, extra)
  return { member, created: !current }
}
