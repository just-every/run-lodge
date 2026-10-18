export { amount, money, pay, payShort } from '../lodge/core/labels'

// How times read in the workspace: the house date style ("Thu Oct 22, 2026, 10:00 a.m.") in the viewer's own
// time zone. Money reads the same here and on the application pages (core/labels).

const parts = (iso: string, options: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('en-US', options)
/** "10:00 a.m." */
export const clock = (iso: string) => parts(iso, { hour: 'numeric', minute: '2-digit' }).replace('AM', 'a.m.').replace('PM', 'p.m.')
/** "Thu Oct 22" */
export const weekday = (iso: string) => `${parts(iso, { weekday: 'short' })} ${parts(iso, { month: 'short', day: 'numeric' })}`
/** "Thu Oct 22, 10:00 a.m." */
export const slot = (iso: string) => `${weekday(iso)}, ${clock(iso)}`
/** "Thu Oct 22, 2026, 10:00 a.m." */
export const when = (iso?: string) => iso ? `${weekday(iso)}, ${new Date(iso).getFullYear()}, ${clock(iso)}` : ''
/** "Mon Nov 9, 2026" for a calendar date such as 2026-11-09. */
export const day = (date?: string) => {
  if (!date) return ''
  const iso = date.length === 10 ? date + 'T12:00:00' : date
  return `${weekday(iso)}, ${new Date(iso).getFullYear()}`
}
/** "8:12 a.m." today, "Fri Oct 16" this year, else the full date. */
export const recent = (iso: string) => {
  const d = new Date(iso), now = new Date()
  if (d.toDateString() === now.toDateString()) return clock(iso)
  return d.getFullYear() === now.getFullYear() ? weekday(iso) : day(iso)
}
/** "1 day", "6 days", "today": how long since `iso`. */
export const since = (iso?: string) => {
  if (!iso) return ''
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000)
  return days < 1 ? 'today' : days === 1 ? '1 day' : `${days} days`
}
