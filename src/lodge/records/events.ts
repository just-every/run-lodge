import type { State } from '../core/state'
import { canSeeApplication, cleared, isAdmin, managesVacancy, requireManages, requireMember, requireRole, seesEvent } from '../core/access'
import { date, email, integer, list, money, now, oneOf, optionalEmail, optionalText, requireThat, scope, text, uid, type Actor, type Data } from '../core/types'
import { candidateFields, retentionUntil, startApplication } from './candidates'
import { storeDocument } from './documents'
import { ensureSource, initialCredit } from './sources'
import { cpraNotice, inCalifornia, requireCpraNotice } from './privacy'

// CRM-009: recruiting events. Recruiters create an event with its date, place,
// owner, linked jobs and USD budget, and record its costs. People join the
// event's pool two ways: staff capture them on a phone or tablet (offline too;
// the browser keeps unsynced captures and syncs each once, by its capture id),
// or attendees register themselves at the event's QR link while it is open.
// Every capture is a new candidate with source "Event: <name>", the privacy
// notice version shown and their consent to contact; a person already known is
// left to LDG-005 duplicate review, never merged. Nobody gets an application
// until a recruiter adds them to one of the event's linked jobs.

export const EVENT_KINDS = ['career-fair', 'campus', 'meetup', 'virtual'] as const
/** Attendees registering themselves: attempts per client IP per clock hour (fair wifi shares one IP; the board API keeps 10). */
export const REGISTRATIONS_PER_HOUR = 60

export const eventSource = (e: Data) => `Event: ${e.name}`

/** The event owner and admins run the event: its details, costs and registration. */
const runsEvent = (a: Actor, e: Data) => isAdmin(a) || e.owner === scope(a)

/** An event the reader does not see answers as not found, so ids cannot be probed. */
function seenEvent(s: State, a: Actor, id: unknown) {
  const e = s.find('event', id)
  requireThat(e && seesEvent(s, a, e), 'Event not found', 404)
  return s.get('event', e.id)
}

/** The events whose pools hold this candidate. */
export const eventsOf = (s: State, candidate: string) => s.all('event-capture').filter(r => r.candidate === candidate).map(r => s.find('event', r.event)).filter(Boolean) as Data[]

function linkedJobs(s: State, a: Actor, value: unknown) {
  const ids = [...new Set(list(value ?? [], 'Linked jobs', 20, (x, i) => text(x, `Linked job ${i + 1}`, 64)))]
  for (const id of ids) {
    const v = s.get('vacancy', id, 'Job')
    requireManages(a, v)
    requireThat(!v.imported, 'Imported jobs are kept as history', 409)
  }
  return ids
}

/** Recruiters create an event, or with `id` change one they run. */
export function event(s: State, a: Actor, b: Data) {
  requireRole(a, 'admin', 'manager')
  const current = b.id ? seenEvent(s, a, b.id) : null
  if (current) requireThat(runsEvent(a, current), 'Only the event’s owner or a hiring admin changes it', 403)
  const owner = requireMember(s, email(b.owner ?? a.email, 'Event owner')).email
  // A linked job the editor is not cleared for stays linked: they neither see nor change it.
  const unseen = (current?.jobs ?? []).filter((id: string) => !cleared(a, s.find('vacancy', id), 'confidential'))
  const fields = {
    name: text(b.name, 'Event name', 120), kind: oneOf(b.kind, EVENT_KINDS, 'Event type'), date: date(b.date, 'Event date'),
    location: text(b.location, 'Where it is', 200), owner, jobs: [...new Set([...linkedJobs(s, a, b.jobs), ...unseen])], budget: money(b.budget ?? 0, 'Budget (USD cents)'),
  }
  requireThat(!s.all('event').some(e => e.id !== current?.id && e.name.toLowerCase() === fields.name.toLowerCase()), 'Another event already has that name; event sources must stay distinct', 409)
  const record = s.put('event', current?.id ?? uid(), current ? { ...current, ...fields, updatedBy: a.email, updatedAt: now() } : { ...fields, status: 'open', token: uid().replace(/-/g, '') + uid().replace(/-/g, '').slice(0, 16), costs: [], createdBy: a.email, createdAt: now() })
  ensureSource(s, eventSource(record), 'event')
  s.audit(a, current ? 'event-changed' : 'event-created', 'event:' + record.id, { name: record.name })
  return record
}

/** The event's owner or an admin closes or reopens self-registration; staff capture is unaffected. */
export function eventStatus(s: State, a: Actor, b: Data) {
  const e = seenEvent(s, a, b.id)
  requireThat(runsEvent(a, e), 'Only the event’s owner or a hiring admin opens or closes registration', 403)
  const status = oneOf(b.status, ['open', 'closed'] as const, 'Registration')
  const record = s.put('event', e.id, { ...e, status, statusAt: now(), statusBy: a.email })
  s.audit(a, 'event-' + status, 'event:' + e.id)
  return record
}

