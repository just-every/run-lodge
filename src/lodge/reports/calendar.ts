import { fromWall, toWall } from '../core/time'
import { requireThat } from '../core/types'

export const CADENCE = 'Weekly at the reviewed local time. Repeated daylight-saving times use the first occurrence; a missing time moves forward to the first valid minute that day. Each report covers the preceding seven whole local calendar days, ending before its scheduled day. Delayed ticks keep that original period.'
export const addDays = (date: string, days: number) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10)
export function occurrence(date: string, clock: string, zone: string) {
  requireThat(/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date, 'Choose a valid first calendar date')
  requireThat(/^([01]\d|2[0-3]):[0-5]\d$/.test(clock), 'Choose a local time')
  const wall = Date.parse(date + 'T' + clock + ':00Z'), guess = Date.parse(fromWall(wall, zone))
  const choices: { instant: number; wall: number }[] = []
  for (let minute = -180; minute <= 180; minute++) {
    const instant = guess + minute * 60000, local = toWall(instant, zone)
    if (local >= wall && new Date(local).toISOString().slice(0, 10) === date) choices.push({ instant, wall: local })
  }
  choices.sort((a, b) => a.wall - b.wall || a.instant - b.instant)
  requireThat(choices.length > 0, 'This local date has no supported delivery time')
  return new Date(choices[0].instant).toISOString()
}
export const periodFor = (date: string) => ({ from: addDays(date, -7), to: addDays(date, -1) })
