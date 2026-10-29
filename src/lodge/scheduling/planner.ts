import type { State } from '../core/state'
import { requireApplication } from '../core/access'
import { canonical, email, instant, integer, list, now, requireThat, sha256, text, uid, type Actor, type Data } from '../core/types'
import { isZone, toWall } from '../core/time'
import { eligible, poolJobs, schedulingAuthority, windows, words } from './pools'

const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
const interval = (x: Data) => ({ start: Date.parse(x.start), end: Date.parse(x.end) })
const overlaps = (a: Data, b: Data, gap = 0) => a.start < b.end + gap * 60000 && b.start < a.end + gap * 60000
const covered = (ranges: Data[], at: Data) => {
  let through = at.start
  for (const w of ranges.map(interval).sort((x, y) => x.start - y.start)) {
    if (w.start > through) return false
    if (w.end > through) through = w.end
    if (through >= at.end) return true
  }
  return false
}
const localDay = (at: number, zone: string) => new Date(toWall(at, zone)).toISOString().slice(0, 10)
const sameDay = (x: Data, y: Data, zone: string) => localDay(x.start, zone) === localDay(y.start, zone)

/** Revisions fence both changed assignments and newly inserted native bookings. No provider is contacted. */
async function basis(s: State, app: Data, pool: Data) {
  const refs: unknown[] = [['application', app.id, s.revisionOf('application', app.id)], ['candidate', app.candidate, s.revisionOf('candidate', app.candidate)], ['vacancy', app.vacancy, s.revisionOf('vacancy', app.vacancy)], ['interviewer-pool', pool.id, s.revisionOf('interviewer-pool', pool.id)]]
  for (const kind of ['member', 'interview', 'permission-level', 'department', 'office', 'business'])
    refs.push([kind, s.scan(kind).map(r => [r.id, s.revisionOf(kind, r.id)]).sort((x, y) => String(x[0]).localeCompare(String(y[0])))])
  return sha256(canonical(refs))
}

function choices<T>(items: T[], count: number): T[][] {
  if (!count) return [[]]
  return items.flatMap((item, i) => choices(items.slice(i + 1), count - 1).map(rest => [item, ...rest]))
}

