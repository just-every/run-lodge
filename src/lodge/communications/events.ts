import type { Bindings } from '../../auth.server'
// @ts-expect-error Base's JavaScript mail facade does not publish declarations for its event verifier.
import { verifyWebhook } from '../../modules/mail/index.mjs'
import { load, save } from '../core/store'
import type { Data } from '../core/types'
import { contactDigest } from '../records/capture'

const maxBody = 128 * 1024
const maxEvents = 100
const windowSeconds = 5 * 60
type DeliveryEvent = { id: string; messageId: string; event: 'delivered' | 'bounce' | 'dropped' | 'spamreport' | 'unsubscribe' | 'group_unsubscribe'; timestamp: number }

class InvalidRequest extends Error {
  constructor(readonly status: number) { super('Invalid event request') }
}

function reply(status: number, ok = false) {
  return Response.json(ok ? { ok: true } : { error: status === 503 ? 'Event service unavailable' : 'Invalid event request' }, { status, headers: { 'cache-control': 'no-store' } })
}

async function rawBody(request: Request) {
  const declared = request.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBody)) throw new InvalidRequest(413)
  const reader = request.body?.getReader()
  const bytes = new Uint8Array(maxBody)
  let length = 0
  if (!reader) return bytes.subarray(0, 0)
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      if (length + chunk.value.byteLength > maxBody) {
        await reader.cancel()
        throw new InvalidRequest(413)
      }
      bytes.set(chunk.value, length)
      length += chunk.value.byteLength
    }
  } finally { reader.releaseLock() }
  return bytes.subarray(0, length)
}

function deliveryEvent(value: unknown, currentSeconds: number): DeliveryEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const event = value as Record<string, unknown>
  if (!['delivered', 'bounce', 'dropped', 'spamreport', 'unsubscribe', 'group_unsubscribe'].includes(String(event.event))) return null
  if (typeof event.sg_event_id !== 'string' || !/^[\x20-\x7e]{1,100}$/.test(event.sg_event_id)) return null
  if (typeof event.sg_message_id !== 'string' || !/^[\x21-\x7e]{1,1000}$/.test(event.sg_message_id)) return null
  if (typeof event.timestamp !== 'number' || !Number.isSafeInteger(event.timestamp) || event.timestamp < 0 || event.timestamp > currentSeconds + windowSeconds) return null
  return { id: event.sg_event_id, messageId: event.sg_message_id, event: event.event as DeliveryEvent['event'], timestamp: event.timestamp }
}

function history(mail: Data): { id: string; at: string; event: DeliveryEvent['event'] }[] {
  if (!Array.isArray(mail.deliveryEvents)) return []
  return mail.deliveryEvents.filter((item: Data) => item && typeof item.id === 'string' && /^[\x20-\x7e]{1,100}$/.test(item.id) && typeof item.at === 'string' && Number.isFinite(Date.parse(item.at)) && ['delivered', 'bounce', 'dropped', 'spamreport', 'unsubscribe', 'group_unsubscribe'].includes(item.event))
    .slice(-(maxEvents - 1)).map((item: Data) => ({ id: item.id, at: item.at, event: item.event }))
}

/** Verify raw timestamp + body bytes before parsing, then commit only fenced delivery facts. */
export async function applicationEmailEvents(request: Request, env: Bindings): Promise<Response> {
  try {
    if (env.MAIL_PROVIDER !== 'sendgrid' || !env.APPLICATION_EMAIL_SENDGRID_PUBLIC_KEY) return reply(503)
    if (request.method !== 'POST') return reply(403)
    const timestamp = request.headers.get('x-twilio-email-event-webhook-timestamp') ?? ''
    const signature = request.headers.get('x-twilio-email-event-webhook-signature') ?? ''
    const currentSeconds = Math.floor(Date.now() / 1000)
    if (!/^\d{1,12}$/.test(timestamp) || Math.abs(currentSeconds - Number(timestamp)) > windowSeconds || !signature) return reply(403)
    const body = await rawBody(request)
    if (!await verifyWebhook({ provider: 'sendgrid', rawBody: body, headers: request.headers, key: env.APPLICATION_EMAIL_SENDGRID_PUBLIC_KEY, now: Date.now(), toleranceSeconds: windowSeconds })) return reply(403)
    let payload: unknown
    try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) } catch { return reply(400) }
    if (!Array.isArray(payload) || payload.length > maxEvents) return reply(400)
    const events = payload.map(value => deliveryEvent(value, currentSeconds)).filter((event): event is DeliveryEvent => event !== null)
    if (!events.length) return reply(200, true)
    const s = await load(env.DB)
    for (const event of events) {
      // Exact matches win; a suffix is SendGrid's per-recipient extension of its returned message id.
      const matching = s.all('application-email').filter(mail => mail.provider === 'sendgrid' && typeof mail.providerMessageId === 'string' && mail.providerMessageId.length > 0 && (event.messageId === mail.providerMessageId || event.messageId.startsWith(mail.providerMessageId + '.')))
      const longest = matching.reduce((length, mail) => Math.max(length, mail.providerMessageId.length), 0)
      const matches = matching.filter(mail => mail.providerMessageId.length === longest)
      if (matches.length !== 1) continue
      const mail = s.get('application-email', matches[0].id)
      const app = s.find('application', mail.application), person = s.find('candidate', mail.candidate)
      if (!app || app.deleted || !person || person.deleted || mail.deleted) continue
      const previous = history(mail)
      if (mail.deliveryEventId === event.id || previous.some(item => item.id === event.id)) continue
      if (event.event !== 'delivered') {
        const address = mail.content?.to ?? person.email
        if (address) s.put('application-email-suppression', await contactDigest(s, address), { reason: event.event })
      }
      const at = new Date(event.timestamp * 1000).toISOString()
      const last = typeof mail.deliveryAt === 'string' ? Date.parse(mail.deliveryAt) : NaN
      if (Number.isFinite(last) && (event.timestamp * 1000 < last || (event.timestamp * 1000 === last && (mail.status === 'delivered' || event.event !== 'delivered')))) continue
      if (mail.status === 'delivered' && event.event !== 'delivered') continue
      const status = event.event === 'delivered' ? 'delivered' : event.event === 'bounce' ? 'bounced' : event.event === 'dropped' ? 'failed' : 'suppressed'
      const updated: Data = { ...mail, status, deliveryEventId: event.id, deliveryAt: at, deliveryEvent: event.event, deliveryEvents: [...previous, { id: event.id, at, event: event.event }] }
      if (status === 'delivered') delete updated.reason
      else updated.reason = 'Provider reported ' + event.event
      s.put('application-email', mail.id, updated)
      s.audit(null, 'application-email-' + status, 'application:' + mail.application, { emailId: mail.id, providerMessageId: mail.providerMessageId, event: event.event })
    }
    await save(env.DB, s, null)
    return reply(200, true)
  } catch (error) { return reply(error instanceof InvalidRequest ? error.status : 503) }
}
