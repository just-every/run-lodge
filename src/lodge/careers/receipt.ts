import type { State } from '../core/state'
import { Fault, sha256, type Data } from '../core/types'

/** A recovery code proves possession, not identity; it reveals only the original receipt. */
export async function receiptRecoveryCode(s: State, receipt: Data, copy: Data) {
  const code = Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('')
  s.put('receipt', receipt.id, { ...receipt, recoveryHash: await sha256(code), recoveryExpires: new Date(Date.now() + 86400000).toISOString(), recoveryCopy: copy })
  return code
}

export async function recoverReceipt(s: State, code: unknown) {
  if (typeof code !== 'string' || !/^[a-f0-9]{64}$/.test(code)) throw new Fault(404, 'Receipt not available')
  const hash = await sha256(code)
  const receipt = s.all('receipt').find(r => r.recoveryHash === hash && Date.parse(r.recoveryExpires) > Date.now())
  if (!receipt || !s.find('application', receipt.application) || s.find('candidate', s.find('application', receipt.application)?.candidate)?.deleted) throw new Fault(404, 'Receipt not available')
  return receipt
}

export function publicReceipt(receipt: Data) {
  const { recoveryHash, recoveryExpires, recoveryCopy, ...visible } = receipt
  return visible
}
