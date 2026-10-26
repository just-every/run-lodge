import { normalizeInbound } from '../../inbound.server.mjs'
import type { Bindings } from '../../auth.server'
import { load, save } from '../core/store'
import type { State } from '../core/state'
import { canSeeContact, requireAdmin, requireCan, requireManages } from '../core/access'
import { bytesToBase64, Fault, now, requireThat, sha256, text, type Actor, type Data } from '../core/types'
import { contactDigest } from '../records/capture'

/** Stopping contact is atomic with canceling every unclaimed queued step. */
export function stopCandidateNurture(s: State, candidate: string, reason: string) {
  const enrollments = s.scan('crm-enrollment').filter(e => e.candidate === candidate)
  for (const e of enrollments) s.put('crm-enrollment', e.id, { ...e, status: 'stopped', stoppedAt: now(), reason })
  const ids = new Set(enrollments.map(e => e.id))
  for (const m of s.scan('application-email')) if (ids.has(m.enrollment) && m.status === 'pending') s.put('application-email', m.id, { ...m, status: 'canceled', finishedAt: now(), reason })
}

export function stopEnrollment(s: State, a: Actor, b: Data) {
  requireThat(!a.agent && (a.owner || a.roles.includes('admin') || a.roles.includes('manager')), 'A human recruiter stops a nurture campaign', 403)
  const e = s.get('crm-enrollment', b.id), person = s.get('candidate', e.candidate), job = s.get('vacancy', e.targetVacancy)
  requireThat(canSeeContact(s, a, person), 'Campaign not found', 404)
  requireManages(a, job); requireCan(s, a, job, 'contact')
  const reason = text(b.reason, 'Stop reason', 500)
  s.put('crm-enrollment', e.id, { ...e, status: 'stopped', stoppedAt: now(), reason })
  for (const m of s.scan('application-email')) if (m.enrollment === e.id && m.status === 'pending') s.put('application-email', m.id, { ...m, status: 'canceled', finishedAt: now(), reason })
  s.audit(a, 'nurture-stopped', 'candidate:' + person.id, { enrollment: e.id })
  return s.get('crm-enrollment', e.id)
}

export function optOutExists(s: State, token: string) {
  return /^[a-f0-9]{64}$/.test(token) && s.all('crm-enrollment').some(e => e.optOutToken === token && s.find('candidate', e.candidate)?.deleted !== true)
}

export async function publicOptOut(s: State, token: string) {
  requireThat(optOutExists(s, token), 'This page is unavailable', 404)
  const found = s.scan('crm-enrollment').find(e => e.optOutToken === token)!, e = s.get('crm-enrollment', found.id), person = s.get('candidate', e.candidate)
  requireThat(!person.deleted && !person.mergedInto, 'This page is unavailable', 404)
  s.put('candidate', person.id, { ...person, consent: { ...person.consent, talentPool: false, withdrawnAt: now() } })
  stopCandidateNurture(s, person.id, 'Candidate opted out of nurture')
  s.audit(null, 'nurture-opt-out', 'candidate:' + person.id)
}

/** Native email only: a private installation address selects custody; no HTTP ingestion exists. */
export async function receiveNurtureReply(message: ForwardableEmailMessage, env: Bindings) {
  requireThat(env.CRM_REPLY_ADDRESS && message.to.toLowerCase() === env.CRM_REPLY_ADDRESS.toLowerCase(), 'Reply refused', 550)
  const s = await load(env.DB), sender = message.from.toLowerCase()
  const mail = await normalizeInbound({ provider: 'cloudflare', message }, { maxRawBytes: 1000000, maxBodyBytes: 100000, maxAttachments: 10, maxAttachmentBytes: 500000, maxTotalAttachmentBytes: 1000000 })
  const challenge = /Lodge-CRM-Route: ([a-f0-9]{64})/.exec(mail.text ?? '')
  if (challenge) {
    const route = s.find('crm-reply-route', 'main')
    if (route && route.address === message.to.toLowerCase() && route.expiresAt >= Date.now() && route.digest === await sha256(challenge[1])) {
      s.put('crm-reply-route', 'main', { ...route, status: 'verified', verifiedAt: now() })
      s.audit(null, 'crm-reply-route-verified', 'installation'); await save(env.DB, s, null); return
    }
    throw new Fault(550, 'Reply refused')
  }
  const digest = await contactDigest(s, sender)
  if (s.find('capture-erased', digest)) return
  const people = s.scan('candidate').filter(c => !c.deleted && !c.mergedInto && c.email?.toLowerCase() === sender)
  requireThat(people.length === 1, 'Reply refused', 550)
  const person = s.get('candidate', people[0].id)
  const enrollments = s.scan('crm-enrollment').filter(e => e.candidate === person.id && e.replyAddress?.toLowerCase() === message.to.toLowerCase())
  requireThat(enrollments.length, 'Reply refused', 550)
  const id = await sha256(JSON.stringify([message.to.toLowerCase(), sender, mail.messageId, mail.subject, mail.text]))
  if (s.find('crm-reply', id)) return
  s.put('crm-reply', id, { candidate: person.id, application: enrollments[0].sourceApplication, enrollments: enrollments.map(e => e.id), from: sender, to: message.to.toLowerCase(), subject: mail.subject, body: mail.text ?? '', attachments: mail.attachments.map(f => ({ name: f.filename, mediaType: f.contentType, base64: bytesToBase64(f.content) })), messageId: mail.messageId, inReplyTo: message.headers.get('in-reply-to')?.slice(0, 2000) ?? '', references: message.headers.get('references')?.slice(0, 4000) ?? '', receivedAt: now() })
  stopCandidateNurture(s, person.id, 'Candidate replied')
  s.audit(null, 'nurture-reply-received', 'candidate:' + person.id, { reply: id })
  await save(env.DB, s, null)
}

export async function nurtureEmail(message: ForwardableEmailMessage, env: Bindings) {
  try { await receiveNurtureReply(message, env) }
  catch (error) {
    if ((error instanceof Fault && [403, 404, 550].includes(error.status)) || (error instanceof Error && error.name === 'MailValidationError')) message.setReject('Reply refused')
    else throw error
  }
}
