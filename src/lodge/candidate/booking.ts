import type { State } from '../core/state'
import { canReview, requireApplication, requireManages } from '../core/access'
import { now, requireThat, text, type Actor, type Data } from '../core/types'
import { notifyInterview } from '../notify/emit'

/** Staff explicitly share only the interview title/location and panel-approved proposed times. */
export function selfScheduling(s: State, a: Actor, b: Data) {
  const iv = s.get('interview', b.interview), app = requireApplication(s, a, iv.application)
  requireManages(a, s.get('vacancy', app.vacancy))
  requireThat(app.status === 'active' && iv.status !== 'cancelled', 'This interview is closed', 409)
  const record = s.put('interview', iv.id, { ...iv, selfScheduling: { enabled: b.enabled === true, by: a.id, at: now() } })
  s.audit(a, 'candidate-self-scheduling-changed', 'interview:' + iv.id, { enabled: record.selfScheduling.enabled })
  return record
}

export function ownInterview(s: State, app: Data, id: string) {
  const iv = s.find('interview', id)
  requireThat(iv && iv.application === app.id && iv.selfScheduling, 'This page is not available', 404)
  return iv
}

/** Conflicts fence the complete interview set, including concurrent bookings on another application. */
export function bookableSlots(s: State, app: Data, iv: Data) {
  if (!iv.selfScheduling?.enabled || app.status !== 'active' || !['proposed', 'scheduled'].includes(iv.status)) return []
  const members = iv.participants.map((p: string) => s.find('member', p))
  if (members.some((m: Data) => !m?.active || m.agent || !canReview(m as any))) return []
  const apps = s.scan('application')
  const candidate = s.get('candidate', app.candidate)
  const canonical = (id: string): string => { const c = s.get('candidate', id); return c.mergedInto ? canonical(c.mergedInto) : c.id }
  const candidateId = canonical(candidate.id)
  const ownApps = new Set(apps.filter(a => canonical(a.candidate) === candidateId).map(a => a.id))
  const others = s.scan('interview').filter(other => other.id !== iv.id && other.status === 'scheduled' && (ownApps.has(other.application) || other.participants.some((p: string) => iv.participants.includes(p))))
  return iv.slots.flatMap((start: string, index: number) => {
    const from = Date.parse(start), end = from + iv.durationMinutes * 60000
    if (from <= Date.now() || !iv.participants.every((p: string) => iv.availability?.[p]?.includes(index))) return []
    if (others.some(other => from < Date.parse(other.start) + other.durationMinutes * 60000 && end > Date.parse(other.start))) return []
    return [{ index, start }]
  })
}

export function candidateBook(s: State, a: Actor, app: Data, iv: Data, b: Data) {
  // A stale page cannot overwrite a staff cancellation, change or another candidate booking.
  requireThat((iv.start ?? '') === b.previousStart, 'This interview changed; reload before booking', 409)
  const start = text(b.start, 'Interview time', 40)
  const choices = bookableSlots(s, app, iv)
  requireThat(choices.some((x: Data) => x.start === start), 'This time is no longer available; choose another time', 409)
  const rescheduled = iv.status === 'scheduled'
  const record = s.put('interview', iv.id, { ...iv, status: 'scheduled', start, scheduledBy: a.email, scheduledAt: now(), candidateBookings: [...(iv.candidateBookings ?? []), { from: iv.start ?? null, start, at: now(), by: a.id }] })
  s.audit(a, rescheduled ? 'candidate-interview-rescheduled' : 'candidate-interview-booked', 'interview:' + iv.id, { start })
  notifyInterview(s, record, a.email, 'scheduled')
  return record
}
