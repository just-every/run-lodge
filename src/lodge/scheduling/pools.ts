import type { State } from '../core/state'
import { canReview, managesVacancy, requireCan, requireManages } from '../core/access'
import { email, instant, integer, list, now, requireThat, text, type Actor, type Data } from '../core/types'
import { isZone } from '../core/time'

/** Employer declarations for draft feasibility only. Membership never grants candidate access. */
export function schedulingAuthority(s: State, a: Actor, vacancy: Data) {
  requireThat(!a.agent, 'Only a human can review interview-day drafts', 403)
  requireManages(a, vacancy)
  requireCan(s, a, vacancy, 'settings')
}

export const eligible = (m: Data | undefined) => !!m?.active && !m.agent && canReview({ owner: m.owner, roles: m.roles })
export const words = (value: unknown, label: string) => [...new Set(list(value, label, 12, x => text(x, label, 80)))]
export function windows(value: unknown, label: string) {
  return list(value, label, 24, (x: any) => {
    const start = instant(x?.start, label + ' start'), end = instant(x?.end, label + ' end')
    requireThat(Date.parse(start) < Date.parse(end), label + ' must end after it starts')
    return { start, end }
  })
}
export function clock(value: unknown, label: string) {
  requireThat(typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value), label + ' must be HH:MM')
  return value
}

export function savePool(s: State, a: Actor, b: Data) {
  const vacancy = s.get('vacancy', b.vacancy)
  schedulingAuthority(s, a, vacancy)
  requireThat(!vacancy.imported && vacancy.status !== 'closed', 'Choose a current native job', 409)
  const old = s.find('interviewer-pool', vacancy.id)
  requireThat(b.version === (old?.version ?? 0), 'Pool configuration changed; reload Settings', 409)
  const members = list(b.members, 'Pool members', 8, (x: any) => {
    const who = email(x?.email), member = s.find('member', who)
    requireThat(eligible(member), 'Pool members must be active human interviewers')
    requireThat(isZone(x.timezone), 'Choose a valid interviewer time zone')
    const workStart = clock(x.workStart, 'Working start'), workEnd = clock(x.workEnd, 'Working end')
    requireThat(workStart < workEnd, 'Working hours must end after they start on the same day')
    const weekdays = [...new Set(list(x.weekdays, 'Working weekdays', 7, d => integer(d, 'Weekday', 0, 6)))]
    requireThat(weekdays.length > 0, 'Choose at least one working weekday')
    return { email: who, qualifications: words(x.qualifications, 'Qualifications'), timezone: x.timezone,
      dailyCap: integer(x.dailyCap, 'Daily session cap', 1, 20), breakMinutes: integer(x.breakMinutes, 'Interviewer break', 0, 180),
      workStart, workEnd, weekdays, availability: windows(x.availability, 'Recorded availability'), evidence: text(x.evidence, 'Availability and qualification source', 500) }
  })
  requireThat(members.length > 0 && new Set(members.map(m => m.email)).size === members.length, 'Choose distinct pool members')
  const rooms = list(b.rooms, 'Declared rooms', 8, (x: any) => ({ name: text(x?.name, 'Room name', 80), availability: windows(x.availability, 'Room availability'), busy: windows(x.busy ?? [], 'Room busy times'), evidence: text(x.evidence, 'Room source', 500) }))
  requireThat(new Set(rooms.map(r => r.name)).size === rooms.length, 'Use distinct room names')
  const version = (old?.version ?? 0) + 1
  const entry = { version, name: text(b.name, 'Pool name', 120), members, rooms, by: a.email, at: now() }
  const record = s.put('interviewer-pool', vacancy.id, { vacancy: vacancy.id, version, versions: [...(old?.versions ?? []), entry] })
  s.audit(a, 'interviewer-pool-declared', 'vacancy:' + vacancy.id, { version })
  return record
}

export const poolJobs = (s: State, a: Actor) => !a.agent ? s.all('vacancy').filter(v => !v.imported && managesVacancy(a, v) && v.status !== 'closed').filter(v => {
  try { requireCan(s, a, v, 'settings'); return true } catch { return false }
}) : []
