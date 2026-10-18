import { instantOf, times, type Times } from '../lodge/core/time'
export { amount, money, pay, payShort } from '../lodge/core/labels'

// How times read in the workspace: the house date style ("Thu Oct 22, 2026, 10:00 a.m.") in the business's own
// time zone (core/time), so the same screen says the same thing on any viewer's clock. The app sets the zone
// from the business record before it renders. Money reads the same here and on the application pages (core/labels).

let t: Times = times('UTC')
/** Read every time in `zone` from now on. */
export const useZone = (zone: string) => { if (t.zone !== zone) t = times(zone) }

/** "10:00 a.m." */
export const clock = (iso: string) => t.clock(iso)
/** "Thu Oct 22" */
export const weekday = (iso: string) => t.weekday(iso)
/** "Thu Oct 22, 10:00 a.m." */
export const slot = (iso: string) => t.slot(iso)
/** "Thu Oct 22, 2026, 10:00 a.m." */
export const when = (iso?: string) => t.when(iso)
/** "Mon Nov 9, 2026" for a calendar date such as 2026-11-09, or an instant. */
export const day = (date?: string) => t.day(date)
/** "Eastern Time": the zone every time on screen is in. */
export const zoneName = () => t.name()
/** "2026-10-22": an instant's calendar day in the business's zone. */
export const dateOf = (iso: string) => t.dateOf(iso)
/** A datetime-local value ("2026-10-22T14:30") read as the business's wall clock. */
export const instant = (local: string) => instantOf(local, t.zone)
/** "Today", "Yesterday", or "Fri Oct 16" (with the year when it is not this year). */
export const dayLabel = (iso: string) => {
  const d = dateOf(iso), today = dateOf(new Date().toISOString())
  if (d === today) return 'Today'
  if (d === new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10)) return 'Yesterday'
  return t.year(iso) === t.year(new Date().toISOString()) ? weekday(iso) : day(iso)
}
/** "8:12 a.m." today, "Fri Oct 16" this year, else the full date. */
export const recent = (iso: string) => {
  const label = dayLabel(iso)
  return label === 'Today' ? clock(iso) : label === 'Yesterday' ? `Yesterday, ${clock(iso)}` : label
}
/** "1 day", "6 days", "today": how long since `iso`. */
export const since = (iso?: string) => {
  if (!iso) return ''
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000)
  return days < 1 ? 'today' : days === 1 ? '1 day' : `${days} days`
}
/** Days from `iso` until now, whole; negative when it is still ahead. */
export const daysSince = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86400000)
