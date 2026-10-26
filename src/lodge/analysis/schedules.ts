import type { Bindings } from '../../auth.server'
import { runtimeBindings } from '../../auth.server'
import type { MailMessage } from '../../modules/operator-auth/index.mjs'
import { operatorMail } from '../../mail.server.mjs'
import { isAdmin } from '../core/access'
import type { State } from '../core/state'
import { grantsOf, load, save } from '../core/store'
import { canonical, Fault, now, requireThat, sha256, type Actor, type Data } from '../core/types'
import { memberActor } from '../notify/describe'
import { activeApplicationTransport, currentTransport } from '../communications/transport'
import { execute, type Result } from './execute'
import { METRICS } from './query'
import { reopenChart } from './saved'
import { analysisScope } from './scope'

export const SCHEDULE_SUBJECT = 'Lodge: scheduled recruiting analysis'
export const SCHEDULE_FORMAT = 'One English email with the metric definition, exact saved query, current total, numerator, denominator, missing-data count, computation time and private authenticated chart link. Grouped results and source rows stay behind sign-in. Current authorized data is recomputed when due. No candidate details or saved evidence rows are emailed.'
export function scheduleAccess(a: Actor) {
  requireThat(!a.agent && isAdmin(a), 'Only a native owner or hiring admin can review scheduled chart delivery', 403)
}
function due(value: unknown) {
  requireThat(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)), 'Choose an exact future date and time with a time zone')
  const datePart = value.slice(0, 10), calendar = new Date(datePart + 'T00:00:00Z')
  requireThat(Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0, 10) === datePart, 'Choose a valid future calendar date')
  const at = Date.parse(value)
  requireThat(at > Date.now(), 'Delivery must be in the future')
  return new Date(at).toISOString()
}
export function scheduleMessage(review: Data, result: Result) {
  return { subject: SCHEDULE_SUBJECT, text: [
    'Your scheduled recruiting analysis',
    'Metric: ' + METRICS[result.query.metric].label,
    'Definition: ' + result.definition,
    'Exact saved query: ' + canonical(result.query),
    'Current authorized total: ' + (result.total.value === null ? 'No matching data' : result.total.value + ' ' + result.unit),
    'Numerator: ' + result.total.numerator,
    'Denominator: ' + result.total.denominator,
    'Missing-data count: ' + result.missing,
    'Computed at: ' + result.computedAt,
    'Business time zone: ' + result.zone,
    'Totals include every matching retained authorized row. No source rows are included in this email. The chart displays at most ' + result.evidenceLimit + ' source rows.',
    ...result.limitations,
    'Open the private chart (sign-in required): ' + review.origin + '/analysis/saved/' + encodeURIComponent(review.chart),
    review.footer,
  ].join('\n\n') }
}
async function reviewSignature(env: Bindings, a: Actor, review: Data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(runtimeBindings(env).SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical({ owner: a.id, session: a.session, review })))
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('')
}
export async function schedulePreview(env: Bindings, s: State, a: Actor, b: Data) {
  scheduleAccess(a)
  const dueAt = due(b.dueAt), scope = await analysisScope(s, a, env), chart = reopenChart(s, a, scope, b.chart)
  const transport = activeApplicationTransport(s)
  requireThat(transport?.replyTo && transport.footer && await currentTransport(env, transport), 'Review and enable an authenticated installation sender with a monitored reply address first', 409)
  const reviewer = memberActor(s, s.find('member', transport.by))
  requireThat(reviewer && isAdmin(reviewer), 'The installation sender needs a current human admin review', 409)
  const preview = { chart: chart.id, title: chart.title, dueAt, recipient: a.email, query: chart.query, subject: SCHEDULE_SUBJECT, format: SCHEDULE_FORMAT, from: transport.from, replyTo: transport.replyTo, footer: transport.footer, transportEpoch: transport.epoch, origin: runtimeBindings(env).AUTH_ORIGIN }
  return { preview, reviewKey: await reviewSignature(env, a, preview), message: scheduleMessage(preview, execute(scope, chart.query)) }
}
export async function enableSchedule(env: Bindings, s: State, a: Actor, b: Data) {
  scheduleAccess(a)
  requireThat(b.reviewed === true && b.enabled === true, 'Review the exact query, English email format, own recipient, sender and future time before enabling delivery')
  requireThat(b.recipient === undefined && b.to === undefined && b.recipients === undefined, 'Scheduled chart delivery goes only to your own native address')
  const draft = await schedulePreview(env, s, a, b)
  requireThat(typeof b.reviewKey === 'string' && b.reviewKey === draft.reviewKey, 'The reviewed chart, recipient, time or sender changed; preview it again', 409)
  const id = await sha256(canonical({ owner: a.id, review: draft.preview }))
  const previous = s.find('analysis-schedule', id)
  if (previous) { requireThat(previous.owner === a.id, 'Schedule not found', 404); return scheduleView(previous) }
  const schedule = s.put('analysis-schedule', id, { owner: a.id, recipient: a.email, chart: draft.preview.chart, dueAt: draft.preview.dueAt, query: draft.preview.query, review: draft.preview, transportEpoch: draft.preview.transportEpoch, enabled: true, reviewed: true, reviewedAt: now(), status: 'pending', createdAt: now() })
  s.audit(a, 'analysis-schedule-reviewed', 'analysis-schedule:' + id)
  return scheduleView(schedule)
}
export function scheduleView(row: Data) {
  const { id, chart, recipient, dueAt, status, reason, createdAt, claimedAt, finishedAt, provider, providerMessageId } = row
  return { id, chart, recipient, dueAt, status, reason, createdAt, claimedAt, finishedAt, provider, providerMessageId }
}
export function ownSchedules(s: State, a: Actor) {
  scheduleAccess(a)
  return s.all('analysis-schedule').filter(r => r.owner === a.id).map(scheduleView).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
}
export function cancelSchedule(s: State, a: Actor, id: string) {
  scheduleAccess(a)
  const row = s.find('analysis-schedule', id)
  requireThat(row && row.owner === a.id, 'Schedule not found', 404)
  requireThat(row.status === 'pending', 'This delivery has already been claimed or completed and cannot be canceled', 409)
  const canceled = s.put('analysis-schedule', id, { ...row, status: 'canceled', enabled: false, finishedAt: now(), reason: 'Canceled by its owner before dispatch' })
  s.audit(a, 'analysis-schedule-canceled', 'analysis-schedule:' + id)
  return scheduleView(canceled)
}

