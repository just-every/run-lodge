import type { State } from '../core/state'
import { canSeeApplication, isAdmin } from '../core/access'
import { businessZone, fromWall } from '../core/time'
import { optionalText, requireThat, type Actor, type Data } from '../core/types'
import { concealer } from './workspace'

// OPS-001: the complete audit, for the owner and hiring admins. Every event in
// the chosen period, oldest first, never capped or truncated, leaving out only
// events about a confidential job or private candidate the reader is not cleared
// for. Events are append-only: a correction is a new event, and only LDG-012
// erasure strips an erased candidate's personal text from the events about them,
// keeping who, when, what and which record. Periods are whole calendar days in
// the business's time zone, both ends included.

const DAY = 86_400_000

export interface AuditQuery { from?: string; to?: string; q?: string; action?: string; actor?: string }

export function auditQuery(raw: Record<string, string | undefined>): AuditQuery {
  const day = (v: string | undefined, label: string) => {
    if (!v) return undefined
    requireThat(/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)), `${label} must be a date like 2026-10-19`)
    return v
  }
  return { from: day(raw.from, 'From'), to: day(raw.to, 'To'), q: optionalText(raw.q, 'Search', 200), action: optionalText(raw.action, 'Action', 100), actor: optionalText(raw.actor, 'Who', 200) }
}

export function auditTrail(s: State, a: Actor, query: AuditQuery) {
  requireThat(isAdmin(a), 'Only the owner or a hiring admin reads the audit', 403)
  const zone = businessZone(s.find('business', 'main'))
  const start = query.from ? fromWall(Date.parse(query.from), zone) : null
  const end = query.to ? fromWall(Date.parse(query.to) + DAY, zone) : null
  requireThat(!start || !end || start < end, 'The period ends before it starts')
  const { concealed } = concealer(s, a, new Set(s.all('application').filter(app => canSeeApplication(s, a, app)).map(x => x.id)))
  const words = (query.q ?? '').toLowerCase(), who = (query.actor ?? '').toLowerCase()
  const events = s.all('audit').filter((e: Data) => !concealed(e.record ?? '') && (!start || e.at >= start) && (!end || e.at < end)
    && (!query.action || e.action === query.action) && (!who || String(e.email).toLowerCase().includes(who)) && (!words || JSON.stringify(e).toLowerCase().includes(words)))
    .sort((x: Data, y: Data) => x.at.localeCompare(y.at) || x.id.localeCompare(y.id))
  return { period: { from: query.from ?? null, to: query.to ?? null, timeZone: zone }, filters: { q: query.q || null, action: query.action || null, actor: query.actor || null }, total: events.length, events }
}