/** Record what the event cost (booth, travel, swag), in USD cents; cost per hire divides these. */
export function eventCost(s: State, a: Actor, b: Data) {
  const e = seenEvent(s, a, b.id)
  requireThat(runsEvent(a, e), 'Only the event’s owner or a hiring admin records its costs', 403)
  const cost = { id: uid().slice(0, 8), label: text(b.label, 'What it was for', 200), amount: integer(b.amount, 'Amount (USD cents)', 1, 100_000_000_00), by: a.email, at: now() }
  const record = s.put('event', e.id, { ...e, costs: [...(e.costs ?? []), cost] })
  s.audit(a, 'event-cost', 'event:' + e.id, { label: cost.label, amount: cost.amount })
  return record
}

export interface Capture { name: unknown; email?: unknown; phone?: unknown; interests?: unknown; noticeVersion: unknown; cpraNoticeVersion?: unknown; noticeShown: unknown; consentToContact: unknown; resume?: { name: string; mediaType: string; base64: string } | null }

/**
 * Add one person to the event's pool: a new candidate with the event source,
 * the notice version they were shown and their contact consent. `captureId` is
 * the capturing browser's id for it, so a repeated sync adds nobody twice.
 */
async function capture(s: State, e: Data, input: Capture, by: string, captureId: string) {
  const key = `${e.id}:${captureId}`
  const earlier = s.find('event-capture', key)
  if (earlier) return { candidate: s.find('candidate', earlier.candidate), replayed: true }
  const notice = s.get('business', 'main').notices.at(-1)
  requireThat(String(input.noticeVersion) === String(notice.version), 'The privacy notice changed since this was captured; show the current notice and capture again', 409)
  // PRIV-001: at an event in California the person is also shown the CPRA notice, and its version is recorded.
  const cpra = inCalifornia(s, e) ? requireCpraNotice(s) : null
  if (cpra) requireThat(String(input.cpraNoticeVersion) === String(cpra.version), 'The California privacy notice changed since this was captured; show the current notice and capture again', 409)
  requireThat(input.noticeShown === true || input.noticeShown === 'yes', by === 'attendee' ? 'Confirm you have read the privacy notice' : 'Confirm the person was shown the privacy notice')
  const fields = candidateFields({ name: input.name, email: optionalEmail(input.email, 'Email'), phone: input.phone })
  requireThat(fields.email || fields.phone, 'Give an email address or a phone number so the recruiter can reach them')
  const source = eventSource(e)
  const candidate = s.put('candidate', uid(), {
    ...fields, interests: optionalText(input.interests, 'Interests', 1000), source, event: e.id, createdAt: now(), retainUntil: retentionUntil(s),
    consent: { basis: 'event-capture', noticeVersion: notice.version, ...(cpra ? { cpraNoticeVersion: cpra.version } : {}), talentPool: input.consentToContact === true || input.consentToContact === 'yes', at: now(), recordedBy: by },
  })
  if (input.resume) await storeDocument(s, { candidate: candidate.id, application: null, name: input.resume.name, mediaType: input.resume.mediaType, base64: input.resume.base64, kind: 'resume', source })
  s.put('event-capture', key, { event: e.id, captureId, candidate: candidate.id, by, at: now() })
  return { candidate, replayed: false }
}

const captureId = (value: unknown) => {
  const id = text(value, 'Capture id', 64)
  requireThat(/^[A-Za-z0-9-]{8,64}$/.test(id), 'Capture id must be 8 to 64 letters, digits or dashes')
  return id
}

/** Staff who see the event sync a capture made on their phone or tablet, online or later. */
export async function eventCapture(s: State, a: Actor, b: Data) {
  const e = seenEvent(s, a, b.event)
  requireThat(isAdmin(a) || a.roles.includes('manager') || e.owner === scope(a), 'Only the event’s staff capture people at it', 403)
  const id = captureId(b.captureId)
  const result = await capture(s, e, b as Capture, a.email, id)
  if (!result.replayed) s.audit(a, 'event-captured', 'candidate:' + result.candidate!.id, { event: e.id })
  return { candidate: result.candidate?.id ?? null, replayed: result.replayed }
}

/** An attendee registers at the event's QR link while it is open. */
export async function selfRegister(s: State, token: string, input: Capture) {
  const e = eventByToken(s, token)
  requireThat(e.status === 'open', 'Registration for this event is closed', 410)
  const result = await capture(s, e, input, 'attendee', uid())
  s.audit(null, 'event-registered', 'candidate:' + result.candidate!.id, { event: e.id })
  return { event: e, noticeVersion: result.candidate!.consent.noticeVersion }
}

