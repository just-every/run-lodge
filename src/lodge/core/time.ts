// How times read everywhere Lodge writes them (the workspace, the applicant pages, the demo's emails and agent
// text): the house date style ("Thu Oct 22, 2026, 10:00 a.m.") in the business's own time zone, never the
// viewer's clock and never bare UTC. One formatter per zone; every surface asks for the business's.

/** True when `zone` is an IANA time zone this runtime knows. */
export function isZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || !zone) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true } catch { return false }
}

const AMPM = (s: string) => s.replace('AM', 'a.m.').replace('PM', 'p.m.')

/** Minutes `zone` is ahead of UTC at `ms` (negative in the US). */
export function zoneOffset(ms: number, zone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ms / 60000) * 60000) / 60000
}

/** The instant a wall-clock time in `zone` names: `wall` is milliseconds as if that wall time were UTC. */
export const fromWall = (wall: number, zone: string) => new Date(wall - zoneOffset(wall - zoneOffset(wall, zone) * 60000, zone) * 60000).toISOString()

/** The wall-clock time of `ms` in `zone`, as milliseconds read as UTC (so getUTCDay() is the local weekday). */
export const toWall = (ms: number, zone: string) => ms + zoneOffset(ms, zone) * 60000

/** "2026-10-22T14:30" (a datetime-local value) in `zone` as an ISO instant. */
export function instantOf(local: string, zone: string) {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(local)
  if (!m) throw new Error('Enter a date and time')
  return fromWall(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]), zone)
}

/** Every time label for one zone. Calendar dates (2026-11-09) name a day, not an instant, and read the same anywhere. */
export function times(zone: string) {
  const part = (iso: string, options: Intl.DateTimeFormatOptions, tz = zone) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...options }).format(new Date(iso))
  const dateOnly = (d: string) => d.length === 10
  const instant = (d: string) => dateOnly(d) ? d + 'T12:00:00Z' : d
  const tzOf = (d: string) => dateOnly(d) ? 'UTC' : zone
  /** "10:00 a.m." */
  const clock = (iso: string) => AMPM(part(iso, { hour: 'numeric', minute: '2-digit' }))
  /** "Thu Oct 22" */
  const weekday = (iso: string) => `${part(instant(iso), { weekday: 'short' }, tzOf(iso))} ${part(instant(iso), { month: 'short', day: 'numeric' }, tzOf(iso))}`
  const year = (iso: string) => part(instant(iso), { year: 'numeric' }, tzOf(iso))
  /** "2026-10-22": the calendar day of an instant in this zone. */
  const dateOf = (iso: string) => new Date(toWall(Date.parse(instant(iso)), tzOf(iso))).toISOString().slice(0, 10)
  return {
    zone, clock, weekday, year, dateOf,
    /** "Thu Oct 22, 10:00 a.m." */
    slot: (iso: string) => `${weekday(iso)}, ${clock(iso)}`,
    /** "Thu Oct 22, 2026, 10:00 a.m." */
    when: (iso?: string) => iso ? `${weekday(iso)}, ${year(iso)}, ${clock(iso)}` : '',
    /** "Mon Nov 9, 2026" for a calendar date or an instant. */
    day: (date?: string) => date ? `${weekday(date)}, ${year(date)}` : '',
    /** "Thursday, October 22 at 2:30 p.m.": the long form an email uses. */
    spoken: (iso: string) => `${part(iso, { weekday: 'long', month: 'long', day: 'numeric' })} at ${clock(iso)}`,
    /** "Eastern Time" */
    name: () => part(new Date().toISOString(), { timeZoneName: 'longGeneric' }).split(', ').at(-1) ?? zone,
    /** "Thu Oct 22, 2026, 10:00 a.m. EDT": a time stated on its own, with the zone it is in. */
    stamped: (iso: string) => {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: zone, timeZoneName: 'short' }).formatToParts(new Date(iso)).map(x => [x.type, x.value]))
      return `${p.weekday} ${p.month} ${p.day}, ${p.year}, ${p.hour}:${p.minute} ${p.dayPeriod === 'AM' ? 'a.m.' : 'p.m.'} ${p.timeZoneName}`
    },
  }
}

export type Times = ReturnType<typeof times>

/** The zone a business keeps its times in: the one its owner chose at setup. */
export const businessZone = (business: { timeZone?: string } | null | undefined) => business?.timeZone && isZone(business.timeZone) ? business.timeZone : 'UTC'
