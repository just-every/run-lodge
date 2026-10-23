import type { Bindings } from '../../auth.server'
import { runtimeBindings } from '../../auth.server'
import type { State } from '../core/state'
import { save } from '../core/store'
import { email, now, requireThat, sha256, type Actor, type Data } from '../core/types'
import { deliver, mailReady } from '../esign/mail'

/** System verification copy follows the recorded application language, never a silent fallback. */
export function verificationMail(app: Data, link: string) {
  const language = app.language ?? 'en'
  const copy = app.candidateAccount?.verificationCopy
  if (copy) {
    requireThat(copy.language === language && copy.reviewedBy, 'A reviewed verification email in the application language is required', 409)
    return { subject: copy.subject, text: copy.text.replaceAll('{link}', link) }
  }
  if (language === 'en') return { subject: 'Confirm your new email for Lodge', text: `Confirm your new email: ${link}\n\nSign in to your existing candidate account first. This link works once for 15 minutes. Ignore it if you did not request this change.` }
  if (language === 'es') return { subject: 'Confirma tu nuevo correo para Lodge', text: `Confirma tu nuevo correo: ${link}\n\nPrimero inicia sesión en tu cuenta de candidatura actual. Este enlace funciona una sola vez durante 15 minutos. Ignóralo si no solicitaste este cambio.` }
  requireThat(false, 'A reviewed verification email in the application language is required', 409)
  throw new Error('unreachable')
}

async function candidateIdentity(env: Bindings, s: State, a: Actor) {
  requireThat(!s.find('member', a.email), 'Use the employer account settings for a staff email change', 403)
  const identity = await env.DB.prepare("SELECT o.email,o.role,se.created_at,se.kind FROM oa_operators o JOIN oa_sessions se ON se.operator_id=o.id WHERE o.id=? AND se.id=?").bind(a.id, a.session).first<{ email: string; role: string; created_at: number; kind: string }>()
  requireThat(identity?.email === a.email && identity.role === 'member' && ['native', 'dev'].includes(identity.kind), 'Use a native candidate sign-in', 403)
  requireThat(Date.now() - identity.created_at <= 15 * 60000, 'Sign in again before changing your email', 409)
}

export async function beginEmail(env: Bindings, s: State, a: Actor, candidate: Data, app: Data, value: unknown) {
  await candidateIdentity(env, s, a)
  requireThat(app.status === 'active', 'This application is closed', 409)
  requireThat(mailReady(env), 'Installation mail is not set up', 409)
  const address = email(value, 'New email')
  requireThat(address !== candidate.email, 'Choose a different email')
  requireThat(!s.scan('candidate').some(c => c.id !== candidate.id && !c.deleted && c.email === address) && !await env.DB.prepare('SELECT 1 AS n FROM oa_operators WHERE email=?').bind(address).first(), 'This email change is not available', 409)
  const previous = s.find('candidate-email-change', candidate.id)
  requireThat(!previous || Date.now() - Date.parse(previous.at) >= 60000, 'Wait one minute before requesting another email', 429)
  const raw = [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, '0')).join('')
  const link = `${runtimeBindings(env).AUTH_ORIGIN}/candidate/receipts/${encodeURIComponent(app.receiptForChange)}/email/confirm?token=${raw}`
  const mail = verificationMail(app, link)
  s.put('candidate-email-change', candidate.id, { candidate: candidate.id, application: app.id, operator: a.id, from: candidate.email, to: address, hash: await sha256(raw), at: now(), expiresAt: Date.now() + 15 * 60000 })
  s.audit(a, 'candidate-email-change-requested', 'candidate:' + candidate.id)
  await save(env.DB, s, a)
  const result = await deliver(env, address, mail.subject, mail.text, 'candidate-email-change')
  // The claim is durable before the only send; an uncertain result is never retried automatically.
  return result.outcome
}

export async function confirmEmail(env: Bindings, s: State, a: Actor, candidate: Data, token: unknown) {
  await candidateIdentity(env, s, a)
  const pending = s.find('candidate-email-change', candidate.id)
  requireThat(typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) && pending && pending.operator === a.id && pending.from === candidate.email && pending.expiresAt > Date.now() && pending.hash === await sha256(token), 'This email confirmation is not available', 404)
  requireThat(s.get('application', pending.application).status === 'active', 'This application is closed', 409)
  requireThat(!s.scan('candidate').some(c => c.id !== candidate.id && !c.deleted && c.email === pending.to), 'This email change is not available', 409)
  // Preserve original receipts, answers, submitted files, holds and retention.
  s.put('candidate', candidate.id, { ...candidate, email: pending.to, emailVerifiedAt: now() })
  s.remove('candidate-email-change', candidate.id)
  s.audit(a, 'candidate-email-changed', 'candidate:' + candidate.id)
  // The existing native account and canonical email change in the same fenced transaction.
  // Keep only the confirming session. Old emailed login links and every other session stop.
  await save(env.DB, s, a, [
    env.DB.prepare('UPDATE oa_operators SET email=? WHERE id=? AND email=? AND version=?').bind(pending.to, a.id, a.email, a.version),
    env.DB.prepare('UPDATE oa_tokens SET revoked_at=? WHERE operator_id=? AND consumed_at IS NULL AND revoked_at IS NULL').bind(Date.now(), a.id),
    env.DB.prepare('UPDATE oa_sessions SET revoked_at=? WHERE operator_id=? AND id<>? AND revoked_at IS NULL').bind(Date.now(), a.id, a.session),
  ])
}
