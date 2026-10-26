import type { State } from '../core/state'
import { requireAdmin, requireApplication, requireCan, requireManages, can, canSeeApplication, canSeeContact, managesVacancy } from '../core/access'
import { email, instant, integer, list, now, oneOf, requireThat, text, uid, type Actor, type Data } from '../core/types'
import { activeApplicationTransport } from '../communications/transport'
import { assignment, reminderAuthority, reminderEligibility } from './eligibility'
import { businessDue } from './timing'

export async function configureReminder(s: State, a: Actor, b: Data) {
  requireAdmin(a); requireThat(!a.agent, 'A human admin reviews and enables reminders', 403)
  const iv = s.get('interview', b.interview), app = requireApplication(s, a, iv.application), job = s.get('vacancy', app.vacancy)
  requireManages(a, job); requireCan(s, a, job, 'contact'); requireCan(s, a, job, 'settings')
  const transport = activeApplicationTransport(s)
  requireThat(transport, 'Review and enable the authenticated installation sender first', 409)
  requireThat(b.reviewed === true && b.enabled === true, 'Explicitly review this exact message and enable future reminders')
  const kind = oneOf(b.kind, ['availability', 'upcoming', 'scorecard'] as const, 'Reminder purpose')
  const recipient = b.recipient === 'candidate' ? 'candidate' : email(b.recipient, 'Recipient')
  requireThat(recipient !== 'candidate' || kind !== 'scorecard', 'Scorecards are requested from panellists')
  requireThat(recipient === 'candidate' || iv.participants.includes(recipient), 'Choose a current panellist')
  requireThat(kind === 'availability' ? iv.status === 'proposed' : iv.status === 'scheduled', 'Choose the current interview work', 409)
  const owner = email(b.owner, 'Responsible owner'), escalation = email(b.escalation, 'Escalation manager')
  requireThat(reminderAuthority(s, owner, job, app) && reminderAuthority(s, escalation, job, app), 'Owner and escalation manager need current job and contact access', 409)
  requireThat(escalation === job.manager || (job.team?.hiringManagers ?? []).includes(escalation) || s.get('member', escalation).owner, 'Name a current hiring manager for escalation')
  const language = text(b.language, 'Reviewed language', 30)
  requireThat(recipient !== 'candidate' || language === (app.language ?? 'en'), 'Review the exact recorded application language', 409)
  const subject = text(b.subject, 'Reviewed subject', 200), body = text(b.body, 'Reviewed message', 10000), footer = text(b.footer, 'Reviewed identification and opt-out footer', 4000)
  requireThat(!/[\r\n]/.test(subject), 'Use a single-line subject')
  requireThat(!/[{}]/.test(subject + body + footer), 'Review filled text with no unresolved merge fields')
  const startHour = integer(b.startHour, 'Business opening hour', 0, 23), endHour = integer(b.endHour, 'Business closing hour', 1, 24)
  requireThat(endHour > startHour, 'Closing hour must follow opening hour')
  const weekdays = [...new Set(list(b.weekdays, 'Business weekdays', 7, n => integer(n, 'Weekday', 0, 6)))]; requireThat(weekdays.length, 'Select a business weekday')
  const dueAt = instant(b.dueAt, 'First due time'), cadenceHours = integer(b.cadenceHours, 'Minimum hours between contacts', 1, 720), maxAttempts = integer(b.maxAttempts, 'Maximum reminder contacts', 1, 20)
  requireThat(Date.parse(dueAt) >= Date.now(), 'First due time must be in the future')
  requireThat(kind !== 'upcoming' || (Date.parse(dueAt) < Date.parse(iv.start) && maxAttempts === 1), 'Upcoming reminders send once before the interview')
  // One active purpose per interview recipient; repeated clicks cannot create parallel cadences.
  requireThat(!s.scan('hiring-reminder').some(r => r.interview === iv.id && r.recipient === recipient && r.kind === kind && ['queued', 'held'].includes(r.status)), 'Cancel the current reminder before replacing it', 409)
  const r: Data = { interview: iv.id, application: app.id, candidate: app.candidate, vacancy: job.id, kind, recipient, to: recipient === 'candidate' ? s.get('candidate', app.candidate).email : recipient, owner, escalation, language, subject, body, footer, startHour, endHour, weekdays, cadenceHours, maxAttempts, attempts: 0, assignment: assignment(iv, job), transportEpoch: transport.epoch, by: a.email, at: now(), status: 'queued' }
  r.nextDueAt = businessDue(s, r, Date.parse(dueAt))
  const eligible = await reminderEligibility(s, r)
  requireThat(eligible.transport || eligible.status === 'waiting', eligible.reason ?? 'Reminder is not eligible', 409)
  const record = s.put('hiring-reminder', uid(), r)
  s.audit(a, 'hiring-reminder-reviewed', 'application:' + app.id, { reminder: record.id, owner, escalation })
  return record
}

export function cancelReminder(s: State, a: Actor, b: Data) {
  requireAdmin(a); requireThat(!a.agent, 'A human admin changes reminders', 403)
  const r = s.get('hiring-reminder', b.id), app = requireApplication(s, a, r.application), job = s.get('vacancy', app.vacancy)
  requireManages(a, job); requireCan(s, a, job, 'contact')
  const record = s.put('hiring-reminder', r.id, { ...r, status: 'canceled', reason: text(b.reason, 'Cancellation reason', 500) })
  s.audit(a, 'hiring-reminder-canceled', 'application:' + app.id, { reminder: r.id })
  return record
}

export function reminderView(s: State, a: Actor): Data {
  requireAdmin(a); requireThat(!a.agent, 'A human admin reads reminder settings', 403)
  const jobs = s.all('vacancy').filter(job => managesVacancy(a, job) && can(s, a, job, 'settings') && can(s, a, job, 'contact') && !job.imported)
  const allowed = new Set(jobs.map(j => j.id))
  const visible = (application: string) => { const app = s.find('application', application); return !!app && canSeeApplication(s, a, app) && canSeeContact(s, a, s.get('candidate', app.candidate)) }
  const interviews = s.all('interview').filter(iv => allowed.has(iv.vacancy) && visible(iv.application))
  const reminders = s.all('hiring-reminder').filter(r => allowed.has(r.vacancy) && visible(r.application)).map(r => ({ ...r, title: s.find('interview', r.interview)?.title, outcomes: s.all('application-email').filter(m => m.reminder === r.id).map(m => ({ ...m, to: m.content?.to })) }))
  return { jobs, interviews, reminders, members: s.all('member').filter(m => m.active && !m.agent), transportReady: !!activeApplicationTransport(s) }
}
