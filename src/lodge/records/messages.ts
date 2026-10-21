import type { State } from '../core/state'
import { requireApplication, requireManages } from '../core/access'
import { email, now, oneOf, requireThat, text, uid, type Actor, type Data } from '../core/types'
import { approvedNow, requestApproval } from './approvals'

// Flow 10: candidate messages are drafted, approved as exact text, then
// downloaded as an .eml file to send from the business's own mailbox. Lodge
// sends nothing in this release, and never reports a message as delivered.

export const PURPOSES = ['acknowledgement', 'interview-invitation', 'availability-request', 'reminder', 'rejection', 'offer', 'other'] as const

export function message(s: State, a: Actor, b: Data) {
  const app = requireApplication(s, a, b.application)
  requireManages(a, s.get('vacancy', app.vacancy))
  const candidate = s.get('candidate', app.candidate)
  // MIG-008: people moved in from another system are not contactable until the employer records a basis.
  requireThat(!app.activated || app.contactBasis?.basis === 'application', 'Record a basis for contacting people moved in from another system before drafting a message to them', 409)
  const fields = {
    application: app.id, purpose: oneOf(b.purpose, PURPOSES, 'Purpose'),
    to: email(b.to ?? candidate.email, 'Recipient'), subject: text(b.subject, 'Subject', 200), body: text(b.body, 'Message', 20000),
  }
  if (b.id) {
    const current = s.get('message', b.id)
    requireThat(current.application === app.id, 'That message belongs to another application')
    const record = s.put('message', current.id, { ...current, ...fields, editedBy: a.email, editedAt: now() })
    s.audit(a, 'message-edited', 'message:' + current.id)
    return record
  }
  const record = s.put('message', uid(), { ...fields, draftedBy: a.email, draftedAt: now(), downloads: [] })
  s.audit(a, 'message-drafted', 'message:' + record.id, { purpose: record.purpose })
  return record
}

export async function requestMessageApproval(s: State, a: Actor, b: Data) {
  const m = s.get('message', b.id)
  const app = requireApplication(s, a, m.application)
  requireManages(a, s.get('vacancy', app.vacancy))
  return requestApproval(s, a, 'message', m, b.approver)
}

const header = (v: string) => v.replace(/[\r\n]+/g, ' ')
const encodeWord = (v: string) => /^[\x20-\x7e]*$/.test(v) ? header(v) : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(header(v))))}?=`

/** The approved message as RFC 5322 text for the business's mail client. */
export async function emlFile(s: State, a: Actor, m: Data, from: string) {
  const app = requireApplication(s, a, m.application)
  requireManages(a, s.get('vacancy', app.vacancy))
  requireThat(!m.cancelled, 'This message was canceled: ' + m.cancelledReason, 409)
  requireThat(await approvedNow(s, 'message', m), 'Only the exact approved text can be downloaded; request approval again after edits', 409)
  s.put('message', m.id, { ...m, downloads: [...(m.downloads ?? []), { by: a.email, at: now() }] })
  s.audit(a, 'message-downloaded', 'message:' + m.id, { note: 'Prepared for sending from your own mailbox; Lodge did not send it' })
  const body = new TextEncoder().encode(m.body.replace(/\r?\n/g, '\r\n'))
  let raw = ''
  for (const byte of body) raw += String.fromCharCode(byte)
  return ['From: ' + header(from), 'To: ' + m.to, 'Subject: ' + encodeWord(m.subject), 'X-Unsent: 1', 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', btoa(raw).match(/.{1,76}/g)!.join('\r\n'), ''].join('\r\n')
}
