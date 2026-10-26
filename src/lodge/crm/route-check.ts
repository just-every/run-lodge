import type { MailMessage } from '../../modules/operator-auth/index.mjs'
import type { Bindings } from '../../auth.server'
import { operatorMail } from '../../mail.server.mjs'
import { load, save } from '../core/store'
import { requireAdmin } from '../core/access'
import { email, now, requireThat, sha256, uid, type Actor } from '../core/types'
import { activeApplicationTransport, currentTransport } from '../communications/transport'

/** An admin verifies the actual inbound path; this never contacts a candidate. */
export async function checkReplyRoute(env: Bindings, a: Actor) {
  requireAdmin(a); requireThat(!a.agent, 'A human admin verifies the reply route', 403)
  const s = await load(env.DB), transport = activeApplicationTransport(s), address = email(env.CRM_REPLY_ADDRESS ?? transport?.replyTo, 'Configured CRM reply address')
  requireThat(transport && transport.replyTo === address && await currentTransport(env, transport), 'Review the authenticated sender and this exact reply address first', 409)
  const token = uid().replaceAll('-', '') + uid().replaceAll('-', ''), digest = await sha256(token)
  s.put('crm-reply-route', 'main', { address, epoch: transport.epoch, digest, expiresAt: Date.now() + 600000, status: 'uncertain', by: a.email, at: now() })
  s.audit(a, 'crm-reply-route-check-claimed', 'installation')
  await save(env.DB, s, a)
  try {
    const result = await operatorMail(env)!.send({ from: transport.from, to: [address], subject: 'Lodge CRM reply route verification', text: 'Lodge verifies its own inbound route.\nLodge-CRM-Route: ' + token, deliveryId: 'crm-route-' + digest } as unknown as MailMessage)
    requireThat(result.status === 'accepted', 'Route-check handoff was not confirmed; check the route before trying again', 409)
  } catch { throw new Error('Route-check outcome could not be confirmed. Verify inbound receipt before trying again.') }
}
