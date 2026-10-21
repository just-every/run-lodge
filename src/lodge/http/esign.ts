import type { Context, Hono } from 'hono'
import type { Bindings } from '../../auth.server'
import { grantsOf, save } from '../core/store'
import { requireThat, type Actor, type Data } from '../core/types'
import type { State } from '../core/state'
import { countersign } from '../esign/flow'
import { createEnvelope, envelopeView } from '../esign/envelope'
import { deliver, invitationMail, mailReady, record } from '../esign/mail'

// OFFER-005 staff doors: send an approved offer for native signature, and countersign for the employer. Voiding, moving
// the countersigner and the disclosure and signer settings are ordinary commands (commands.ts).

type C = Context<{ Bindings: Bindings }>
export interface Helpers {
  context: (c: C) => Promise<{ state: State; actor: Actor }>
  person: (a: Actor) => void
  body: (c: C) => Promise<Data>
}

/** What a request reveals of its sender, as Cloudflare reports it. */
export const edgeOf = (c: C) => ({ ip: c.req.header('CF-Connecting-IP') ?? 'not recorded', ua: (c.req.header('user-agent') ?? 'not recorded').slice(0, 400) })

export function mountEsign(api: Hono<{ Bindings: Bindings }>, h: Helpers) {
  api.post('/api/lodge/esign/send', async c => {
    const { state, actor } = await h.context(c)
    h.person(actor)
    const { envelope, token } = await createEnvelope(state, actor, await h.body(c), m => grantsOf(state, m))
    // Mail must be set up before anything is recorded: a refused send leaves no envelope that reads as sent.
    requireThat(mailReady(c.env), 'Installation mail is not set up; nothing was sent', 409)
    await save(c.env.DB, state, actor)
    const message = invitationMail(c.env, envelope, token)
    await record(c.env, envelope.id, 'invitation', await deliver(c.env, envelope.recipient, message.subject, message.text))
    const after = (await h.context(c)).state.get('esign-envelope', envelope.id)
    return c.json(envelopeView(after, false))
  })

  api.post('/api/lodge/esign/countersign', async c => {
    const { state, actor } = await h.context(c)
    h.person(actor)
    const session = await c.env.DB.prepare('SELECT created_at FROM oa_sessions WHERE id=?').bind(actor.session).first<{ created_at: number }>()
    requireThat(session, 'Sign in required', 401)
    const step = await countersign(state, actor, await h.body(c), edgeOf(c), session.created_at, m => grantsOf(state, m))
    if (!step.ok) return c.json({ error: step.message, ...(step.message.startsWith('Sign in again') ? { reauth: '/signin?returnTo=%2Fapp' } : {}) }, step.status as 403)
    await save(c.env.DB, state, actor)
    return c.json(envelopeView(step.envelope, false))
  })
}
