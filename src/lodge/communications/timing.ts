import type { State } from '../core/state'
import { businessZone, times, toWall } from '../core/time'
import { canonical, requireThat, type Actor, type Data } from '../core/types'
import { isAdmin, requireCan, requireManages } from '../core/access'
import { addDays, occurrence } from '../reports/calendar'

export const TIMING_RULE = 'Count eligible local days after the committed event, preserving its local hour and minute. Repeated daylight-saving times use the first occurrence; a missing time moves forward to the first valid minute that day. Late scheduler calls keep the frozen due time. A later stage change, withdrawal, hire or closed job cancels pending status mail.'
export const immediateTiming = { delayDays: 0, weekdays: [1, 2, 3, 4, 5], timeZone: 'UTC' }
export const statusTiming = (job: Data) => job.applicationEmailTiming ?? immediateTiming
export const sameTiming = (a: Data, b: Data) => canonical(a) === canonical(b)

export function configureStatusTiming(s: State, a: Actor, b: Data) {
  requireThat(isAdmin(a) && !a.agent, 'Only a human owner or hiring admin can review status timing', 403)
  const job = s.get('vacancy', b.vacancy)
  requireManages(a, job); requireCan(s, a, job, 'settings'); requireCan(s, a, job, 'contact')
  requireThat(!job.imported && job.status !== 'closed', 'Choose a current vacancy', 409)
  const t = b.timing
  requireThat(t && Number.isInteger(t.delayDays) && t.delayDays >= 0 && t.delayDays <= 60, 'Choose zero to sixty eligible days')
  requireThat(Array.isArray(t.weekdays) && t.weekdays.length > 0 && t.weekdays.every((d: unknown) => Number.isInteger(d) && Number(d) >= 0 && Number(d) <= 6), 'Choose eligible weekdays')
  const timeZone = businessZone(s.get('business', 'main'))
  requireThat(t.timeZone === timeZone, 'Review timing in the current business time zone', 409)
  return s.put('vacancy', job.id, { ...job, applicationEmailTimingBy: a.email, applicationEmailTiming: { delayDays: t.delayDays, weekdays: [...new Set<number>(t.weekdays)].sort(), timeZone } })
}

export function statusDue(timing: Data, eventAt: string) {
  if (!timing.delayDays) return eventAt
  const local = new Date(toWall(Date.parse(eventAt), timing.timeZone)).toISOString()
  let date = local.slice(0, 10), left = timing.delayDays
  while (left > 0) {
    date = addDays(date, 1)
    if (timing.weekdays.includes(new Date(date + 'T12:00:00Z').getUTCDay())) left--
  }
  return occurrence(date, local.slice(11, 16), timing.timeZone)
}
export function timingLabel(timing: Data) {
  return timing.delayDays ? `${timing.delayDays} eligible local days; ${timing.weekdays.map((d: number) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}; ${timing.timeZone}` : 'Immediately after the committed stage event'
}
export const dueLabel = (due: string, timing: Data) => times(timing.timeZone).stamped(due)
