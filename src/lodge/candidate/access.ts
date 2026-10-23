import type { State } from '../core/state'
import type { Session } from '../core/store'
import { requireThat, type Actor, type Data } from '../core/types'

/** Candidate identity never becomes a Lodge staff role. Every private link rechecks the current email. */
export function candidateActor(session: Session): Actor {
  return { id: session.operator.id, email: session.operator.email, name: session.operator.displayName, session: session.id, version: session.operator.version, owner: false, agent: false, roles: [] }
}

function findOwnReceipt(s: State, address: string, id: string): { receipt: Data; candidate: Data } | null {
  const receipt = s.find('receipt', id)
  const application = receipt && s.find('application', receipt.application)
  let candidate = application && s.find('candidate', application.candidate)
  const visited = new Set<string>()
  while (candidate?.mergedInto && !visited.has(candidate.id)) {
    visited.add(candidate.id)
    candidate = s.find('candidate', candidate.mergedInto)
  }
  if (!receipt || !application || !candidate || candidate.deleted || candidate.mergedInto || candidate.email?.toLowerCase() !== address.toLowerCase()) return null
  return { receipt, candidate }
}

export function ownReceipt(s: State, address: string, id: string) {
  const own = findOwnReceipt(s, address, id)
  requireThat(own, 'This page is not available', 404)
  return own
}

export function ownReceipts(s: State, address: string) {
  return s.all('receipt').flatMap(r => {
    const own = findOwnReceipt(s, address, r.id)
    return own ? [own.receipt] : []
  })
}