function solve(s: State, app: Data, config: Data, request: Data) {
  const failures = new Set<string>(), alternatives: Data[][] = []
  const fail = (message: string) => { if (failures.size < 80) failures.add(message); return false }
  const members = new Map<string, Data>(config.members.map((m: Data) => [m.email, m]))
  const booked: Data[] = s.scan('interview').filter(i => i.status === 'scheduled' && i.start).map(i => ({ ...i, start: Date.parse(i.start), end: Date.parse(i.start) + i.durationMinutes * 60000 }))
  let attempts = 0, limited = false
  const fitsMember = (who: string, at: Data, selected: Data[], title: string) => {
    const m = members.get(who)
    if (!m || !eligible(s.find('member', who))) return fail(title + ': a declared participant is no longer eligible')
    if (!covered(m.availability, at)) return fail(title + ': ' + who + ' has no recorded availability for this time')
    const start = new Date(toWall(at.start, m.timezone)), end = new Date(toWall(at.end, m.timezone))
    if (start.toISOString().slice(0, 10) !== end.toISOString().slice(0, 10) || !m.weekdays.includes(start.getUTCDay()) || start.getUTCHours() * 60 + start.getUTCMinutes() < minutes(m.workStart) || end.getUTCHours() * 60 + end.getUTCMinutes() > minutes(m.workEnd))
      return fail(title + ': ' + who + ' is outside declared working hours')
    const work = [...booked.filter(i => i.participants.includes(who)), ...selected.filter(i => i.participants.includes(who))]
    if (work.some(i => overlaps(i, at, m.breakMinutes))) return fail(title + ': ' + who + ' has a native booking conflict or insufficient break')
    if (work.filter(i => sameDay(i, at, m.timezone)).length >= m.dailyCap) return fail(title + ': ' + who + ' exceeds the declared daily cap')
    return true
  }
  const search = (selected: Data[]) => {
    if (alternatives.length >= 5 || limited) return
    if (selected.length === request.sessions.length) {
      // Required attendance across the entire day takes precedence over optional attendance.
      const day: Data[] = selected.map(item => ({ ...item, participants: [...item.participants], omitted: [] as string[] }))
      for (const [i, item] of day.entries()) for (const who of item.optional) {
        const member = members.get(who)
        if (!request.excluded.includes(who) && member && item.qualifications.every((q: string) => member.qualifications.includes(q)) && fitsMember(who, item, day.filter((_, j) => i !== j), item.title)) item.participants.push(who)
        else item.omitted.push(who)
      }
      alternatives.push(day)
      return
    }
    const session = request.sessions[selected.length], title = session.title
    if (session.required.some((p: string) => request.excluded.includes(p))) { fail(title + ': required participant was excluded; revise the required panel'); return }
    const qualified = config.members.filter((m: Data) => eligible(s.find('member', m.email)) && session.qualifications.every((q: string) => m.qualifications.includes(q))).map((m: Data) => m.email)
    if (!session.required.every((p: string) => qualified.includes(p))) { fail(title + ': required participant lacks a current declared qualification'); return }
    const fill = qualified.filter((p: string) => !session.required.includes(p) && !session.optional.includes(p) && !request.excluded.includes(p))
    const panels = choices(fill, session.size - session.required.length).map(rest => [...session.required, ...rest])
    if (!panels.length) { fail(title + ': too few qualified pool members'); return }
    for (const start of session.starts) {
      const at = { start: Date.parse(start), end: Date.parse(start) + session.durationMinutes * 60000 }
      if (selected.length && localDay(at.start, request.candidateTimezone) !== localDay(selected[0].start, request.candidateTimezone)) { fail(title + ': sessions must be on the same candidate-local day'); continue }
      if (!covered(request.candidateAvailability, at)) { fail(title + ': candidate has no recorded availability'); continue }
      if (selected.some(i => overlaps(i, at, request.candidateBreakMinutes)) || booked.some(i => i.application === app.id && overlaps(i, at, request.candidateBreakMinutes))) { fail(title + ': candidate sessions overlap or have insufficient break'); continue }
      const room = config.rooms.find((r: Data) => r.name === session.room)
      if (session.room && (!room || !covered(room.availability, at) || room.busy.some((r: Data) => overlaps(interval(r), at)) || selected.some(i => i.room === session.room && overlaps(i, at)) || booked.some(i => i.location === session.room && overlaps(i, at)))) { fail(title + ': declared room is unavailable or occupied'); continue }
      for (const panel of panels) {
        if (++attempts > 20000) { limited = true; return }
        if (panel.some(who => request.excluded.includes(who) || !fitsMember(who, at, selected, title))) continue
        search([...selected, { ...at, planItem: session.planItem, title, startISO: start, endISO: new Date(at.end).toISOString(), participants: [...panel], required: session.required, optional: session.optional, qualifications: session.qualifications, omitted: [], room: session.room }])
        if (alternatives.length >= 5 || limited) return
      }
    }
  }
  search([])
  return { alternatives, conflicts: [...failures], searchLimited: limited }
}

