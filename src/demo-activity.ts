import { State, type Row } from './lodge/core/state'
import { run } from './lodge/commands'
import { deleteCandidate } from './lodge/records/retention'
import { ROLES, type Actor, type Data } from './lodge/core/types'

/** A past applicant whose record was deleted at his request; real ids are UUIDs, and the receipt shows the first eight characters. */
export const DELETED = '7d41c2e8-5b9a-4f03-9e6d-2a8b1c4f6e90'
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
const ISO = /^\d{4}-\d\d-\d\dT/

/**
 * The sample time `days` from now. Earlier days fall at a different time of day each,
 * not all at the visitor's start minute; later days fall on the hour.
 */
export function demoAt(now: Date, days: number): string {
  const time = now.getTime() + days * 86400000
  if (days > 0) return new Date(Math.ceil(time / 3600000) * 3600000).toISOString()
  if (days > -0.5) return new Date(time).toISOString()
  // An earlier moment keeps its date and its order but falls in the working day, 8 a.m. to 6 p.m. in
  // Columbus, at a different minute each day; the last half day stays as it was, still before now.
  const at = time - (37 + (Math.round(-days * 53) % 9) * 31) * 60000
  const offset = zoneOffset(at) * 60000, wall = at + offset, midnight = wall - (wall % 86400000)
  return new Date(midnight + 8 * 3600000 + (wall - midnight) * 10 / 24 - offset).toISOString()
}

const ZONE = 'America/New_York'

/** Minutes the sample's zone is ahead of UTC at `ms` (negative in the US). */
function zoneOffset(ms: number) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(ms)).map(p => [p.type, p.value]))
  return (Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) - Math.floor(ms / 60000) * 60000) / 60000
}

/**
 * The sample business's week, in its own time zone (Columbus, Ohio). Booked interviews and start dates fall on
 * named weekdays counted from `monday`: this week's Monday early in the week, next Monday from Thursday on, so a
 * Thursday panel is always still ahead and every drawn weekday matches the calendar.
 */
export function easternWeek(now: Date) {
  const local = new Date(now.getTime() + zoneOffset(now.getTime()) * 60000)
  const dow = local.getUTCDay()
  const shift = dow === 0 ? 1 : dow <= 3 ? 1 - dow : 8 - dow
  const monday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + shift)
  /** `days` after that Monday at `hour`:`minute` in Columbus, as an ISO instant. */
  const at = (days: number, hour: number, minute = 0) => {
    const wall = monday + days * 86400000 + (hour * 60 + minute) * 60000
    return new Date(wall - zoneOffset(wall - zoneOffset(wall) * 60000) * 60000).toISOString()
  }
  return { zone: ZONE, at, date: (days: number) => new Date(monday + days * 86400000).toISOString().slice(0, 10) }
}

const inZone = (iso: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: ZONE, ...options }).format(new Date(iso))
const clock = (iso: string) => inZone(iso, { hour: 'numeric', minute: '2-digit' }).replace('AM', 'a.m.').replace('PM', 'p.m.')
/** "Thursday, October 22 at 2:30 p.m." and "Thu Oct 22 at 2:30 p.m.", in the business's own time zone. */
const long = (iso: string) => `${inZone(iso, { weekday: 'long', month: 'long', day: 'numeric' })} at ${clock(iso)}`
const short = (iso: string) => `${inZone(iso, { weekday: 'short' })} ${inZone(iso, { month: 'short', day: 'numeric' })} at ${clock(iso)}`

function rewrite(value: unknown, change: (s: string) => string): unknown {
  if (typeof value === 'string') return change(value)
  if (Array.isArray(value)) return value.map(v => rewrite(v, change))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v, change)]))
  return value
}

/**
 * The workspace's recent history, made by Lodge's own commands on the sample records:
 * an agent member and its proposals, candidate requests and a deletion receipt.
 * Each step's timestamps move to the day it happened, and new ids become fixed ids,
 * so seeding stays idempotent.
 */
