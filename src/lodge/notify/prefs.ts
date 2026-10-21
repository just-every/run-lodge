import type { State } from '../core/state'
import { managesVacancy, canSeeApplication, onTeam, requireAdmin, TEAM_ROLES } from '../core/access'
import { oneOf, requireThat, scope, now, type Actor, type Data } from '../core/types'
import { CHANNELS, EVENTS, MODES, prefId, type EventKind } from './events'

// TEAM-003: a member's own choices per job, the admin's defaults per REQ-003 role, and reading alerts.

const eventOf = (b: Data) => oneOf(b.event, Object.keys(EVENTS) as EventKind[], 'Event')

/** Merge the channels named in the request: a mode sets it, "inherit" clears the override. */
function merged(current: Data | undefined, b: Data) {
  const next = { ...(current ?? {}) }
  let touched = false
  for (const ch of CHANNELS) {
    if (b[ch] === undefined) continue
    touched = true
    const mode = oneOf(b[ch], [...MODES, 'inherit'] as const, ch === 'email' ? 'Email' : 'In-app')
    if (mode === 'inherit') delete next[ch]; else next[ch] = mode
  }
  requireThat(touched, 'Choose email or in-app')
  return next
}

/** A member chooses email and in-app delivery for each event on a job they are on (or review for). */
export function notifyPref(s: State, a: Actor, b: Data) {
  const vacancy = s.get('vacancy', b.vacancy)
  const me = scope(a)
  requireThat(managesVacancy(a, vacancy) || onTeam(me, vacancy) || s.all('application').some(x => x.vacancy === vacancy.id && canSeeApplication(s, a, x)), 'Job not found', 404)
  const event = eventOf(b), id = prefId(me, vacancy.id), current = s.find('notify-pref', id)
  const next = merged(current?.events?.[event], b)
  const record = s.put('notify-pref', id, { member: me, vacancy: vacancy.id, events: { ...(current?.events ?? {}), [event]: next }, updatedAt: now() })
  s.audit(a, 'notify-pref', 'vacancy:' + vacancy.id, { event, ...next })
  return record
}

/** Admins set what a REQ-003 role hears by default on every job; a member's own choice still wins. */
export function notifyDefault(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const role = oneOf(b.role, TEAM_ROLES, 'Role'), event = eventOf(b), current = s.find('notify-default', 'main')
  const next = merged(current?.roles?.[role]?.[event], b)
  const roles = { ...(current?.roles ?? {}), [role]: { ...(current?.roles?.[role] ?? {}), [event]: next } }
  const record = s.put('notify-default', 'main', { roles, by: a.email, at: now() })
  s.audit(a, 'notify-default', 'notify-default:main', { role, event, ...next })
  return record
}

/** Mark one alert, or all of your own, as read. Read mentions leave HOME-001. */
export function alertRead(s: State, a: Actor, b: Data) {
  const mine = s.all('alert').filter(x => x.to === scope(a) && !x.readAt && (b.all === true || x.id === b.id))
  requireThat(b.all === true || mine.length, 'Notification not found', 404)
  for (const x of mine) s.put('alert', x.id, { ...s.get('alert', x.id), readAt: now() })
  return { read: mine.length }
}
