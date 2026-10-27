import type { State } from '../core/state'
import { now, type Data } from '../core/types'
import { sameTiming, statusDue, statusTiming } from './timing'
import { templateId } from './templates'
import { activeApplicationTransport } from './transport'
import { applicationEmailContent } from './content'
import { contactDigest } from '../records/capture'

export async function queueApplicationEmail(s: State, app: Data, kind: string, event: string, receipt?: Data) {
  const job = s.get('vacancy', app.vacancy), person = s.get('candidate', app.candidate)
  if (app.imported || job.imported || person.deleted) return
  const policy = s.find('application-email-policy', app.vacancy)
  if (!policy || (kind === 'acknowledgment' ? !policy.acknowledgment : !policy.stages.includes(app.stage))) return
  const language = app.language ?? 'en', stage = kind === 'status' ? app.stage : ''
  const template = s.find('application-email-template', templateId(app.vacancy, kind, language, stage))
  const id = kind === 'acknowledgment' ? 'ack:' + app.id : 'stage:' + event
  if (s.find('application-email', id)) return
  const code = receipt?.id ?? s.all('receipt').find(r => r.application === app.id)?.id ?? ''
  const transport = activeApplicationTransport(s)
  const content = template && transport && template.transportEpoch === transport.epoch ? applicationEmailContent(s, app, template, code, template.footer) : undefined
  const digest = person.email ? await contactDigest(s, person.email) : ''
  const suppressed = digest && (s.find('capture-erased', digest) || s.find('application-email-suppression', digest)) || person.contactPreference && person.contactPreference.preference !== 'email'
  const timing = kind === 'status' ? statusTiming(job) : undefined
  const eventAt = kind === 'status' ? s.get('stage-event', event).at : now()
  const dueAt = timing ? statusDue(timing, eventAt) : eventAt
  const reason = kind === 'status' && template && !sameTiming(template.timing ?? statusTiming({}), timing!) ? 'Status timing changed; review this exact language template again' : suppressed ? 'Recipient contact is suppressed' : !transport || transport.epoch !== policy.transportEpoch ? 'Installation sender requires review' : !template || template.transportEpoch !== transport.epoch ? 'No current reviewed template in the recorded application language' : content?.missing.length ? 'Missing message values: ' + content.missing.join(', ') : ''
  s.put('application-email', id, { application: app.id, vacancy: app.vacancy, candidate: app.candidate, kind, stage, language, event, receipt: code, template: template?.id ?? '', templateVersion: template?.version ?? 0, policyVersion: policy.version, transportEpoch: transport?.epoch ?? '', reviewedBy: template?.reviewedBy, approvedSender: transport ? { from: transport.from, replyTo: transport.replyTo } : undefined, content, status: reason ? suppressed ? 'suppressed' : 'withheld' : 'pending', ...(reason ? { reason } : {}), timing, timingReviewedBy: kind === 'status' ? job.applicationEmailTimingBy : undefined, eventAt, dueAt, at: now() })
}

/** Existing transition events cover ordinary moves, bulk moves and reopening. Initial intake only acknowledges its receipt. */
export async function queueApplicationStageEmails(s: State) {
  for (const mail of s.all('application-email').filter(m => m.kind === 'status' && m.status === 'pending')) {
    const app = s.find('application', mail.application), job = s.find('vacancy', mail.vacancy)
    const changed = s.all('stage-event').some(e => e.application === mail.application && !s.original('stage-event', e.id) && e.id !== mail.event)
    if (!app || app.status !== 'active' || app.stage !== mail.stage || app.candidateWithdrawnAt || job?.status === 'closed' || changed) s.put('application-email', mail.id, { ...mail, status: 'canceled', reason: 'Application is no longer eligible for this event', finishedAt: now() })
  }
  for (const event of s.all('stage-event')) {
    if (s.original('stage-event', event.id) || !s.original('application', event.application)) continue
    const app = s.get('application', event.application)
    if (app.status === 'active' && app.stage === event.to) await queueApplicationEmail(s, app, 'status', event.id)
  }
}
