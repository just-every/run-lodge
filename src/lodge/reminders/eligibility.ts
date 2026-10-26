import type { State } from '../core/state'
import { can, canSeeApplication, canSeeContact, isAdmin, managesVacancy } from '../core/access'
import { memberActor } from '../notify/describe'
import { canonical, type Data } from '../core/types'
import { activeApplicationTransport } from '../communications/transport'
import { contactDigest } from '../records/capture'

export const assignment = (iv: Data, job: Data) => canonical({ participants: iv.participants, manager: job.manager, team: job.team, start: iv.start, slots: iv.slots })
export function reminderAuthority(s: State, email: string, job: Data, app: Data, admin = false) {
  const who = memberActor(s, s.find('member', email))
  return who && (!admin || isAdmin(who)) && managesVacancy(who, job) && canSeeApplication(s, who, app) && can(s, who, job, 'contact') && canSeeContact(s, who, s.get('candidate', app.candidate)) ? who : null
}

/** Completion and current custody are checked again before every physical send. */
export async function reminderEligibility(s: State, r: Data): Promise<Data> {
  const iv = s.find('interview', r.interview), app = s.find('application', r.application), job = s.find('vacancy', r.vacancy), person = s.find('candidate', r.candidate)
  const stop = (reason: string, status = 'canceled') => ({ status, reason })
  if (!iv || !app || !job || !person || person.deleted || person.mergedInto || app.status !== 'active' || app.candidateWithdrawnAt || app.imported || job.imported) return stop('Application is no longer active native work')
  if (iv.status === 'cancelled' || assignment(iv, job) !== r.assignment) return stop('Interview canceled or assignment changed')
  if (!reminderAuthority(s, r.by, job, app, true) || !reminderAuthority(s, r.owner, job, app) || !reminderAuthority(s, r.escalation, job, app)) return stop('Current owner, reviewer or escalation access was revoked')
  if (r.kind === 'availability' && (iv.status !== 'proposed' || Object.hasOwn(iv.availability ?? {}, r.recipient))) return stop('Availability received or collection closed', 'acknowledged')
  if (r.kind === 'scorecard') {
    if (iv.status !== 'scheduled') return stop('Interview is no longer scheduled')
    if (s.scan('scorecard').some(c => c.application === app.id && c.interview === iv.id && c.author === r.recipient && c.status === 'submitted')) return stop('Scorecard submitted', 'acknowledged')
    if (Date.parse(iv.start) + iv.durationMinutes * 60000 > Date.now()) return stop('Interview has not completed', 'waiting')
  }
  if (r.kind === 'upcoming' && (iv.status !== 'scheduled' || Date.parse(iv.start) <= Date.now())) return stop('Interview is no longer upcoming', 'acknowledged')
  if (r.recipient !== 'candidate') {
    const who = memberActor(s, s.find('member', r.recipient))
    if (!who || !iv.participants.includes(r.recipient) || !canSeeApplication(s, who, app)) return stop('Recipient no longer has interview access')
    if ((iv.replies ?? []).some((reply: Data) => reply.by === r.recipient && reply.at >= r.at)) return stop('Panel response received', 'acknowledged')
  } else {
    if (r.language !== (app.language ?? 'en')) return stop('Application language changed')
    if (!person.email || person.email !== r.to || (person.contactPreference && person.contactPreference.preference !== 'email') || (app.activated && app.contactBasis?.basis !== 'application')) return stop('Candidate contact permission changed')
    const digest = await contactDigest(s, person.email)
    if (s.find('capture-erased', digest) || s.find('application-email-suppression', digest)) return stop('Candidate contact is suppressed')
    if ((iv.replies ?? []).some((reply: Data) => reply.by === 'candidate' && reply.at >= r.at)) return stop('Candidate response received', 'acknowledged')
  }
  const transport = activeApplicationTransport(s)
  if (!transport || transport.epoch !== r.transportEpoch || !reminderAuthority(s, transport.by, job, app, true)) return stop('Installation sending is off or requires fresh review', 'withheld')
  return { transport, iv, app, person, job }
}
