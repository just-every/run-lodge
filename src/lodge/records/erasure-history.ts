import type { State } from '../core/state'
import type { Data } from '../core/types'

/** Audits can copy personal text even when their subject has already been erased. */
export function linkedAudits(s: State, candidateId: string, records: Record<string, Data[]>) {
  const references = new Set([candidateId, 'candidate:' + candidateId])
  for (const [kind, rows] of Object.entries(records)) for (const row of rows) {
    references.add(row.id)
    references.add(kind + ':' + row.id)
  }
  const refers = (value: unknown): boolean => typeof value === 'string' ? references.has(value)
    : Array.isArray(value) ? value.some(refers)
    : !!value && typeof value === 'object' && Object.values(value).some(refers)
  return s.scan('audit').filter(refers)
}

/** Vacancy holds are shared history. Keep their lifecycle, never their free text. */
export function eraseSharedHoldText(s: State, vacancyIds: Set<string>) {
  const shared = s.scan('hold').filter(h => h.status === 'released' && vacancyIds.has(h.vacancy))
  const subjects = new Set(shared.map(h => 'hold:' + h.id))
  for (const h of shared) s.put('hold', h.id, {
    vacancy: h.vacancy, status: h.status, placedBy: h.placedBy, placedAt: h.placedAt,
    releasedBy: h.releasedBy, releasedAt: h.releasedAt,
  })
  for (const audit of s.scan('audit').filter(e => subjects.has(e.record))) s.put('audit', audit.id, {
    at: audit.at, actor: audit.actor, email: audit.email, action: audit.action, record: audit.record,
  })
}
