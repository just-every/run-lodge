import { now } from '../core/types'
import { LIMITS } from './envelope'
import { codeMac, newCode, newToken, sameSecret, tokenHash } from './secrets'
import type { Data } from '../core/types'

// One emailed-code gate (OFFER-005): at most one code a minute, 10 per link (the 11th request locks the link), each
// valid 10 minutes with 5 attempts, a resend invalidating its predecessor. A verified code opens a session that
// grants only this envelope and lasts at most 24 hours, never past the link's own expiry.

export interface Bind { envelope: string; linkVersion: number; recipient: string; purpose: 'sign' | 'copy' }
export type Refusal = { status: number; message: string }

export const freshGate = () => ({ issued: 0, incorrect: 0, locked: false, current: null as Data | null, sessions: [] as Data[] })

export async function issueCode(gate: Data, bind: Bind, secret: string, at = Date.now()): Promise<{ gate: Data; code?: string; refusal?: Refusal; lockedNow?: boolean }> {
  if (gate.locked) return { gate, refusal: { status: 403, message: 'This link is locked. Ask the employer to send a new signing request.' } }
  if (gate.issued >= LIMITS.codeCap) return { gate: { ...gate, locked: true, current: null, sessions: [] }, lockedNow: true, refusal: { status: 429, message: 'Too many codes were requested, so this link is locked. Ask the employer to send a new signing request.' } }
  if (gate.current && at - Date.parse(gate.current.issuedAt) < LIMITS.codeGap) return { gate, refusal: { status: 429, message: 'A code was sent a moment ago. Wait a minute before asking for another.' } }
  const code = newCode()
  return { gate: { ...gate, issued: gate.issued + 1, current: { mac: await codeMac(secret, bind, code), issuedAt: new Date(at).toISOString(), expiresAt: new Date(at + LIMITS.codeTtl).toISOString(), tries: 0 } }, code }
}

export async function checkCode(gate: Data, bind: Bind, secret: string, code: unknown, linkExpiresAt: string | null, at = Date.now()): Promise<{ gate: Data; token?: string; refusal?: Refusal }> {
  if (gate.locked) return { gate, refusal: { status: 403, message: 'This link is locked. Ask the employer to send a new signing request.' } }
  const current = gate.current
  if (!current) return { gate, refusal: { status: 409, message: 'Ask for a code first.' } }
  if (Date.parse(current.expiresAt) <= at) return { gate: { ...gate, current: null }, refusal: { status: 410, message: 'That code expired. Ask for a new one.' } }
  const right = typeof code === 'string' && /^\d{6}$/.test(code.trim()) && sameSecret(await codeMac(secret, bind, code.trim()), current.mac)
  if (!right) {
    const tries = current.tries + 1
    return { gate: { ...gate, incorrect: gate.incorrect + 1, current: tries >= LIMITS.tries ? null : { ...current, tries } }, refusal: { status: 403, message: tries >= LIMITS.tries ? 'Too many incorrect codes. Ask for a new code.' : 'That code is not right.' } }
  }
  const token = newToken()
  const ends = Math.min(at + LIMITS.session, linkExpiresAt ? Date.parse(linkExpiresAt) : Infinity)
  return { gate: { ...gate, current: null, sessions: [...gate.sessions.filter((x: Data) => Date.parse(x.expiresAt) > at), { hash: await tokenHash(token), expiresAt: new Date(ends).toISOString(), at: new Date(at).toISOString() }] }, token }
}

/** The live session behind a cookie value, or undefined. */
export async function sessionFor(gate: Data, token: string | undefined, at = Date.now()) {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return undefined
  const hash = await tokenHash(token)
  return (gate.sessions as Data[]).find(x => x.hash === hash && Date.parse(x.expiresAt) > at)
}

/** A session ends at signing for signing purposes; it then only reads. */
export const endSigning = (gate: Data) => ({ ...gate, sessions: gate.sessions.map((x: Data) => ({ ...x, done: true })) })
export const stamp = now