async function prepared(env: Bindings, s: State, row: Data) {
  requireThat(row.enabled === true && row.reviewed === true && row.review && row.status === 'pending', 'Scheduled delivery requires fresh human review', 409)
  const operator = await env.DB.prepare('SELECT id,email,role,status,version FROM oa_operators WHERE id=?').bind(row.owner).first<{ id: string; email: string; role: string; status: string; version: number }>()
  requireThat(operator?.status === 'active' && operator.email.toLowerCase() === row.recipient, 'The native author or recipient is no longer current', 403)
  const membership = s.find('member', row.recipient), member = memberActor(s, membership)
  requireThat(member && membership, 'The author no longer has active native membership', 403)
  const owner = operator.role === 'owner'
  const a: Actor = { ...member, id: operator.id, owner, roles: owner ? ['admin', 'manager', 'interviewer', 'approver'] : membership.roles, seePrivate: owner || membership.seePrivate === true, grants: owner ? undefined : grantsOf(s, membership) }
  scheduleAccess(a)
  // Fence additions, removals and edits in every evidence and access set used for dispatch.
  for (const kind of ['business', 'member', 'department', 'vacancy', 'permission-level', 'candidate', 'application', 'stage-event', 'interview', 'offer', 'source']) s.scan(kind)
  const scope = await analysisScope(s, a, env), chart = reopenChart(s, a, scope, row.chart)
  const transport = activeApplicationTransport(s), reviewer = transport && memberActor(s, s.find('member', transport.by))
  requireThat(transport && transport.epoch === row.transportEpoch && reviewer && isAdmin(reviewer), 'Installation sender activation or review changed', 409)
  const expected = { chart: chart.id, title: chart.title, dueAt: row.dueAt, recipient: a.email, query: chart.query, subject: SCHEDULE_SUBJECT, format: SCHEDULE_FORMAT, from: transport.from, replyTo: transport.replyTo, footer: transport.footer, transportEpoch: transport.epoch, origin: runtimeBindings(env).AUTH_ORIGIN }
  requireThat(canonical(row.review) === canonical(expected) && canonical(row.query) === canonical(chart.query), 'The exact reviewed chart definition or sender changed', 409)
  return { transport, message: scheduleMessage(expected, execute(scope, chart.query)), operator }
}
function nativeFence(env: Bindings, o: { id: string; email: string; role: string; version: number }) {
  return env.DB.prepare("INSERT INTO l_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND email=? AND role=? AND version=? AND status='active') THEN 1 ELSE 0 END").bind(o.id, o.email, o.role, o.version)
}

