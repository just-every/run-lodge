import { operatorMail } from '../../mail.server.mjs'
import { runtimeBindings, type Bindings } from '../../auth.server'
import type { MailMessage } from '../../modules/operator-auth/index.mjs'
import { load, save } from '../core/store'
import type { Data } from '../core/types'
import { event } from './envelope'

// OFFER-005 mail: invitation, one-time code, void notice and completion copy are transactional system mail through the
// installation's own mail adapter (the door that sends sign-in invitations), not recruiter mail. A message is only ever
// "handed to the mail provider" or "failed"; an uncertain send is never resent blindly.

export const mailReady = (env: Bindings) => !!env.MAIL_PROVIDER && !!env.MAIL_FROM && !!operatorMail(env)
const origin = (env: Bindings) => runtimeBindings(env).AUTH_ORIGIN

export type Delivery = { outcome: 'handed'; provider: string } | { outcome: 'failed'; provider: string; reason: string }

export async function deliver(env: Bindings, to: string, subject: string, text: string): Promise<Delivery> {
  const provider = env.MAIL_PROVIDER ?? 'not configured'
  try {
    const result = await operatorMail(env)!.send({ from: env.MAIL_FROM, to: [to], subject, text, deliveryId: 'esign-' + crypto.randomUUID() } as unknown as MailMessage)
    return result.status === 'accepted' || result.status === 'development' ? { outcome: 'handed', provider } : { outcome: 'failed', provider, reason: String(result.status) }
  } catch { return { outcome: 'failed', provider, reason: 'mail provider error' } }
}

const contactLine = (e: Data) => `Questions? Contact ${e.contact.name} at ${e.contact.email}.`

export const invitationMail = (env: Bindings, e: Data, token: string) => ({
  subject: `${e.businessName} sent you an offer to sign electronically`,
  text: `${e.businessName} has sent you an offer for electronic signature.\n\nOpen this link: ${origin(env)}/sign/${token}\n\nYou will be asked for a one-time code, which is emailed separately. The link expires ${e.expiresAt}.\n\nThis email carries no offer terms. ${contactLine(e)}\n`,
})
export const codeMail = (e: Data, code: string, purpose: 'sign' | 'copy') => ({
  subject: `Your one-time code for ${e.businessName}`,
  text: `Your one-time code is ${code}\n\nIt works for ${purpose === 'sign' ? 'your offer signing page' : 'your signed copy'} for 10 minutes. If you did not ask for it, ignore this email.\n`,
})
const noticeMail = (env: Bindings, n: Data) => n.kind === 'void'
  ? { subject: `${n.businessName}: this signing request is no longer active`, text: `This signing request is no longer active. Contact ${n.contact.name} at ${n.contact.email}.\n` }
  : { subject: `${n.businessName}: your signed offer copy`, text: `Your offer is signed. Open your copy here: ${origin(env)}/copy/${n.copyToken}\n\nYou will be asked for a fresh one-time code, emailed to you.\nThis email carries no offer terms. ${contactLine(n)}\n` }

/** Records a mail's outcome as the envelope's own event, without secrets. */
export async function record(env: Bindings, id: string, action: string, delivery: Delivery, extra: Data = {}) {
  const s = await load(env.DB)
  const e = s.find('esign-envelope', id)
  if (!e) return
  event(s, e, delivery.outcome === 'handed' ? `esign-${action}-handed-to-mail-provider` : `esign-${action}-failed`, { provider: delivery.provider, ...(delivery.outcome === 'failed' ? { reason: delivery.reason } : {}), ...extra })
  if (action === 'invitation') s.put('esign-envelope', e.id, { ...e, invitation: { status: delivery.outcome, at: new Date().toISOString() } })
  await save(env.DB, s, null)
}

/**
 * Send the queued void and completion notices. Each row is claimed before sending (and its link dropped from the row),
 * so a retry never sends it twice.
 */
export async function flushNotices(env: Bindings) {
  try {
    if (!(await env.DB.prepare("SELECT 1 AS n FROM l_records WHERE kind='esign-notice' LIMIT 1").first()) || !mailReady(env)) return
    for (;;) {
      const s = await load(env.DB)
      const n = s.all('esign-notice').find(x => x.status === 'pending')
      if (!n) return
      s.put('esign-notice', n.id, { ...n, status: 'sending', copyToken: undefined })
      await save(env.DB, s, null)
      const message = noticeMail(env, n), delivery = await deliver(env, n.to, message.subject, message.text)
      const after = await load(env.DB)
      after.remove('esign-notice', n.id)
      await save(env.DB, after, null)
      await record(env, n.envelope, n.kind === 'void' ? 'void-notice' : 'completion-copy', delivery)
    }
  } catch (error) { console.error('esign notice delivery failed', (error as Error)?.name) }
}
