import { runtimeBindings, type Bindings } from '../../auth.server'
import { load, save } from '../core/store'
import type { State } from '../core/state'
import type { Data } from '../core/types'
import { deliver, mailReady, type Delivery } from '../esign/mail'
import { describe, memberActor, reach } from './describe'

// Email for alerts goes through the installation's own mail adapter (the door that sends sign-in invitations), as
// OFFER-005's mail does. An alert is claimed before it is sent, so a retry never sends it twice, and what it says is
// worked out from live records at that moment: a person who has lost access, or a subject that has gone, is sent nothing.

const origin = (env: Bindings) => runtimeBindings(env).AUTH_ORIGIN
const FOOT = 'You get this email because of your notification settings in Lodge (Overview, Notification settings).'

function single(s: State, env: Bindings, alert: Data) {
  const who = memberActor(s, s.find('member', alert.to))
  if (!who || !reach(s, who, alert)) return null
  const d = describe(s, alert, who)
  const link = d.link ? `\n\nOpen it: ${origin(env)}${d.link}` : '\n\nYou cannot open the candidate this note is about, so Lodge gives no link or contact details. Ask a hiring admin for access if you need it.'
  return { subject: d.title, text: `${d.title}\n${d.detail ? '\n' + d.detail : ''}${link}\n\n${FOOT}\n` }
}

function digest(s: State, env: Bindings, to: string, alerts: Data[]) {
  const who = memberActor(s, s.find('member', to))
  if (!who) return { send: [] as Data[], skipped: alerts }
  const send = alerts.filter(x => reach(s, who, x)), skipped = alerts.filter(x => !send.includes(x))
  const jobs = new Map<string, string[]>()
  for (const x of send.sort((p, q) => p.at.localeCompare(q.at))) {
    const d = describe(s, x, who), job = s.find('vacancy', x.vacancy)?.title ?? 'Other'
    jobs.set(job, [...(jobs.get(job) ?? []), `- ${d.title}${d.detail && x.event !== 'mention' ? ' (' + d.detail + ')' : ''}${d.link ? '\n  ' + origin(env) + d.link : ''}`])
  }
  const body = [...jobs].map(([job, lines]) => `${job}\n${lines.join('\n')}`).join('\n\n')
  return { send, skipped, message: send.length ? { subject: `Lodge daily digest: ${send.length} ${send.length === 1 ? 'update' : 'updates'}`, text: `Your daily Lodge digest\n\n${body}\n\n${FOOT}\n` } : null }
}

const done = (s: State, ids: string[], state: string, delivery?: Delivery) => {
  for (const id of ids) { const x = s.find('alert', id); if (x) s.put('alert', id, { ...x, emailState: state, emailAt: new Date().toISOString(), ...(delivery ? { provider: delivery.provider, ...(delivery.outcome === 'failed' ? { reason: delivery.reason } : {}) } : {}) }) }
}
const settle = async (env: Bindings, ids: string[], state: string, delivery?: Delivery) => { const s = await load(env.DB); done(s, ids, state, delivery); await save(env.DB, s, null) }
const queued = (env: Bindings, state: string) => env.DB.prepare("SELECT 1 AS n FROM l_records WHERE kind='alert' AND json_extract(value,'$.emailState')=? LIMIT 1").bind(state).first()

/** Send the immediate emails this request's own save queued; run after every successful write. */
export async function flushAlerts(env: Bindings) {
  try {
    if (!(await queued(env, 'queued'))) return
    for (;;) {
      const s = await load(env.DB), alert = s.all('alert').find(x => x.emailState === 'queued')
      if (!alert) return
      const message = mailReady(env) ? single(s, env, alert) : null
      if (!message) { done(s, [alert.id], mailReady(env) ? 'withheld' : 'not-sent'); await save(env.DB, s, null); continue }
      done(s, [alert.id], 'sending'); await save(env.DB, s, null)
      await settle(env, [alert.id], ...(await sendTo(env, alert.to, message)))
    }
  } catch (error) { console.error('alert delivery failed', (error as Error)?.name) }
}

async function sendTo(env: Bindings, to: string, message: { subject: string; text: string }): Promise<[string, Delivery]> {
  const delivery = await deliver(env, to, message.subject, message.text, 'alert')
  return [delivery.outcome === 'handed' ? 'handed' : 'failed', delivery]
}

/** Each person's daily digest, once its 8:00 has come round (the scheduled run passes its own time). */
export async function sendDigests(env: Bindings, at: number) {
  try {
    if (!(await queued(env, 'digest'))) return
    const s = await load(env.DB)
    const due = s.all('alert').filter(x => x.emailState === 'digest' && Date.parse(x.digestAt) <= at)
    const people = [...new Set(due.map(x => x.to as string))]
    const plans = people.map(to => ({ to, ...digest(s, env, to, due.filter(x => x.to === to)) }))
    for (const p of plans) { done(s, p.skipped.map(x => x.id), 'withheld'); done(s, p.send.map(x => x.id), mailReady(env) && 'message' in p && p.message ? 'sending' : 'not-sent') }
    await save(env.DB, s, null)
    for (const p of plans) if ('message' in p && p.message && mailReady(env)) await settle(env, p.send.map(x => x.id), ...(await sendTo(env, p.to, p.message)))
  } catch (error) { console.error('digest delivery failed', (error as Error)?.name) }
}
