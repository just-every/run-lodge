import type { State } from '../core/state'
import { managesVacancy, requireAdmin, requireApplication, requireManages, requireMember } from '../core/access'
import { email, list, now, oneOf, requireThat, scope, text, uid, type Actor, type Data } from '../core/types'

// CRM-008: the employer's source list and hire credit. Admins keep sources by
// type and map free-text sources onto them (an alias); an application's source
// text resolves through that list on every read, so a mapping also reaches
// applications made before it. Intake doors Lodge runs create their own entry
// automatically (the application page today; ATTR boards when they ship).
// Each application records who is credited: the referring employee, the
// agency, the sourcer who added it or the recruiter; changes keep a history.

export const SOURCE_TYPES = ['job-board', 'careers-site', 'referral', 'agency', 'sourced', 'internal', 'event', 'other'] as const
export const CREDIT_KINDS = ['employee', 'agency', 'sourcer', 'recruiter'] as const
export const MERGE_RULES = ['own', 'first-touch'] as const
export type CreditKind = typeof CREDIT_KINDS[number]

const key = (v: string) => v.trim().toLowerCase()

/** The list entry a source text names (by name or a mapped alias, case-insensitive), or null when unmapped. */
export function sourceOf(s: State, value: string | undefined) {
  if (!value) return null
  const entry = s.all('source').find(x => key(x.name) === key(value) || (x.aliases ?? []).some((al: string) => key(al) === key(value)))
  return entry ? { id: entry.id as string, name: entry.name as string, type: entry.type as string } : null
}

/** An intake door Lodge runs keeps its own entry on the list, created the first time it is used. */
export function ensureSource(s: State, name: string, type: typeof SOURCE_TYPES[number]) {
  if (!sourceOf(s, name)) s.put('source', uid(), { name, type, aliases: [], automatic: true, createdAt: now() })
}

/** Admins add, rename, retype, map aliases onto, or retire a source; names and aliases stay unique. */
export function source(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const current = b.id ? s.get('source', b.id, 'Source') : null
  const name = text(b.name, 'Source name', 120), type = oneOf(b.type, SOURCE_TYPES, 'Source type')
  const aliases = [...new Set(list(b.aliases ?? [], 'Mapped source texts', 50, x => text(x, 'Mapped source text', 200)))]
  for (const label of [name, ...aliases]) {
    const taken = sourceOf(s, label)
    requireThat(!taken || taken.id === current?.id, `"${label}" already names the source ${taken?.name}`, 409)
  }
  const record = s.put('source', current?.id ?? uid(), { ...(current ?? { createdAt: now() }), name, type, aliases, retired: b.retired === true, updatedBy: a.email, updatedAt: now() })
  s.audit(a, current ? 'source-changed' : 'source-added', 'source:' + record.id, { name, type, aliases })
  return record
}

/** Admins choose how a merged person's hire is attributed: each application's own source, or the person's first touch. */
export function sourceSettings(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const record = s.put('source-settings', 'main', { onMerge: oneOf(b.onMerge, MERGE_RULES, 'Attribution after a merge'), by: a.email, at: now() })
  s.audit(a, 'source-settings', 'source-settings:main', { onMerge: record.onMerge })
  return record
}

export const mergeRule = (s: State): typeof MERGE_RULES[number] => s.find('source-settings', 'main')?.onMerge ?? 'own'

function creditee(s: State, kind: CreditKind, who: unknown) {
  if (kind === 'agency') return text(who, 'Agency', 200)
  const address = email(who, kind === 'employee' ? 'Referring employee email' : 'Credited person')
  if (kind !== 'employee') requireMember(s, address)
  return address
}

/** The credit a new application starts with: the referrer or agency the staff member names, the sourcer who added it, else that recruiter. */
export function initialCredit(s: State, a: Actor | null, vacancy: Data, b: Data) {
  if (!a) return null
  const kind: CreditKind = b.referrer ? 'employee' : b.agency ? 'agency' : managesVacancy(a, vacancy) ? 'recruiter' : 'sourcer'
  return { kind, who: creditee(s, kind, kind === 'employee' ? b.referrer : kind === 'agency' ? b.agency : scope(a)), by: a.email, at: now(), automatic: true }
}

/** The people who run the job change an application's credit with a reason; the earlier credit stays in its history. */
export function sourceCredit(s: State, a: Actor, b: Data) {
  const app = requireApplication(s, a, b.application)
  requireManages(a, s.get('vacancy', app.vacancy))
  const kind = oneOf(b.kind, CREDIT_KINDS, 'Credited as')
  const credit = { kind, who: creditee(s, kind, b.who), by: a.email, at: now(), reason: text(b.reason, 'Reason for the change', 1000) }
  const record = s.put('application', app.id, { ...app, credit, creditHistory: [...(app.creditHistory ?? []), ...(app.credit ? [app.credit] : [])] })
  s.audit(a, 'source-credit', 'application:' + app.id, { kind, who: credit.who, reason: credit.reason })
  return record
}
