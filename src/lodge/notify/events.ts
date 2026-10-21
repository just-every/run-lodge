import type { State } from '../core/state'
import { TEAM_ROLES, teamOf, type TeamRole } from '../core/access'
import { businessZone, fromWall, toWall } from '../core/time'
import type { Data } from '../core/types'

// TEAM-002 / TEAM-003: what a member can be told, and how each channel is chosen. Exact semantics:
// - one setting per member, job, event and channel (email, in-app): off, immediate or daily digest;
// - a setting resolves from the member's own choice for that job, else the admin default for their REQ-003 role on
//   the job, else Lodge's: in-app immediately, email off (an @mention reaches both at once, as it is addressed to a person);
// - a daily digest goes out at 8:00 in the business's time zone, the next time that hour comes round;
// - turning a setting off stops future notifications only; what was already raised stays.

export const EVENTS = {
  application: 'New application', assigned: 'Application assigned for review', approval: 'Approval waiting', scorecard: 'Scorecard submitted',
  feedback: 'Feedback released', interview: 'Interview scheduled or changed', offer: 'Offer status', mention: '@mention',
} as const
export type EventKind = keyof typeof EVENTS
export const MODES = ['off', 'immediate', 'digest'] as const
export type Mode = typeof MODES[number]
export const CHANNELS = ['email', 'inApp'] as const
export type Channel = typeof CHANNELS[number]
export type Setting = Record<Channel, Mode>

export const DIGEST_HOUR = 8
const BUILT_IN: Setting = { email: 'off', inApp: 'immediate' }
const MENTIONED: Setting = { email: 'immediate', inApp: 'immediate' }

export const prefId = (email: string, vacancy: string) => email + '|' + vacancy

/** The REQ-003 roles a person holds on a job; its own hiring manager always counts as one. */
export const rolesOn = (vacancy: Data, who: string): TeamRole[] => TEAM_ROLES.filter(r => teamOf(vacancy, r).includes(who) || (r === 'hiringManagers' && vacancy.manager === who))

/** Where each channel's setting comes from: the member's own choice, a role default, or Lodge's. */
export function settingFor(s: State, email: string, vacancy: Data | null, event: EventKind): { setting: Setting; own: Partial<Setting> } {
  const base = event === 'mention' ? MENTIONED : BUILT_IN
  const defaults = s.find('notify-default', 'main')?.roles ?? {}
  const own: Partial<Setting> = (vacancy && s.find('notify-pref', prefId(email, vacancy.id))?.events?.[event]) || {}
  const roles = vacancy ? rolesOn(vacancy, email) : []
  const setting = { ...base }
  for (const ch of CHANNELS) setting[ch] = own[ch] ?? roles.map(r => defaults[r]?.[event]?.[ch]).find(Boolean) ?? base[ch]
  return { setting, own }
}

/** The next 8:00 in the business's time zone after `at`. */
export function nextMorning(s: State, at: number) {
  const zone = businessZone(s.find('business', 'main')), wall = toWall(at, zone)
  let target = wall - (wall % 86_400_000) + DIGEST_HOUR * 3_600_000
  if (target <= wall) target += 86_400_000
  return Date.parse(fromWall(target, zone))
}
