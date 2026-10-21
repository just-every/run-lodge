import type { State } from '../core/state'
import { requireThat, sha256, type Data } from '../core/types'
import { offerApprover, offerTemplateBody, type OfferMergeField, type OfferTemplateSnapshot } from '../records/offer-templates'

/** Exact integer cents, independent of the server's locale or floating-point rounding. */
function usd(value: unknown, label: string): string {
  requireThat(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, `${label} must be whole USD cents`)
  return `USD ${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`
}

function required(value: unknown, field: OfferMergeField): string {
  requireThat(typeof value === 'string' && value.trim().length > 0, `Offer merge value is missing: ${field}`)
  return value
}

/** A candidate-specific preview only: preparing these bytes never sends an offer. */
export async function renderOfferDocument(s: State, application: Data, terms: Data, snapshot: OfferTemplateSnapshot) {
  requireThat(snapshot?.reviewedBy, 'Choose a reviewed offer template')
  const body = offerTemplateBody(snapshot.body)
  const normalApprover = offerApprover(s, snapshot.normalApprover, 'Normal approver')
  const exceptionApprover = offerApprover(s, snapshot.exceptionApprover, 'Compensation exception approver')
  const candidate = s.get('candidate', application.candidate)
  const mergeValue = (field: OfferMergeField): string => {
    if (field === 'candidateName') return required(candidate.name, field)
    if (field === 'bonus') return usd(terms.bonus, 'Bonus')
    if (field === 'pay') {
      requireThat(terms.salary?.currency === 'USD', 'Offer documents require USD pay')
      requireThat(['year', 'month', 'hour'].includes(terms.salary?.period), 'Offer pay period must be year, month or hour')
      return `${usd(terms.salary.amount, 'Pay')} per ${terms.salary.period}`
    }
    return required(terms[field], field)
  }
  // Replacement callbacks keep literal dollar signs and merge-like candidate text unchanged.
  const text = 'PREPARED, UNSENT — Lodge has not sent this offer.\n\n' + body.replace(/\{\{([\s\S]*?)\}\}/g, (_match, field: string) => mergeValue(field.trim() as OfferMergeField))
  return {
    text, sha256: await sha256(text),
    template: { id: snapshot.templateId, version: snapshot.version, name: snapshot.name },
    normalApprover, exceptionApprover,
    ...(snapshot.signing?.native ? { signing: snapshot.signing } : {}),
  }
}