/** Each one-off is durably uncertain before its single provider request. No retry path exists. */
export async function scheduledAnalysis(env: Bindings, at: number) {
  const listed = await env.DB.prepare("SELECT id FROM l_records WHERE kind='analysis-schedule' AND json_extract(value,'$.status')='pending'").all<{ id: string }>()
  for (const { id } of listed.results) {
    try {
      const s = await load(env.DB), row = s.find('analysis-schedule', id)
      if (!row || row.status !== 'pending' || !Number.isFinite(Date.parse(row.dueAt)) || Date.parse(row.dueAt) > at) continue
      let ready: Awaited<ReturnType<typeof prepared>>
      try {
        ready = await prepared(env, s, row)
        requireThat(await currentTransport(env, ready.transport), 'Installation sender authentication requires review', 409)
      } catch {
        s.put('analysis-schedule', id, { ...row, status: 'withheld', enabled: false, reason: 'Current author access, chart definition or installation sender requires human review', finishedAt: now() })
        await save(env.DB, s, null); continue
      }
      // Re-read scope after the network authentication check, before the durable claim.
      const live = await load(env.DB), current = live.find('analysis-schedule', id)
      if (!current || current.status !== 'pending') continue
      ready = await prepared(env, live, current)
      live.put('analysis-schedule', id, { ...current, status: 'uncertain', enabled: false, claimedAt: now(), reason: 'Provider request claimed; acceptance has not been confirmed' })
      live.audit(null, 'analysis-schedule-claimed', 'analysis-schedule:' + id)
      await save(env.DB, live, null, [nativeFence(env, ready.operator)])
      let outcome: Data
      const activation = await env.DB.prepare('SELECT epoch FROM l_application_email_activation WHERE id=1').first<{ epoch: string }>()
      if (activation?.epoch !== ready.transport.epoch) outcome = { status: 'withheld', reason: 'Installation sender activation changed' }
      else try {
        const sender = operatorMail(env)
        requireThat(sender && env.MAIL_PROVIDER === 'sendgrid' && env.RER_DEMO !== '1', 'Installation sender is unavailable', 409)
        const receipt = await sender.send({ from: ready.transport.from, replyTo: ready.transport.replyTo, to: [current.recipient], subject: ready.message.subject, text: ready.message.text, deliveryId: 'analysis-' + id } as unknown as MailMessage)
        const receiptId = typeof receipt.providerMessageId === 'string' && receipt.providerMessageId.length <= 512 && /^[\x20-\x7e]+$/.test(receipt.providerMessageId) && (!env.MAIL_API_KEY || !receipt.providerMessageId.includes(env.MAIL_API_KEY)) ? receipt.providerMessageId : undefined
        const accepted = receipt.status === 'accepted' && !!receiptId
        outcome = { status: accepted ? 'handed' : ['accepted', 'uncertain'].includes(receipt.status) ? 'uncertain' : 'failed', provider: env.MAIL_PROVIDER, ...(receiptId ? { providerMessageId: receiptId } : {}), ...(accepted ? {} : { reason: 'Provider acceptance was not confirmed; human review required. No automatic resend.' }) }
      } catch { outcome = { status: 'uncertain', provider: env.MAIL_PROVIDER, reason: 'Provider acceptance was not confirmed; human review required. No automatic resend.' } }
      const after = await load(env.DB), claimed = after.find('analysis-schedule', id)
      if (!claimed || claimed.status !== 'uncertain') continue
      after.put('analysis-schedule', id, { ...claimed, ...outcome, finishedAt: now(), ...(outcome.status === 'handed' ? { reason: 'Accepted by the mail provider; delivery has not been confirmed' } : {}) })
      after.audit(null, 'analysis-schedule-' + outcome.status, 'analysis-schedule:' + id)
      await save(env.DB, after, null)
    } catch (error) {
      // A concurrent claim or access change wins. The next tick only considers still-pending rows.
      if (!(error instanceof Fault && error.status === 409)) console.error('analysis schedule dispatch held', error instanceof Error ? error.name : 'Error')
    }
  }
}
