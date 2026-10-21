import type { State } from '../core/state'
import { requireAdmin, requireMember, requireManages, requireCan } from '../core/access'
import { isDesignated } from '../esign/disclosure'
import { email, integer, now, optionalText, requireThat, text, uid, type Actor, type Data } from '../core/types'

export const OFFER_MERGE_FIELDS = ['candidateName', 'title', 'location', 'employmentType', 'pay', 'startDate', 'bonus', 'equity', 'contingencies', 'terms'] as const
export type OfferMergeField = typeof OFFER_MERGE_FIELDS[number]

export interface OfferTemplateSnapshot {
  templateId: string
  name: string
  version: number
  body: string
  normalApprover: string
  exceptionApprover: string
  contingencies: string
  /** OFFER-005: the version chooses Lodge-native signature, may require countersignature and names its default signer. */
  signing?: { native: true; countersign: boolean; signer: string | null }
  reviewedBy: string
  at: string
}

/** Only named merge fields are executable; no expressions or nested substitutions. */
export function offerTemplateBody(value: unknown): string {
  const body = text(value, 'Offer template body', 16000)
  const remainder = body.replace(/\{\{([\s\S]*?)\}\}/g, (_match, field: string) => {
    requireThat((OFFER_MERGE_FIELDS as readonly string[]).includes(field.trim()), `Unknown offer merge field: ${field.trim()}`)
    return ''
  })
  requireThat(!remainder.includes('{{') && !remainder.includes('}}'), 'Offer template has an incomplete merge field')
  return body
}

export function offerApprover(s: State, value: unknown, label: string): string {
  const address = email(value, label)
  const member = requireMember(s, address, 'approver')
  requireThat(!member.agent, `${label} must be a person with the approver role or the owner`)
  return address
}

/** The native-signing choices of a reviewed version; they sit inside the offer's approval hash through its document. */
function signingChoice(s: State, b: Data, last?: Data): OfferTemplateSnapshot['signing'] {
  const native = (b.native ?? !!last?.signing?.native) === true
  const countersign = (b.countersign ?? !!last?.signing?.countersign) === true
  if (!native) { requireThat(!countersign, 'Countersignature applies to Lodge-native signature; choose it first'); return undefined }
  const signer = countersign ? email(b.signer ?? last?.signing?.signer, 'Default countersigner') : null
  if (signer) requireThat(isDesignated(s, signer), 'The default countersigner must be a designated offer signer', 409)
  return { native: true, countersign, signer }
}

/** Each employer review creates a new version; previously selected versions never change. */
export function offerTemplate(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  requireThat(!a.agent, 'An agent can propose an offer template but cannot review it', 403)
  requireThat(b.reviewed === true, 'Confirm employer review of this offer template before saving')
  const current = b.id ? s.get('offer-template', b.id, 'offer template') : null
  const last = current?.versions.at(-1)
  const name = text(b.name ?? current?.name, 'Offer template name', 120)
  const at = now()
  const version = {
    version: (last?.version ?? 0) + 1, name,
    body: offerTemplateBody(b.body ?? last?.body),
    normalApprover: offerApprover(s, b.normalApprover ?? last?.normalApprover, 'Normal approver'),
    exceptionApprover: offerApprover(s, b.exceptionApprover ?? last?.exceptionApprover, 'Compensation exception approver'),
    contingencies: optionalText(b.contingencies ?? last?.contingencies, 'Employer-reviewed contingencies', 8000),
    ...(signing => signing ? { signing } : {})(signingChoice(s, b, last)),
    reviewedBy: a.email, at,
  }
  const record = s.put('offer-template', current?.id ?? uid(), {
    ...(current ?? { createdBy: a.email, createdAt: at }), name,
    versions: [...(current?.versions ?? []), version], updatedBy: a.email, updatedAt: at,
  })
  s.audit(a, current ? 'offer-template-updated' : 'offer-template-created', 'offer-template:' + record.id, { version: version.version, reviewedBy: a.email })
  return record
}

/** Resolve once into an independent snapshot, so later template edits cannot change an offer. */
export function templateVersion(s: State, reference: { id: string; version?: number }): OfferTemplateSnapshot {
  requireThat(reference && typeof reference === 'object', 'Choose a reviewed offer template')
  const template = s.get('offer-template', reference.id, 'offer template')
  const number = reference.version === undefined ? template.versions.at(-1)?.version : integer(reference.version, 'Offer template version', 1, Number.MAX_SAFE_INTEGER)
  const version = template.versions.find((v: Data) => v.version === number)
  requireThat(version?.reviewedBy, 'Reviewed offer template version not found', 404)
  return structuredClone({ ...version, templateId: template.id, name: version.name ?? template.name })
}

/** A reviewed version is part of job setup; existing offers keep their own document. */
export function jobOfferTemplate(s: State, a: Actor, b: Data) {
  const job = s.get('vacancy', b.id)
  requireManages(a, job); requireCan(s, a, job, 'settings')
  requireThat(!job.imported && job.status !== 'closed', 'Choose an active native job', 409)
  const selected = b.offerTemplate ? templateVersion(s, b.offerTemplate) : null
  const reference = selected ? { id: selected.templateId, version: selected.version } : null
  const record = s.put('vacancy', job.id, { ...job, offerTemplate: reference })
  s.audit(a, 'job-offer-template-set', 'vacancy:' + job.id, { offerTemplate: reference })
  return record
}
