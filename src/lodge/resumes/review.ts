import { schemaOf } from '../fields/schema'
import { validateValues, valuesFor } from '../fields/values'
import { requireAdmin } from '../core/access'
import type { State } from '../core/state'
import { requireThat, canonical, date, list, now, oneOf, optionalText, sha256, text, uid, type Actor, type Data } from '../core/types'
import { apply, candidate, candidateFields, CONSENT_BASES, retentionUntil, reviewDuplicate } from '../records/candidates'
import { requireIntake, resumeDuplicates } from './intake'

function corrected(s: State, a: Actor, b: Data, vacancy?: string) {
 const schema = vacancy ? schemaOf(s.get('vacancy', vacancy)) : []
 for (const id of Object.keys(b.customValues ?? {})) if (schema.some(f => f.id === id && f.restricted)) requireAdmin(a)
 const customValues = validateValues(schema, b.customValues ?? {})
 const fields = candidateFields(b)
 return { ...fields, customValues, employment: optionalText(b.employment, 'Employment', 12000), education: optionalText(b.education, 'Education', 12000), source: text(b.source, 'Source', 200), consentBasis: oneOf(b.consentBasis, CONSENT_BASES, 'Consent basis'), consentNote: optionalText(b.consentNote, 'Consent note', 1000), talentPool: b.talentPool === true, retainUntil: b.retainUntil ? date(b.retainUntil, 'Keep until') : retentionUntil(s) }
}

/** Store the exact corrected fields and duplicate set to be confirmed. No candidate or application is written. */
export async function previewResume(s: State, a: Actor, b: Data) {
 const row = requireIntake(s, a, b.id)
 requireThat(['review', 'failed'].includes(row.status), 'Decode the resume before review', 409)
 const fields = corrected(s, a, b, row.vacancy), duplicates = resumeDuplicates(s, a, fields)
 const review = { fields, duplicates, token: await sha256(canonical({ fields, duplicates, source: row.sha256, sourceText: row.sourceText, extraction: row.extraction })), at: now() }
 s.put('resume-intake', row.id, { ...row, review })
 return { id: row.id, ...review }
}

/** Confirm one reviewed file atomically and idempotently. Existing candidate fields are never overwritten. */
export async function commitResume(s: State, a: Actor, b: Data) {
 const row = requireIntake(s, a, b.id)
 if (row.status === 'committed') return { candidate: s.get('candidate', row.candidate), application: row.application ? s.get('application', row.application) : null, document: s.get('document', row.id), replayed: true }
 requireThat(row.review && b.token === row.review.token, 'Preview the exact corrected details before committing', 409)
 requireThat(b.confirmed === true, 'Confirm the corrections and every duplicate suggestion', 409)
 const { fields, duplicates } = row.review
 const current = resumeDuplicates(s, a, fields)
 requireThat(canonical(current) === canonical(duplicates), 'Possible duplicates changed; preview the corrected details again', 409)
 const decisions = list(b.duplicates ?? [], 'Duplicate decisions', 100, raw => {
  requireThat(raw && typeof raw === 'object', 'Review each duplicate')
  const x = raw as Data
  return { candidate: text(x.candidate, 'Duplicate candidate', 64), decision: oneOf(x.decision, ['distinct', 'existing'] as const, 'Duplicate decision'), reason: text(x.reason, 'Reason for duplicate decision', 1000) }
 })
 requireThat(decisions.length === duplicates.length && new Set(decisions.map(x => x.candidate)).size === decisions.length && duplicates.every((d: Data) => decisions.some(x => x.candidate === d.candidate)), 'Decide every duplicate suggestion before committing', 409)
 const existing = decisions.filter(d => d.decision === 'existing')
 requireThat(existing.length <= 1, 'Choose at most one existing person; use reviewed duplicate resolution for merges', 409)
 // A same-person choice links to the existing record; it never edits it or merges two people.
 let result: Data
 if (existing.length) {
  const person = s.get('candidate', existing[0].candidate)
  const schema = row.vacancy ? schemaOf(s.get('vacancy', row.vacancy)) : []
  for (const [id, value] of Object.entries(valuesFor(schema, fields.customValues ?? {}, 'candidate'))) requireThat(!Object.hasOwn(person.customValues ?? {}, id) || canonical(person.customValues[id]) === canonical(value), 'Resume intake never overwrites an existing person’s custom fields; update that person separately', 409)
  let application = null
  if (row.vacancy) {
   const active = s.scan('application').find(app => app.candidate === person.id && app.vacancy === row.vacancy && app.status === 'active')
   if (active) for (const [id, value] of Object.entries(fields.customValues ?? {})) {
    const field = schema.find(f => f.id === id)!
    const target = field.record === 'candidate' ? person : active
    requireThat(canonical(target.customValues?.[id] ?? null) === canonical(value), 'This existing application already has its own custom fields; update it separately', 409)
   }
   application = active ?? apply(s, a, { candidate: person.id, vacancy: row.vacancy, source: fields.source, customValues: fields.customValues })
  }
  result = { candidate: person, application }
  for (const decision of decisions.filter(d => d.decision === 'distinct')) reviewDuplicate(s, a, { keep: person.id, other: decision.candidate, decision: 'distinct', reason: decision.reason })
 } else {
  result = await candidate(s, a, { ...fields, vacancy: row.vacancy || undefined })
  for (const decision of decisions) reviewDuplicate(s, a, { keep: decision.candidate, other: result.candidate.id, decision: 'distinct', reason: decision.reason })
 }
 const application = result.application?.id ?? null
 const document = s.put('document', row.id, { id: row.id, name: row.name, mediaType: row.mediaType, size: row.size, sha256: row.sha256, addedAt: row.addedAt, candidate: result.candidate.id, application, kind: 'resume', restricted: false, source: 'reviewed resume intake by ' + a.email })
 s.put('resume-extraction', uid(), { candidate: result.candidate.id, application, document: document.id, sourceText: row.sourceText, decodedBy: row.decodedBy, extraction: row.extraction, parseError: row.parseError, corrections: fields, duplicateDecisions: decisions, by: a.email, confirmedAt: now() })
 // Remove the staged personal copy: the candidate-linked extraction now owns the reviewed evidence.
 s.put('resume-intake', row.id, { id: row.id, by: row.by, vacancy: row.vacancy, status: 'committed', candidate: result.candidate.id, application, committedAt: now() })
 s.audit(a, 'resume-intake-committed', 'candidate:' + result.candidate.id, { document: row.id, application, existing: existing.length === 1 })
 return { ...result, document, replayed: false }
}
