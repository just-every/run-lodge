import { runtimeBindings, type Bindings } from '../../auth.server'
import { generation, type Session } from '../core/store'

// The document viewer asks every two seconds whether the reader may still read. That is a
// whole-store decision (the person's role, grants and the document's application), so
// answering it from scratch costs a full load each time. The answer cannot change unless a
// record changes, and every committed change moves the generation counter (save(), and the
// move-in target). So a check proves access once, and hands back a token that names the
// session, the document and the generation it was proved at. While the counter is
// unchanged and the session still stands, the same token is the same answer, for the
// price of the session and the counter. Any write retires every token. The token is keyed
// with the installation secret, so a reader cannot name access they were never shown.

const bytes = new TextEncoder()
const base64url = (data: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(data))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function token(env: Bindings, session: Session, document: string, count: number) {
  const key = await crypto.subtle.importKey('raw', bytes.encode(runtimeBindings(env).SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return base64url(await crypto.subtle.sign('HMAC', key, bytes.encode(['document-access', session.id, session.operator.id, session.operator.version, document, count].join('\u0000'))))
}

/** The token for this reader and document at the current generation, taken before the access check so a write during it retires it. */
export async function accessGate(env: Bindings, session: Session, document: string, held: string | undefined) {
  const issued = await token(env, session, document, (await generation(env.DB)).n)
  return { issued, current: !!held && held.length === issued.length && [...issued].reduce((diff, ch, i) => diff | (ch.charCodeAt(0) ^ held.charCodeAt(i)), 0) === 0 }
}
