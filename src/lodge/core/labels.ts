// How a vacancy's stored keys read to people, in the workspace and on the application pages.
export const WORK_MODES: Record<string, string> = { onsite: 'On site', hybrid: 'Hybrid', remote: 'Remote' }
export const EMPLOYMENT_TYPES: Record<string, string> = { 'full-time': 'Full-time', 'part-time': 'Part-time', contract: 'Contract', temporary: 'Temporary' }
export const vacancyFacts = (v: { department?: string; location?: string; workMode?: string; employmentType?: string }, withDepartment = true) =>
  [withDepartment ? v.department : '', v.location, v.workMode && (WORK_MODES[v.workMode] ?? v.workMode), v.employmentType && (EMPLOYMENT_TYPES[v.employmentType] ?? v.employmentType)].filter(Boolean) as string[]

// Pay and times on the application pages, in the house style the homepage writes:
// "$102,000–$124,000 a year" and "Sun Oct 18, 2026, 2:26 a.m. UTC".
const PER: Record<string, string> = { year: 'a year', month: 'a month', hour: 'an hour' }
export function payRange(c: { currency: string; min: number; max: number; period: string }) {
  const digits = c.min % 100 || c.max % 100 ? 2 : 0
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: c.currency, minimumFractionDigits: digits, maximumFractionDigits: digits })
  return `${amount.format(c.min / 100)}–${amount.format(c.max / 100)} ${PER[c.period] ?? `per ${c.period}`}`
}
export function dateTime(iso: string, timeZone = 'UTC') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone, timeZoneName: 'short' })
    .formatToParts(new Date(iso)).map(p => [p.type, p.value]))
  return `${parts.weekday} ${parts.month} ${parts.day}, ${parts.year}, ${parts.hour}:${parts.minute} ${parts.dayPeriod === 'AM' ? 'a.m.' : 'p.m.'} ${parts.timeZoneName}`
}
