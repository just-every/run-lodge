import type { Bindings } from '../../auth.server'
import { runtimeBindings } from '../../auth.server'
import { operatorMail } from '../../mail.server.mjs'
import type { MailMessage } from '../../modules/operator-auth/index.mjs'
import { can, isAdmin, managesVacancy } from '../core/access'
import type { State } from '../core/state'
import { load, save } from '../core/store'
import { canonical, Fault, now, requireThat, sha256, type Actor, type Data } from '../core/types'
import { memberActor } from '../notify/describe'
import { activeApplicationTransport, currentTransport } from '../communications/transport'
import { analysisScope, type AnalysisScope } from '../analysis/scope'
import { addDays, CADENCE, occurrence, periodFor } from './calendar'
import { calculate, FUNNEL } from './calculate'

export const SUBJECT = 'Lodge: weekly source and funnel report'
export function reportAdmin(a: Actor) { requireThat(!a.agent && isAdmin(a), 'Only a current human owner or hiring admin can configure weekly reports', 403) }
type Operator = { id: string; email: string; role: string; status: string; version: number }
async function native(env: Bindings, s: State, email: string, id?: string) {
  const operator = await env.DB.prepare('SELECT id,email,role,status,version FROM oa_operators WHERE lower(email)=?').bind(email).first<Operator>()
  const membership = s.find('member', email), member = memberActor(s, membership)
  requireThat(operator?.status === 'active' && (!id || id === operator.id) && member && !membership?.enterprise, 'A reviewed native recipient or author is no longer eligible', 403)
  const a: Actor = { ...member, id: operator.id, owner: operator.role === 'owner' && member.owner }
  requireThat(!a.agent && (isAdmin(a) || a.roles.includes('manager')), 'Reports require current recruiting access', 403)
  return { a, operator }
}
function jobsAllowed(s: State, a: Actor, jobs: string[]) {
  for (const id of jobs) {
    const job = s.get('vacancy', id)
    requireThat(managesVacancy(a, job) && can(s, a, job, 'export'), 'A selected job is no longer authorized for this person', 403)
  }
}
async function scoped(env: Bindings, s: State, row: Data, recipient: string) {
  requireThat(row.origin === runtimeBindings(env).AUTH_ORIGIN, 'The reviewed installation address changed', 409)
  const author = await native(env, s, row.authorEmail, row.author), person = await native(env, s, recipient)
  reportAdmin(author.a)
  jobsAllowed(s, author.a, row.jobs); jobsAllowed(s, person.a, row.jobs)
  const authorScope = await analysisScope(s, author.a, env), scope = await analysisScope(s, person.a, env)
  const visible = new Set(authorScope.applications.map(app => app.id))
  const intersection: AnalysisScope = { ...scope, applications: scope.applications.filter(app => visible.has(app.id)) }
  requireThat(scope.dates.zone === row.zone && authorScope.dates.zone === row.zone, 'The reviewed business time zone changed', 409)
  return { author, person, scope: intersection }
}
async function sender(env: Bindings, s: State, epoch?: string) {
  const transport = activeApplicationTransport(s), reviewer = transport && memberActor(s, s.find('member', transport.by))
  requireThat(transport?.replyTo && transport.footer && reviewer && isAdmin(reviewer) && (!epoch || epoch === transport.epoch), 'The installation sender requires a current human admin review', 409)
  const nativeReviewer = await native(env, s, transport.by)
  reportAdmin(nativeReviewer.a)
  return transport
}
async function signature(env: Bindings, a: Actor, preview: Data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(runtimeBindings(env).SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical({ actor: a.id, session: a.session, preview })))
  return [...new Uint8Array(signed)].map(n => n.toString(16).padStart(2, '0')).join('')
}
export async function reportPreview(env: Bindings, s: State, a: Actor, b: Data) {
  reportAdmin(a)
  requireThat(b.channel === undefined || b.channel === 'email', 'Slack requires an authorized installation and destination; only email can be enabled here', 409)
  requireThat(Array.isArray(b.jobs) && b.jobs.length > 0 && b.jobs.length <= 30 && b.jobs.every((id: unknown) => typeof id === 'string') && new Set(b.jobs).size === b.jobs.length, 'Choose one to thirty distinct jobs')
  requireThat(Array.isArray(b.recipients) && b.recipients.length > 0 && b.recipients.length <= 30 && b.recipients.every((email: unknown) => typeof email === 'string' && email.length <= 320 && email === email.toLowerCase()) && new Set(b.recipients).size === b.recipients.length, 'Choose one to thirty distinct native recipients')
  const zone = (await analysisScope(s, a, env)).dates.zone, dueAt = occurrence(b.firstDate, b.clock, zone)
  requireThat(Date.parse(dueAt) > Date.parse(now()), 'Choose a future first occurrence')
  const transport = await sender(env, s)
  requireThat(await currentTransport(env, transport), 'Sender authentication could not be confirmed', 409)
  jobsAllowed(s, a, b.jobs)
  const preview = { author: a.id, authorEmail: a.email, jobs: [...b.jobs].sort(), recipients: [...b.recipients].sort(), firstDate: b.firstDate, clock: b.clock, zone, dueAt, cadence: CADENCE, funnel: FUNNEL, channel: 'email', from: transport.from, replyTo: transport.replyTo, footer: transport.footer, transportEpoch: transport.epoch, origin: runtimeBindings(env).AUTH_ORIGIN }
  const samples = []
  for (const recipient of preview.recipients) {
    const current = await scoped(env, s, preview, recipient)
    samples.push({ recipient, report: calculate(current.scope, preview.jobs, periodFor(preview.firstDate)) })
  }
  return { preview, samples, reviewKey: await signature(env, a, preview) }
}
export async function enableReport(env: Bindings, s: State, a: Actor, b: Data) {
  requireThat(b.reviewed === true && b.enabled === true, 'Explicitly review and enable this weekly email schedule')
  const draft = await reportPreview(env, s, a, b)
  requireThat(b.reviewKey === draft.reviewKey, 'The reviewed recipients, schedule or sender changed; preview again', 409)
  const id = await sha256(canonical(draft.preview)), previous = s.find('weekly-report', id)
  if (previous) return previous
  const row = s.put('weekly-report', id, { ...draft.preview, nextDate: draft.preview.firstDate, enabled: true, status: 'scheduled', createdAt: now() })
  s.audit(a, 'weekly-report-enabled', 'weekly-report:' + id)
  return row
}
export function ownedReports(s: State, a: Actor) { reportAdmin(a); return s.all('weekly-report').filter(row => row.author === a.id) }
export function reportAttempts(s: State, row: Data) { return s.all('weekly-report-attempt').filter(r => r.schedule === row.id) }
export function cancelReport(s: State, a: Actor, id: string) {
  reportAdmin(a)
  const row = s.get('weekly-report', id)
  requireThat(row.author === a.id, 'Schedule not found', 404)
  s.put('weekly-report', id, { ...row, enabled: false, status: 'canceled' })
  s.audit(a, 'weekly-report-canceled', 'weekly-report:' + id)
}
export async function openReport(env: Bindings, s: State, a: Actor, id: string) {
  const attempt = s.get('weekly-report-attempt', id), row = s.get('weekly-report', attempt.schedule)
  requireThat(!a.agent && attempt.recipientId === a.id && attempt.recipient === a.email, 'Report not found', 404)
  const current = await scoped(env, s, row, a.email)
  requireThat(current.person.operator.id === a.id, 'Report not found', 404)
  return calculate(current.scope, row.jobs, periodFor(attempt.date))
}
function nativeFence(env: Bindings, operator: Operator) {
  return env.DB.prepare("INSERT INTO l_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND email=? AND role=? AND version=? AND status='active') THEN 1 ELSE 0 END").bind(operator.id, operator.email, operator.role, operator.version)
}
function scanScope(s: State) {
  for (const kind of ['business', 'member', 'department', 'vacancy', 'permission-level', 'candidate', 'application', 'stage-event', 'interview', 'offer', 'source']) s.scan(kind)
}
export async function runWeeklyReports(env: Bindings, at: number) {
  const listed = await env.DB.prepare("SELECT id FROM l_records WHERE kind='weekly-report' AND json_extract(value,'$.enabled')=1").all<{ id: string }>()
  for (const { id } of listed.results) {
    const initial = await load(env.DB), listedRow = initial.find('weekly-report', id)
    if (!listedRow?.enabled || Date.parse(occurrence(listedRow.nextDate, listedRow.clock, listedRow.zone)) > at) continue
    const date = listedRow.nextDate
    for (const recipient of listedRow.recipients) {
      try {
        let s = await load(env.DB), row = s.get('weekly-report', id)
        if (!row.enabled || row.nextDate !== date) break
        const claim = await sha256(canonical({ schedule: id, date, recipient }))
        if (s.find('weekly-report-attempt', claim)) continue
        // A permission loss or ambiguous request suspends this recipient, including later periods.
        if (s.scan('weekly-report-attempt').some(r => r.schedule === id && r.recipient === recipient && ['uncertain', 'withheld', 'failed'].includes(r.status))) continue
        let current: Awaited<ReturnType<typeof scoped>>, transport: Data
        try {
          current = await scoped(env, s, row, recipient)
          transport = await sender(env, s, row.transportEpoch)
          requireThat(await currentTransport(env, transport), 'Sender authentication changed', 409)
          s = await load(env.DB); row = s.get('weekly-report', id)
          requireThat(row.enabled && row.nextDate === date, 'Schedule was canceled', 409)
          scanScope(s)
          current = await scoped(env, s, row, recipient)
          transport = await sender(env, s, row.transportEpoch)
          requireThat(!s.find('weekly-report-attempt', claim), 'Occurrence already claimed', 409)
        } catch {
          s = await load(env.DB); row = s.get('weekly-report', id)
          if (!row.enabled || row.nextDate !== date || s.find('weekly-report-attempt', claim)) continue
          s.put('weekly-report-attempt', claim, { schedule: id, date, recipient, status: 'withheld', reason: 'Current author, recipient, job access or sender requires fresh review', finishedAt: now() })
          s.audit(null, 'weekly-report-withheld', 'weekly-report:' + id)
          await save(env.DB, s, null); continue
        }
        s.put('weekly-report-attempt', claim, { schedule: id, date, recipient, recipientId: current.person.operator.id, status: 'uncertain', claimedAt: now(), reason: 'Claimed before the single provider request; no automatic retry' })
        s.audit(null, 'weekly-report-claimed', 'weekly-report:' + id)
        await save(env.DB, s, null, [nativeFence(env, current.author.operator), nativeFence(env, current.person.operator), env.DB.prepare('INSERT INTO l_guard SELECT CASE WHEN (SELECT epoch FROM l_application_email_activation WHERE id=1)=? THEN 1 ELSE 0 END').bind(transport.epoch)])
        let outcome: Data
        try {
          const live = await load(env.DB), liveRow = live.get('weekly-report', id)
          requireThat(liveRow.enabled, 'Schedule canceled', 409)
          const liveCurrent = await scoped(env, live, liveRow, recipient); await sender(env, live, row.transportEpoch)
          const report = calculate(liveCurrent.scope, row.jobs, periodFor(date))
          const mail = operatorMail(env)
          requireThat(mail && env.MAIL_PROVIDER === 'sendgrid' && env.RER_DEMO !== '1', 'Installation sender unavailable', 409)
          const message = { from: transport.from, replyTo: transport.replyTo, to: [recipient], subject: SUBJECT, text: ['Weekly source and funnel report', CADENCE, JSON.stringify(report, null, 2), 'Open current authorized report (sign-in required): ' + row.origin + '/reports/weekly/open/' + claim, transport.footer].join('\n\n'), deliveryId: 'weekly-' + claim }
          const receipt = await mail.send(message as unknown as MailMessage)
          const receiptId = typeof receipt.providerMessageId === 'string' && receipt.providerMessageId.length <= 512 && /^[\x20-\x7e]+$/.test(receipt.providerMessageId) && (!env.MAIL_API_KEY || !receipt.providerMessageId.includes(env.MAIL_API_KEY)) ? receipt.providerMessageId : undefined
          outcome = { status: receipt.status === 'accepted' && receiptId ? 'handed' : ['accepted', 'uncertain'].includes(receipt.status) ? 'uncertain' : 'failed', ...(receiptId ? { providerMessageId: receiptId } : {}), reason: receipt.status === 'accepted' && receiptId ? 'Accepted by the provider; recipient delivery is unconfirmed' : 'Provider acceptance unconfirmed; human reconciliation required, no automatic resend' }
        } catch (error) { outcome = { status: error instanceof Fault ? 'withheld' : 'uncertain', reason: 'Dispatch requires human reconciliation; no automatic resend' } }
        const after = await load(env.DB), attempt = after.get('weekly-report-attempt', claim)
        after.put('weekly-report-attempt', claim, { ...attempt, ...outcome, finishedAt: now() })
        after.audit(null, 'weekly-report-' + outcome.status, 'weekly-report:' + id)
        await save(env.DB, after, null)
      } catch (error) { if (!(error instanceof Fault && error.status === 409)) console.error('Weekly report held', error instanceof Error ? error.name : 'Error') }
    }
    try {
      const s = await load(env.DB), row = s.get('weekly-report', id)
      const attempts = s.scan('weekly-report-attempt')
      const settled = row.recipients.every((recipient: string) => attempts.some(r => r.schedule === id && r.recipient === recipient && (r.date === date || ['uncertain', 'withheld', 'failed'].includes(r.status))))
      if (row.enabled && row.nextDate === date && settled) { s.put('weekly-report', id, { ...row, nextDate: addDays(date, 7) }); await save(env.DB, s, null) }
    } catch (error) { if (!(error instanceof Fault && error.status === 409)) throw error }
  }
}
