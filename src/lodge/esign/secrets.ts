import { sha256 } from '../core/types'

// OFFER-005 secret material: the link and session tokens are 256-bit random values kept only as SHA-256, and each
// emailed six-digit code is kept only as an HMAC under a key derived from the installation secret with its own label
// (plain SHA-256 of six digits falls to offline brute force). Nothing here is ever logged, exported or archived.

const hex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')

export const newToken = () => hex(crypto.getRandomValues(new Uint8Array(32)))
export const tokenHash = (token: string) => sha256(token)

/** Six digits, uniformly drawn (rejection sampling keeps the modulus unbiased). */
export function newCode() {
  const limit = 4_294_000_000 - (4_294_000_000 % 1_000_000)
  for (;;) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0]
    if (n < limit) return String(n % 1_000_000).padStart(6, '0')
  }
}

async function codeKey(secret: string) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: new TextEncoder().encode('lodge-esign-code-v1') }, material, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign'])
}

/** The code bound to its envelope, link version, recipient and purpose. */
export async function codeMac(secret: string, bind: { envelope: string; linkVersion: number; recipient: string; purpose: string }, code: string) {
  const data = new TextEncoder().encode([bind.envelope, bind.linkVersion, bind.recipient, bind.purpose, code].join('\u0000'))
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', await codeKey(secret), data)))
}

export function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
