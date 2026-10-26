import type { Bindings } from '../../auth.server'
import { isAdmin } from '../core/access'
import { authority, save } from '../core/store'
import type { State } from '../core/state'
import { now, requireThat, text, uid, type Actor, type Data } from '../core/types'

export function senderAddress(from: string) {
  const address = (from.match(/^[^<>\r\n]*<([^<>]+)>$/)?.[1] ?? from).trim().toLowerCase()
  requireThat(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address), 'Configure a valid installation sender address')
  return address
}

async function credentialIdentity(env: Bindings) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.MAIL_API_KEY ?? '')))].map(n => n.toString(16).padStart(2, '0')).join('')
}

/** A failed or unavailable provider check never establishes sender authentication. */
export async function authenticatedSender(env: Bindings, domainId?: number) {
  requireThat(env.MAIL_PROVIDER === 'sendgrid' && env.MAIL_API_KEY && env.MAIL_FROM && env.RER_DEMO !== '1', 'Configure production SendGrid before enabling application mail', 409)
  const domain = senderAddress(env.MAIL_FROM!).split('@')[1]
  const url = domainId === undefined ? 'https://api.sendgrid.com/v3/whitelabel/domains?' + new URLSearchParams({ domain, limit: '500', exclude_subusers: 'true' }) : 'https://api.sendgrid.com/v3/whitelabel/domains/' + domainId
  let response: Response
  try { response = await fetch(url, { headers: { authorization: 'Bearer ' + env.MAIL_API_KEY }, redirect: 'manual', signal: AbortSignal.timeout(10000) }) }
  catch { throw new Error('Sender authentication could not be checked') }
  requireThat(response.ok, 'SendGrid sender authentication is unavailable; check the configured account and read permission', 409)
  const data = await response.json() as Data | Data[]
  const domains = Array.isArray(data) ? data : [data]
  const verified = domains.find(item => item.valid === true && item.domain === domain && Number.isSafeInteger(item.id) && item.id > 0)
  requireThat(verified, 'SendGrid has not authenticated the exact installation sender domain', 409)
  return { domain, domainId: verified.id, credentialIdentity: await credentialIdentity(env) }
}

export function activeApplicationTransport(s: State) {
  const transport = s.find('application-email-transport', 'main')
  return transport?.enabled && s.applicationMailEpoch && transport.epoch === s.applicationMailEpoch ? transport : undefined
}

export async function approveApplicationTransport(env: Bindings, s: State, a: Actor, b: Data) {
  requireThat(isAdmin(a) && !a.agent, 'Only a human owner or hiring admin can approve the installation sender', 403)
  if (b.enabled === false) {
    const previous = s.find('application-email-transport', 'main')
    s.put('application-email-transport', 'main', { ...previous, enabled: false, by: a.email, at: now() })
    s.audit(a, 'application-email-transport-disabled', 'installation', {})
    await save(env.DB, s, a)
    return
  }
  const from = text(env.MAIL_FROM, 'Installation sender', 320)
  const replyTo = senderAddress(text(b.replyTo, 'Monitored reply-to address', 320))
  const footer = text(b.footer, 'Employer identification, physical address, contact and opt-out footer', 4000)
  requireThat(!/\{\{|\}\}/.test(footer), 'The reviewed footer must contain complete text')
  requireThat(b.monitored === true && b.reviewed === true, 'Confirm the monitored reply route and exact legally reviewed footer')
  const verified = await authenticatedSender(env), epoch = uid()
  s.put('application-email-transport', 'main', { enabled: true, from, replyTo, footer, ...verified, epoch, by: a.email, at: now() })
  s.audit(a, 'application-email-transport-approved', 'installation', { domain: verified.domain, domainId: verified.domainId })
  const auth = authority(a)
  await save(env.DB, s, a, [env.DB.prepare(`INSERT INTO l_application_email_activation(id,epoch) SELECT 1,? WHERE (${auth.sql}) ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch`).bind(epoch, ...auth.params)])
}

export async function currentTransport(env: Bindings, transport: Data) {
  if (transport.from !== env.MAIL_FROM || transport.credentialIdentity !== await credentialIdentity(env)) return false
  const verified = await authenticatedSender(env, transport.domainId)
  return verified.domain === transport.domain
}
