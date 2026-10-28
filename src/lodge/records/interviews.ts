import type { State } from '../core/state'
import { canReview, managesVacancy, onPanel, requireApplication, requireManages, requireMember } from '../core/access'
import { email, instant, integer, list, now, oneOf, optionalText, requireThat, scope, text, uid, type Actor, type Data } from '../core/types'
import { businessZone, isZone } from '../core/time'
import { notifyInterview } from '../notify/emit'

// Flow 8: plan an interview from the vacancy's plan, collect availability from
// the panel and the candidate, schedule one slot and hand out calendar files.
// No calendar account is used; the .ics file is the invitation.

function token() {
  return [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function interview(s: State, a: Actor, b: Data) {
  const app = requireApplication(s, a, b.application)
  const vacancy = s.get('vacancy', app.vacancy)
  requireManages(a, vacancy)
  requireThat(app.status === 'active', 'This application is closed', 409)
  const item = vacancy.plan.find((p: Data) => p.id === b.planItem)
  requireThat(item, 'Choose an interview from the vacancy plan')
  const participants = list(b.participants, 'Interviewers', 8, p => email(p, 'Interviewer'))
  requireThat(participants.length > 0, 'Invite at least one interviewer')
  for (const p of participants) {
    const m = requireMember(s, p)
    requireThat(canReview({ owner: m.owner, roles: m.roles }), `${p} needs the interviewer role`)
  }
  const slots = list(b.slots, 'Proposed times', 12, x => instant(x, 'Proposed time'))
  requireThat(slots.length > 0, 'Propose at least one time')
  const record = s.put('interview', uid(), {
    application: app.id, vacancy: vacancy.id, planItem: item.id, title: `${item.name}: ${vacancy.title}`, durationMinutes: integer(b.durationMinutes ?? item.durationMinutes, 'Duration', 10, 480),
    participants: [...new Set(participants)], slots, availability: {}, candidateToken: token(), location: optionalText(b.location, 'Location or video link', 500), timezone: isZone(b.timezone) ? b.timezone : businessZone(s.find('business', 'main')),
    status: 'proposed', createdBy: a.email, createdAt: now(), observations: [{ kind: 'proposed', at: now() }],
  })
  s.audit(a, 'interview-proposed', 'interview:' + record.id)
  return record
}

/** The candidate's availability link is a credential for the people who run the job only. */
export const panelView = (a: Actor, vacancy: Data | undefined, iv: Data) => vacancy && managesVacancy(a, vacancy) ? iv : { ...iv, candidateToken: undefined }

function chosen(slots: string[], value: unknown) {
  return list(value, 'Available times', slots.length, i => { const n = integer(i, 'Time', 0, slots.length - 1); return n })
}

/** A panellist marks the proposed times they can attend. */
export function availability(s: State, a: Actor, b: Data) {
  const iv = s.get('interview', b.interview)
  requireThat(onPanel(a, iv), 'Only invited interviewers record their own availability', 403)
  const app = requireApplication(s, a, iv.application)
  requireThat(iv.status === 'proposed', 'Availability is closed for this interview', 409)
  const selected = chosen(iv.slots, b.slots)
  const record = s.put('interview', iv.id, { ...iv, availability: { ...iv.availability, [a.email]: selected }, observations: [...(iv.observations ?? []), { kind: 'panel-availability', at: now(), slots: selected }] })
  s.audit(a, 'availability-recorded', 'interview:' + iv.id)
  return panelView(a, s.get('vacancy', app.vacancy), record)
}

/** The candidate's answer through their private availability link. */
export function candidateAvailability(s: State, iv: Data, slots: unknown) {
  requireThat(iv.status === 'proposed', 'This interview is no longer collecting availability', 409)
  const record = s.put('interview', iv.id, { ...iv, availability: { ...iv.availability, candidate: chosen(iv.slots, slots) }, candidateRespondedAt: now(), observations: [...(iv.observations ?? []), { kind: 'candidate-availability', at: now(), slots: chosen(iv.slots, slots) }] })
  s.audit(null, 'candidate-availability', 'interview:' + iv.id)
  return record
}

/** Times every responder can make, best first; a factual overlap, not a recommendation. */
export function commonSlots(iv: Data) {
  const responders = Object.values(iv.availability ?? {}) as number[][]
  return iv.slots.map((slot: string, index: number) => ({ index, start: slot, available: responders.filter(r => r.includes(index)).length, of: iv.participants.length + 1 }))
    .sort((x: Data, y: Data) => y.available - x.available || x.index - y.index)
}

export function schedule(s: State, a: Actor, b: Data) {
  const iv = s.get('interview', b.interview)
  const app = requireApplication(s, a, iv.application)
  requireManages(a, s.get('vacancy', app.vacancy))
  requireThat(iv.status === 'proposed', 'This interview is already scheduled or canceled', 409)
  const index = integer(b.slot, 'Time', 0, iv.slots.length - 1)
  const record = s.put('interview', iv.id, { ...iv, status: 'scheduled', start: iv.slots[index], scheduledBy: a.email, scheduledAt: now(), observations: [...(iv.observations ?? []), { kind: 'scheduled', at: now(), slot: index }] })
  s.audit(a, 'interview-scheduled', 'interview:' + iv.id, { start: record.start })
  notifyInterview(s, record, a.email, 'scheduled')
  return record
}

/**
 * A panellist tells the hiring team they cannot attend, or another interviewer on this candidate's panels offers
 * to cover, in their own words and with the time they are free. It changes nothing on the interview; whoever runs
 * the vacancy decides, and an agent may read the reply to propose a rebooking.
 */
export function reply(s: State, a: Actor, b: Data) {
  const iv = s.get('interview', b.interview)
  const app = requireApplication(s, a, iv.application)
  requireThat(iv.status !== 'cancelled', 'This interview was canceled', 409)
  const answer = oneOf(b.answer, ['cannot-attend', 'can-cover'] as const, 'Answer')
  const on = onPanel(a, iv)
  requireThat(answer === 'cannot-attend' ? on : canReview(a) && !on, answer === 'cannot-attend' ? 'Only an invited interviewer can say they cannot attend' : 'Only an interviewer not already on this panel can offer to cover', 403)
  const entry = { by: scope(a), answer, note: optionalText(b.note, 'Note', 500), freeAt: b.freeAt ? instant(b.freeAt, 'Free at') : null, at: now() }
  const record = s.put('interview', iv.id, { ...iv, replies: [...(iv.replies ?? []), entry] })
  s.audit(a, 'interview-reply', 'interview:' + iv.id, { answer, note: entry.note, freeAt: entry.freeAt })
  return panelView(a, s.get('vacancy', app.vacancy), record)
}

export function cancel(s: State, a: Actor, b: Data) {
  const iv = s.get('interview', b.interview)
  const app = requireApplication(s, a, iv.application)
  requireManages(a, s.get('vacancy', app.vacancy))
  requireThat(iv.status !== 'cancelled', 'Already canceled', 409)
  const record = s.put('interview', iv.id, { ...iv, status: 'cancelled', cancelReason: text(b.reason, 'Reason', 500), observations: [...(iv.observations ?? []), { kind: 'cancelled', at: now() }] })
  s.audit(a, 'interview-cancelled', 'interview:' + iv.id)
  notifyInterview(s, record, a.email, 'canceled')
  return record
}

const icsText = (v: string) => v.replace(/[\\;,]/g, m => '\\' + m).replace(/\r?\n/g, '\\n')
const icsTime = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const fold = (line: string) => line.match(/.{1,73}/g)!.join('\r\n ')

/** RFC 5545 invitation for a scheduled interview; organiser and attendees are the panel. */
export function calendarFile(iv: Data, candidateName: string, origin: string) {
  requireThat(iv.status === 'scheduled', 'Schedule the interview before downloading its invitation', 409)
  const end = new Date(Date.parse(iv.start) + iv.durationMinutes * 60000).toISOString()
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lodge//Hiring//EN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${iv.id}@${new URL(origin).host}`, `DTSTAMP:${icsTime(now())}`, `DTSTART:${icsTime(iv.start)}`, `DTEND:${icsTime(end)}`,
    `SUMMARY:${icsText(`${iv.title} with ${candidateName}`)}`, `LOCATION:${icsText(iv.location || 'To be confirmed')}`,
    `DESCRIPTION:${icsText(`Interview scheduled in Lodge. Open the interview kit (questions, focus attributes and your scorecard): ${origin}/app?kit=${iv.id}`)}`,
    `URL:${origin}/app?kit=${iv.id}`,
    ...iv.participants.map((p: string) => `ATTENDEE;ROLE=REQ-PARTICIPANT:mailto:${p}`),
    'END:VEVENT', 'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}