export async function demoActivity(rows: Row[], ownerEmail: string, now: Date): Promise<Row[]> {
  const s = new State(rows)
  const at = (days: number) => demoAt(now, days)
  const week = easternWeek(now)
  const agentEmail = 'maya-agent@fernway.example', lena = 'lena@fernway.example', ana = 'ana@fernway.example', dev = 'dev@fernway.example'
  const owner: Actor = { id: 'demo-owner', email: ownerEmail, name: 'Maya Torres', session: '', version: 0, owner: true, roles: [...ROLES], agent: false }
  const agent: Actor = { id: 'demo-agent', email: agentEmail, name: 'Maya’s coordinator agent', session: '', version: 0, owner: false, roles: [...ROLES], agent: true, scopeAs: ownerEmail }
  const step = async (days: number, action: () => unknown) => {
    const started = new Date().toISOString()
    await action()
    const finished = new Date(Date.now() + 1000).toISOString()
    for (const write of s.pending().writes) if (write.value) s.put(write.kind, write.id, rewrite(write.value, v => ISO.test(v) && v >= started && v <= finished ? at(days) : v) as Data)
  }
  const draft = (application: string, purpose: string, subject: string, body: string) => ({ op: 'message', input: { application, purpose, subject, body } })
  const applicationOf = (name: string) => { const c = s.all('candidate').find(x => x.name === name)!; return s.all('application').find(x => x.candidate === c.id)! }
  const sign = '\nBest,\nMaya Torres\nHead of Operations, Fernway'

  await step(-17, () => run(s, owner, 'move', { application: 'demo-application-owen', to: 'withdrawn', reason: 'Accepted another offer before the screen.' }))
  await step(-16, () => deleteCandidate(s, owner, { candidate: DELETED, confirm: 'Owen Hart', reason: 'Asked us to delete his application' }))
  await step(-10, () => run(s, owner, 'member', { email: agentEmail, name: 'Maya’s coordinator agent', agent: true, actsFor: ownerEmail }))
  const ben = 'demo-candidate-ben', grace = applicationOf('Grace Liu').candidate
  await step(-9, () => run(s, owner, 'data-request', { candidate: grace, type: 'access', receivedAt: at(-9).slice(0, 10), channel: 'email', note: 'Asked what we hold about her.' }))
  const access = s.all('data-request').find(r => r.candidate === grace)!
  await step(-7, () => run(s, owner, 'complete-data-request', { id: access.id, outcome: 'Sent her candidate export from hiring@fernway.example' }))
  await step(-1, () => run(s, owner, 'data-request', { candidate: ben, type: 'correction', receivedAt: at(-1).slice(0, 10), channel: 'phone', note: 'New phone number to follow by email.' }))

  const liam = applicationOf('Liam O’Connor'), avery = applicationOf('Avery Chen')
  await step(-3, () => run(s, agent, 'propose', {
    workflow: 'coordination', approver: ownerEmail, sources: [{ kind: 'application', id: liam.id }, { kind: 'interview', id: 'demo-interview-liam-1' }],
    summary: 'Ask Liam O’Connor which of the proposed times suit him', rationale: 'Dev and Ana have answered for Liam’s Panel 1; Liam has not chosen a time yet.',
    changes: [draft(liam.id, 'availability-request', 'Times for your Fernway panel', `Hi Liam,\nThank you for your time so far. Please choose the times that work for your portfolio review with Dev, Ana and me from the link in this email.${sign}`)],
  }))
  await step(-2.8, () => run(s, owner, 'decide-proposal', { id: s.all('proposal')[0].id, decision: 'approved', reason: 'Good; I will send it with the link.' }))
  await step(-1, () => run(s, agent, 'propose', {
    workflow: 'coordination', approver: ownerEmail, sources: [{ kind: 'application', id: avery.id }],
    summary: 'Acknowledge Avery Chen’s application', rationale: 'Avery applied yesterday and has not heard from us.',
    changes: [draft(avery.id, 'acknowledgement', 'Thanks for applying to Fernway', `Hi Avery,\nThank you for applying for the Product Designer role. I will review your application this week and let you know about next steps.${sign}`)],
  }))
  await step(-0.9, () => run(s, owner, 'decide-proposal', { id: s.all('proposal')[1].id, decision: 'approved', reason: 'Clear and kind.' }))

  // Thursday's exception: Lena Brooks is out sick for Jordan's Panel 2. The agent offers three ways through, each one
  // cancel-and-rebook with its candidate email; Maya picks one and the other two lapse.
  const jordan = applicationOf('Jordan Ellis'), panel = s.get('interview', 'demo-interview-jordan-2')
  const where = 'Juniper room · 1150 Goodale Blvd'
  const options: [summary: string, participants: string[], start: string, line: string][] = [
    ['Swap in Ana Ruiz for Lena Brooks and rebook Panel 2', [ana, dev, ownerEmail], week.at(3, 14, 30), `Lena Brooks is out sick, so we would like to move your panel interview to ${long(week.at(3, 14, 30))}, in the Juniper room. Ana Ruiz will join in Lena’s place; the rest of the panel is the same.`],
    ['Keep Panel 2 at 10:00 a.m. with Dev Kapoor and Maya Torres', [dev, ownerEmail], panel.start, `Lena Brooks is out sick, so your panel interview on ${long(panel.start)} will be with Dev Kapoor and me. Nothing else changes.`],
    ['Move Panel 2 to Friday with the same panel', [lena, dev, ownerEmail], week.at(4, 10), `Lena Brooks is out sick, so we would like to move your panel interview to ${long(week.at(4, 10))}, in the Juniper room, with the same panel.`],
  ]
  for (const [summary, participants, start, line] of options) await step(-0.05, () => run(s, agent, 'propose', {
    workflow: 'coordination', approver: ownerEmail, sources: [{ kind: 'application', id: jordan.id }, { kind: 'interview', id: panel.id }],
    summary, rationale: `Lena Brooks is out sick for Thursday’s panel: “Fever, can’t make it on Thursday. Sorry!” Ana Ruiz is free ${short(week.at(3, 14, 30))} (“Happy to step in!”).`,
    changes: [
      { op: 'cancel-interview', input: { interview: panel.id, reason: 'Lena Brooks is out sick' } },
      { op: 'interview', input: { application: jordan.id, planItem: panel.planItem, participants, slots: [start], location: where, timezone: week.zone } },
      { op: 'schedule', input: { interview: { $result: 1 }, slot: 0 } },
      draft(jordan.id, 'interview-invitation', 'A new time for your Fernway panel', `Hi Jordan,\n${line}\nDoes this work for you?${sign}`),
    ],
  }))

  const result = new Map(rows.map(row => [row.kind + '\u0000' + row.id, row]))
  const fixed = new Map<string, string>(), counts = new Map<string, number>()
  for (const { kind, id } of s.pending().writes) if (new RegExp(`^${UUID.source}$`).test(id) && !fixed.has(id) && !result.has(kind + '\u0000' + id)) {
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
    fixed.set(id, `demo-${kind}-${counts.get(kind)}`)
  }
  for (const { kind, id, value } of s.pending().writes) {
    const key = kind + '\u0000' + id, fixedId = fixed.get(id) ?? id
    result.delete(key)
    if (value) result.set(kind + '\u0000' + fixedId, { kind, id: fixedId, revision: 'demo-v1', value: rewrite(value, v => v.replace(UUID, m => fixed.get(m) ?? m)) as Data })
  }
  return [...result.values()]
}
