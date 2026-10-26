import { prepareReminder } from '../reminders/run'
import type { MailMessage } from '../../modules/operator-auth/index.mjs'
import { memberActor } from '../notify/describe'
import { canSeeContact, can, isAdmin, managesVacancy } from '../core/access'
import { operatorMail } from '../../mail.server.mjs'
import type { Bindings } from '../../auth.server'
import { load, save } from '../core/store'
import type { State } from '../core/state'
import { now, type Data } from '../core/types'
import { activeApplicationTransport, currentTransport } from './transport'
import { contactDigest } from '../records/capture'

function authorized(s: State, email: string, job: Data, person: Data) {
  const member = s.find('member', email)
  if (!member?.active || member.agent) return false
  const actor = memberActor(s, member)
  return actor && isAdmin(actor) && managesVacancy(actor, job) && can(s, actor, job, 'contact') && can(s, actor, job, 'settings') && canSeeContact(s, actor, person)
}

async function prepared(s: State, mail: Data): Promise<Data> {
  if (mail.kind === 'reminder') return prepareReminder(s, mail)
  const app = s.find('application', mail.application), person = s.find('candidate', mail.candidate), job = s.find('vacancy', mail.vacancy)
  if (!app || !person || person.deleted || person.mergedInto || !job || app.imported || job.imported || app.candidateWithdrawnAt || (mail.kind === 'status' && (app.status !== 'active' || app.stage !== mail.stage))) return { status: 'canceled', reason: 'Application is no longer eligible for this event' }
  if ((app.activated && app.contactBasis?.basis !== 'application') || (person.contactPreference && person.contactPreference.preference !== 'email')) return { status: 'suppressed', reason: 'Current contact preference does not permit email' }
  const digest = person.email ? await contactDigest(s, person.email) : ''
  if (digest && (s.find('capture-erased', digest) || s.find('application-email-suppression', digest))) return { status: 'suppressed', reason: 'Recipient contact is suppressed' }
  const transport = activeApplicationTransport(s), policy = s.find('application-email-policy', job.id), template = s.find('application-email-template', mail.template)
  if (!transport || !policy || transport.epoch !== mail.transportEpoch || policy?.version !== mail.policyVersion || policy.transportEpoch !== transport.epoch || (mail.kind === 'acknowledgment' ? !policy.acknowledgment : !policy.stages.includes(mail.stage))) return { status: 'withheld', reason: 'Current sender or job configuration requires review' }
  if (!template || template.version !== mail.templateVersion || template.language !== (app.language ?? 'en') || !authorized(s, template.reviewedBy, job, person) || !authorized(s, policy.by, job, person) || !authorized(s, transport.by, job, person)) return { status: 'withheld', reason: 'Current human review or contact permission does not permit this email' }
  if (!mail.content?.to || mail.content.to !== person.email || mail.content.missing?.length || !mail.content.subject || !mail.content.text) return { status: 'withheld', reason: 'Reviewed message values are missing or the recipient changed' }
  return { transport, message: mail.content }
}

/** A durable uncertain claim precedes each physical request; a restart never resends it. */
export async function flushApplicationEmails(env: Bindings) {
  try {
    if (!(await env.DB.prepare("SELECT 1 FROM l_records WHERE kind='application-email' AND json_extract(value,'$.status')='pending' LIMIT 1").first())) return
    for (;;) {
      const s = await load(env.DB), found = s.all('application-email').find(x => x.status === 'pending')
      if (!found) return
      const mail = s.get('application-email', found.id), ready = await prepared(s, mail)
      const sender = env.MAIL_PROVIDER === 'sendgrid' && env.RER_DEMO !== '1' && env.MAIL_FROM ? operatorMail(env) : undefined
      let verified = false
      if (ready.transport && sender) { try { verified = await currentTransport(env, ready.transport) } catch { /* Verification failure withholds this message. */ } }
      if (!ready.message || !ready.transport || !sender || !verified) {
        s.put('application-email', mail.id, { ...mail, status: ready.status ?? 'withheld', reason: ready.reason ?? 'Installation sender authentication requires review', finishedAt: now() })
        await save(env.DB, s, null); continue
      }
      s.put('application-email', mail.id, { ...mail, status: 'uncertain', reason: 'Provider request claimed; awaiting a confirmed outcome', attempts: (mail.attempts ?? 0) + 1, claimedAt: now() })
      s.audit(null, 'application-email-claimed', 'application:' + mail.application, { emailId: mail.id })
      await save(env.DB, s, null)
      // The activation lives outside portable records and is rechecked at dispatch.
      const activation = await env.DB.prepare('SELECT epoch FROM l_application_email_activation WHERE id=1').first<{ epoch: string }>()
      let outcome: Data
      if (activation?.epoch !== ready.transport.epoch) outcome = { status: 'withheld', reason: 'Installation sender activation changed' }
      else try {
        const result = await sender.send({ from: ready.transport.from, replyTo: ready.transport.replyTo, to: [ready.message.to], subject: ready.message.subject, text: ready.message.text, deliveryId: 'application-' + mail.id } as unknown as MailMessage)
        const id = typeof result.providerMessageId === 'string' && (!env.MAIL_API_KEY || !result.providerMessageId.includes(env.MAIL_API_KEY)) ? result.providerMessageId : undefined, accepted = result.status === 'accepted' && !!id
        outcome = { status: accepted ? 'handed' : result.status === 'uncertain' || result.status === 'accepted' ? 'uncertain' : 'failed', provider: result.provider, ...(typeof id === 'string' && (!env.MAIL_API_KEY || !id.includes(env.MAIL_API_KEY)) ? { providerMessageId: id } : {}), ...(accepted ? {} : { reason: result.code ?? 'Provider outcome could not be confirmed' }) }
      } catch (error) { outcome = { status: 'uncertain', provider: env.MAIL_PROVIDER, reason: error instanceof Error && error.name === 'MailValidationError' ? 'Message validation refused; human review required' : 'Provider outcome could not be confirmed' } }
      const after = await load(env.DB), current = after.find('application-email', mail.id)
      if (!current || !after.find('candidate', mail.candidate) || after.find('candidate', mail.candidate)?.deleted) continue
      const updated: Data = { ...current, ...outcome, finishedAt: now() }
      if (outcome.status === 'handed') delete updated.reason
      after.put('application-email', mail.id, updated)
      after.audit(null, 'application-email-' + outcome.status, 'application:' + mail.application, { emailId: mail.id, ...outcome })
      await save(env.DB, after, null)
    }
  } catch (error) { console.error('application email dispatch failed', (error as Error)?.name) }
}
