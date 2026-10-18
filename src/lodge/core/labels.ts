// How a vacancy's stored keys read to people, in the workspace and on the application pages.
export const WORK_MODES: Record<string, string> = { onsite: 'On site', hybrid: 'Hybrid', remote: 'Remote' }
export const EMPLOYMENT_TYPES: Record<string, string> = { 'full-time': 'Full-time', 'part-time': 'Part-time', contract: 'Contract', temporary: 'Temporary' }
export const vacancyFacts = (v: { department?: string; location?: string; workMode?: string; employmentType?: string }, withDepartment = true) =>
  [withDepartment ? v.department : '', v.location, v.workMode && (WORK_MODES[v.workMode] ?? v.workMode), v.employmentType && (EMPLOYMENT_TYPES[v.employmentType] ?? v.employmentType)].filter(Boolean) as string[]

// Pay in US form: "$102,000–$124,000 a year", "$102k–$124k" on a chip; another currency keeps its code.
const PER: Record<string, string> = { year: 'a year', month: 'a month', hour: 'an hour' }
const per = (period: string) => PER[period] ?? '/ ' + period

/** One amount in cents: "$112,000"; an hourly amount keeps its cents ("$19.50"); other currencies keep their code. */
export function amount(cents: number, currency = 'USD') {
  const whole = cents % 100 === 0
  const n = (cents / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })
  return currency === 'USD' ? '$' + n : `${currency} ${n}`
}

/** "$102,000–$124,000 a year", the range bound into one unbreakable unit. */
export const pay = (c: Record<string, any> | null) => c ? `${amount(c.min, c.currency)}–${amount(c.max, c.currency)}`.replace(/ /g, '\u00a0') + ' ' + per(c.period) : 'No range yet'
/** "$110,000 a year" */
export const money = (s: Record<string, any>) => `${amount(s.amount, s.currency)} ${per(s.period)}`

/** "$102k–$124k" for a yearly range, "$19–$22/hr" for an hourly one: the chip on a job header. */
export function payShort(c: Record<string, any> | null) {
  if (!c) return 'No range yet'
  const k = (cents: number) => c.period === 'year' && cents % 100000 === 0 ? amount(cents / 1000, c.currency) + 'k' : amount(cents, c.currency)
  return `${k(c.min)}–${k(c.max)}${c.period === 'hour' ? '/hr' : c.period === 'month' ? '/mo' : ''}`
}

