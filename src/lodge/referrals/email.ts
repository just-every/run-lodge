import { runtimeBindings, type Bindings } from '../../auth.server'
import { load, save } from '../core/store'
import type { State } from '../core/state'
import type { Data } from '../core/types'
import { deliver, mailReady } from '../esign/mail'
import { eligibleJobs, referringMember } from './access'

// CRM-010: referral alerts and shared progress by email, through the installation's own mail adapter (the door TEAM-003
// alerts and sign-in invitations use). An email is claimed ('sending') before it is sent, so a retry never sends it
// twice, and what it says is worked out from live records at that moment. It carries only what the portal shows: the
// job title, a portal link, or the shared coarse status.

const STATUS: Record<string, string> = { received: 'Received', 'in progress': 'In progress', closed: 'Closed', hired: 'Hired' }

/** The email as the live records allow it, or null when nothing may be sent (opted out, left, job no longer public, referral no longer theirs). */
function message(s: State, env: Bindings, row: Data) {
  if (!referringMember(s.find('member', row.to)) || s.find('referral-pref', row.to)?.enabled !== true) return null
  const job = eligibleJobs(s).find(x => x.v.id === row.vacancy)
  if (!job) return null
  const portal = `${runtimeBindings(env).AUTH_ORIGIN}/app`
  const stop = `To stop these emails, turn off job alerts under Employee referrals in the portal. Turning alerts off stops both email and alerts in Lodge.`
  if (row.kind === 'job') return { subject: `A job you can refer people to: ${job.title}`, text: `${job.title} is open for employee referrals.\n\nOpen the referral portal: ${portal}\n\n${stop}\n` }
  const referral = s.find('referral', row.referral)
  const status = referral && referral.employee === row.to && referral.vacancy === row.vacancy ? STATUS[referral.progress] : undefined
  return status ? { subject: `Referral update for ${job.title}: ${status}`, text: `Status of your referral for ${job.title}: ${status}\n\nOpen the referral portal: ${portal}\n\n${stop}\n` } : null
}

const mark = (s: State, id: string, emailState: string, extra: Data = {}) => { const x = s.find('referral-email', id); if (x) s.put('referral-email', id, { ...x, emailState, emailAt: new Date().toISOString(), ...extra }) }
const queued = (env: Bindings) => env.DB.prepare("SELECT 1 AS n FROM l_records WHERE kind='referral-email' AND json_extract(value,'$.emailState')='queued' LIMIT 1").first()

/** Send the emails this request's own save queued; run after every successful write. */
export async function flushReferralEmails(env: Bindings) {
  try {
    if (!(await queued(env))) return
    for (;;) {
      const s = await load(env.DB), row = s.all('referral-email').find(x => x.emailState === 'queued')
      if (!row) return
      const ready = mailReady(env), text = ready ? message(s, env, row) : null
      if (!text) { mark(s, row.id, ready ? 'withheld' : 'not-sent'); await save(env.DB, s, null); continue }
      mark(s, row.id, 'sending'); await save(env.DB, s, null)
      const delivery = await deliver(env, row.to, text.subject, text.text, 'referral')
      const after = await load(env.DB)
      mark(after, row.id, delivery.outcome === 'handed' ? 'handed' : 'failed', { provider: delivery.provider, ...(delivery.outcome === 'failed' ? { reason: delivery.reason } : {}) })
      await save(env.DB, after, null)
    }
  } catch (error) { console.error('referral email delivery failed', (error as Error)?.name) }
}