export async function planDay(s: State, a: Actor, b: Data) {
  const app = requireApplication(s, a, b.application), vacancy = s.get('vacancy', app.vacancy)
  schedulingAuthority(s, a, vacancy)
  requireThat(app.status === 'active' && !app.imported, 'Choose an active native application', 409)
  const pool = s.get('interviewer-pool', vacancy.id), config = pool.versions.at(-1)
  requireThat(b.poolVersion === pool.version, 'Pool configuration changed; reload the planner', 409)
  requireThat(isZone(b.candidateTimezone), 'Choose a valid candidate time zone')
  const excluded = list(b.excluded ?? [], 'Excluded panellists', 8, x => email(x))
  const sessions = list(b.sessions, 'Draft sessions', 3, (x: any) => {
    const item = vacancy.plan.find((p: Data) => p.id === x?.planItem)
    requireThat(item, 'Choose a current interview-plan session')
    const required = [...new Set(list(x.required, 'Required participants', 4, p => email(p)))], optional = [...new Set(list(x.optional ?? [], 'Optional participants', 4, p => email(p)))]
    requireThat([...required, ...optional].every(p => config.members.some((m: Data) => m.email === p)) && !required.some(p => optional.includes(p)), 'Required and optional participants must be distinct declared pool members')
    const size = integer(x.size, 'Required panel size', 1, 4)
    requireThat(required.length <= size, 'Required participants exceed the panel size')
    const starts = [...new Set(list(x.starts, 'Explicit proposed starts', 4, t => instant(t, 'Session start')))].sort()
    requireThat(starts.length > 0, 'Record at least one proposed start')
    const room = x.room ? text(x.room, 'Room', 80) : ''
    requireThat(!room || config.rooms.some((r: Data) => r.name === room), 'Choose a declared room')
    return { planItem: item.id, title: item.name, durationMinutes: item.durationMinutes, qualifications: words(x.qualifications, 'Required qualifications'), required, optional, size, starts, room }
  })
  requireThat(sessions.length > 0, 'Choose at least one draft session')
  const request = { sessions, excluded, candidateTimezone: b.candidateTimezone, candidateAvailability: windows(b.candidateAvailability, 'Recorded candidate availability'), candidateBreakMinutes: integer(b.candidateBreakMinutes ?? 0, 'Candidate break', 0, 180) }
  const result = solve(s, app, config, request), fingerprint = await basis(s, app, pool)
  const record = s.put('interview-day', uid(), { application: app.id, vacancy: vacancy.id, poolVersion: pool.version, request, ...result, fingerprint, status: 'draft', createdBy: a.email, createdAt: now(), providerAvailability: 'unverified', resourceAvailability: 'manually-declared-unverified' })
  s.audit(a, 'interview-day-drafted', 'interview-day:' + record.id, { application: app.id })
  return record
}

export async function reviewDay(s: State, a: Actor, b: Data) {
  const draft = s.get('interview-day', b.id), app = requireApplication(s, a, draft.application)
  schedulingAuthority(s, a, s.get('vacancy', app.vacancy))
  const pool = s.get('interviewer-pool', app.vacancy)
  requireThat(app.status === 'active' && draft.status === 'draft', 'This draft is closed or already reviewed', 409)
  requireThat(b.fingerprint === draft.fingerprint && draft.fingerprint === await basis(s, app, pool), 'Draft is stale: members, assignments or configuration changed; plan again', 409)
  const alternative = integer(b.alternative, 'Alternative panel', 0, draft.alternatives.length - 1)
  const record = s.put('interview-day', draft.id, { ...draft, status: 'reviewed', review: { by: a.email, at: now(), alternative, fingerprint: draft.fingerprint } })
  s.audit(a, 'interview-day-reviewed', 'interview-day:' + draft.id, { application: app.id, alternative })
  return record
}

export async function schedulingView(s: State, a: Actor, appIds: Set<string>) {
  const jobs = poolJobs(s, a), ids = new Set(jobs.map(v => v.id))
  const pools = s.all('interviewer-pool').filter(p => ids.has(p.vacancy))
  const drafts = []
  for (const draft of s.all('interview-day').filter(d => ids.has(d.vacancy) && appIds.has(d.application))) {
    const app = s.get('application', draft.application), pool = s.find('interviewer-pool', draft.vacancy)
    drafts.push({ ...draft, stale: !pool || draft.fingerprint !== await basis(s, app, pool) })
  }
  return { jobs: jobs.map(v => v.id), pools, drafts }
}
