import { businessZone, fromWall, toWall } from '../core/time'
import type { State } from '../core/state'
import type { Data } from '../core/types'

/** Move forward into the next permitted business window, including daylight-saving changes. */
export function businessDue(s: State, plan: Data, at: number) {
  const zone = businessZone(s.get('business', 'main'))
  let wall = new Date(toWall(at, zone))
  for (let day = 0; day < 8; day++) {
    if (plan.weekdays.includes(wall.getUTCDay()) && wall.getUTCHours() < plan.endHour) {
      if (wall.getUTCHours() < plan.startHour) wall.setUTCHours(plan.startHour, 0, 0, 0)
      return fromWall(wall.getTime(), zone)
    }
    wall.setUTCDate(wall.getUTCDate() + 1); wall.setUTCHours(plan.startHour, 0, 0, 0)
  }
  throw new Error('No reminder business window')
}
