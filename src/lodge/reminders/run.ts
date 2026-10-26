import type { Bindings } from '../../auth.server'
import { load, save } from '../core/store'
import type { State } from '../core/state'
import { now, type Data } from '../core/types'
import { reminderEligibility } from './eligibility'
import { businessDue } from './timing'

export async function prepareReminder(s: State, mail: Data) {
  const r = s.find('hiring-reminder', mail.reminder)
  if (!r || !['queued', 'completed'].includes(r.status)) return { status: 'canceled', reason: 'Reminder no longer active' }
  const eligible = await reminderEligibility(s, r)
  if (!eligible.transport) return { status: ['waiting', 'acknowledged'].includes(eligible.status) ? 'canceled' : eligible.status, reason: eligible.reason }
  const due = businessDue(s, r, Date.now())
  if (Date.parse(due) > Date.now()) return { defer: due }
  return { transport: eligible.transport, message: mail.content }
}

/** Durable due work is claimed in the same transaction as its immutable outgoing event. */
export async function runReminders(env: Bindings, at: number) {
  const s = await load(env.DB)
  for (const listed of s.scan('hiring-reminder')) {
    if (!['queued', 'completed'].includes(listed.status)) continue
    const r = s.get('hiring-reminder', listed.id), eligible = await reminderEligibility(s, r)
    if (!eligible.transport) {
      if (eligible.status !== 'waiting') s.put('hiring-reminder', r.id, { ...r, status: eligible.status, reason: eligible.reason })
      continue
    }
    const previous = s.scan('application-email').filter(m => m.reminder === r.id)
    if (previous.some(m => ['pending', 'uncertain', 'failed', 'bounced', 'suppressed', 'withheld'].includes(m.status))) {
      s.put('hiring-reminder', r.id, { ...r, status: 'held', reason: 'A prior attempt needs human resolution; automatic retries are stopped' }); continue
    }
    if (r.status === 'completed') continue
    if (Date.parse(r.nextDueAt) > at) continue
    const due = businessDue(s, r, at)
    if (Date.parse(due) > at) { s.put('hiring-reminder', r.id, { ...r, nextDueAt: due }); continue }
    const escalation = r.attempts >= r.maxAttempts
    const id = 'reminder-' + r.id + '-' + r.attempts
    if (s.find('application-email', id)) continue
    const content = escalation ? { to: r.escalation, subject: 'Lodge: hiring reminder needs manager attention', text: `The ${r.kind} request remains outstanding. Responsible owner: ${r.owner}. Open the reviewed reminder: ${env.AUTH_ORIGIN}/reminders/settings?reminder=${r.id}`, missing: [] } : { to: r.to, subject: r.subject, text: r.body + '\n\n' + r.footer, missing: [] }
    s.put('application-email', id, { kind: 'reminder', reminder: r.id, purpose: escalation ? 'escalation' : r.kind, application: r.application, candidate: r.candidate, vacancy: r.vacancy, status: 'pending', content, language: escalation ? 'en' : r.language, reviewedBy: r.by, templateVersion: 1, at: now(), dueAt: r.nextDueAt, attempts: 0 })
    s.put('hiring-reminder', r.id, { ...r, attempts: r.attempts + (escalation ? 0 : 1), status: escalation || r.kind === 'upcoming' ? 'completed' : 'queued', nextDueAt: escalation || r.kind === 'upcoming' ? null : businessDue(s, r, at + r.cadenceHours * 3600000) })
    s.audit(null, 'hiring-reminder-queued', 'application:' + r.application, { reminder: r.id, purpose: escalation ? 'escalation' : r.kind })
  }
  await save(env.DB, s, null)
}
