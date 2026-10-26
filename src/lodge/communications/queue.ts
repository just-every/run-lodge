import type { State } from '../core/state'
import { now, type Data } from '../core/types'
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
  const reason = suppressed ? 'Recipient contact is suppressed' : !transport || transport.epoch !== policy.transportEpoch ? 'Installation sender requires review' : !template || template.transportEpoch !== transport.epoch ? 'No current reviewed template in the recorded application language' : content?.missing.length ? 'Missing message values: ' + content.missing.join(', ') : ''
  s.put('application-email', id, { application: app.id, vacancy: app.vacancy, candidate: app.candidate, kind, stage, language, event, receipt: code, template: template?.id ?? '', templateVersion: template?.version ?? 0, policyVersion: policy.version, transportEpoch: transport?.epoch ?? '', reviewedBy: template?.reviewedBy, approvedSender: transport ? { from: transport.from, replyTo: transport.replyTo } : undefined, content, status: reason ? suppressed ? 'suppressed' : 'withheld' : 'pending', ...(reason ? { reason } : {}), dueAt: now(), at: now() })
}

/** Existing transition events cover ordinary moves, bulk moves and reopening. Initial intake only acknowledges its receipt. */
export async function queueApplicationStageEmails(s: State) {
  for (const event of s.all('stage-event')) {
    if (s.original('stage-event', event.id) || !s.original('application', event.application)) continue
    const app = s.get('application', event.application)
    if (app.status === 'active' && app.stage === event.to) await queueApplicationEmail(s, app, 'status', event.id)
  }
}