export function eventByToken(s: State, token: string) {
  requireThat(typeof token === 'string' && /^[a-f0-9]{48}$/.test(token), 'Not found', 404)
  const found = s.all('event').find(e => e.token === token)
  requireThat(found, 'Not found', 404)
  return s.get('event', found.id)
}

/** Only a recruiter adds someone from the pool to one of the event's linked jobs; the application keeps the event as its source. */
export function eventApply(s: State, a: Actor, b: Data) {
  const e = seenEvent(s, a, b.event)
  const vacancy = s.get('vacancy', b.vacancy, 'Job')
  requireThat((e.jobs ?? []).includes(vacancy.id), 'Add people from an event only to the jobs linked to it', 409)
  requireManages(a, vacancy)
  const person = s.get('candidate', b.candidate, 'Candidate')
  requireThat(s.all('event-capture').some(r => r.event === e.id && r.candidate === person.id), 'That person is not in this event’s pool', 404)
  requireThat(!person.mergedInto && !person.deleted, 'This candidate record is closed', 409)
  const application = startApplication(s, a, person, vacancy, eventSource(e), { customValues: b.customValues, event: e.id, credit: initialCredit(s, a, vacancy, {}) }, `Added from ${eventSource(e)}`)
  s.audit(a, 'event-application', 'application:' + application.id, { event: e.id, vacancy: vacancy.id })
  return application
}

/**
 * The events a reader sees, each with its pool and report. Attendees are the
 * distinct open people in the pool (a merged capture counts as the person it
 * merged into); applications are those a recruiter added from the event;
 * interviews are the scheduled or proposed ones on those applications; hires are
 * those applications closed as hired. Cost per hire is the sum of the recorded
 * costs divided by hires, in USD cents rounded half up to the cent, and null
 * while there is no hire; the budget is shown beside it and never counted as a cost.
 * A reader sees only the linked jobs they are cleared for and the applications they may see.
 */
export function eventsView(s: State, a: Actor, canSee: (candidate: Data) => boolean) {
  const notice = s.find('business', 'main')?.notices?.at(-1)?.version ?? null
  return s.all('event').filter(e => seesEvent(s, a, e)).sort((x, y) => y.date.localeCompare(x.date) || x.name.localeCompare(y.name)).map((e): Data => {
    const people = new Map<string, Data>()
    for (const r of s.all('event-capture').filter(r => r.event === e.id)) {
      const c = s.find('candidate', r.candidate)
      if (c && !c.deleted && !c.mergedInto) people.set(c.id, { candidate: c.id, name: c.name, email: c.email, phone: c.phone, interests: c.interests ?? '', source: c.source, consent: { basis: c.consent?.basis, noticeVersion: c.consent?.noticeVersion ?? null, toContact: c.consent?.talentPool === true }, by: r.by, at: r.at, visible: canSee(c) })
    }
    const apps = s.all('application').filter(x => x.event === e.id && x.status !== 'spam')
    const ids = new Set(apps.map(x => x.id))
    const hires = apps.filter(x => x.status === 'hired').length
    const spent = (e.costs ?? []).reduce((sum: number, c: Data) => sum + c.amount, 0)
    const runs = runsEvent(a, e)
    const jobs = (e.jobs as string[]).filter(id => cleared(a, s.find('vacancy', id), 'confidential'))
    return {
      ...e, jobs, token: runs ? e.token : undefined, runs, noticeVersion: notice, californiaNotice: inCalifornia(s, e) ? cpraNotice(s) : null,
      pool: [...people.values()].filter(p => p.visible).map(({ visible, ...p }) => ({ ...p, applications: s.all('application').filter(x => x.candidate === p.candidate && canSeeApplication(s, a, x)).map(x => ({ id: x.id, vacancy: x.vacancy, status: x.status })) })),
      report: {
        attendees: people.size, applications: apps.length,
        interviews: s.all('interview').filter(i => ids.has(i.application) && i.status !== 'cancelled').length,
        hires, costs: spent, budget: e.budget, costPerHire: hires ? Math.floor(spent / hires + 0.5) : null,
        byJob: jobs.map(id => ({ vacancy: id, title: s.find('vacancy', id)?.title ?? '', applications: apps.filter(x => x.vacancy === id).length, hires: apps.filter(x => x.vacancy === id && x.status === 'hired').length })),
      },
      managesJobs: jobs.filter(id => { const v = s.find('vacancy', id); return !!v && managesVacancy(a, v) }),
    }
  })
}
