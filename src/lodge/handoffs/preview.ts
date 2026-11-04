import type { State } from '../core/state'
import { can, canSeeDocument, managesVacancy } from '../core/access'
import { canonical, Fault, now, oneOf, optionalText, requireThat, sha256, text, type Actor, type Data } from '../core/types'
import { handoffAllowed, handoffEvidence } from '../agents/handoff-exceptions'
import { delayHuman } from '../views/delay-analysis'
import { schemaOf } from '../fields/schema'

export const MAPPING_FIELDS = {
  name: 'Candidate name', email: 'Candidate email', role: 'Approved role', manager: 'Job manager',
  location: 'Approved work location', employmentType: 'Approved employment type', payAmount: 'Approved USD pay in cents',
  payCurrency: 'Pay currency', payUnit: 'Pay unit', startDate: 'Approved start date', documents: 'Selected original document digests', custom: 'Custom field',
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b)
const source = (s: State, kind: string, id: string) => { s.get(kind, id); return { kind, id, revision: s.revisionOf(kind, id) } }
const missing = (value: unknown) => value == null || value === '' || Array.isArray(value) && !value.length
const member = (s: State, email: string) => delayHuman(s, email)
function noExecution(b: Data) {
  requireThat(!['complete', 'employeeCreated', 'authorized', 'execute', 'terms', 'salary', 'startDate', 'contingenciesComplete'].some(key => Object.hasOwn(b, key)), 'A preview cannot authorize creation, change terms or complete a destination')
}
function mappingAccess(s: State, a: Actor, job: Data) {
  return !a.agent && managesVacancy(a, job) && can(s, a, job, 'settings') && can(s, a, job, 'offers') && can(s, a, job, 'contact')
}
export function configureMapping(s: State, a: Actor, b: Data) {
  noExecution(b)
  const job = s.get('vacancy', b.vacancy)
  requireThat(mappingAccess(s, a, job), 'Handoff mapping not found', 404)
  requireThat((b.revision ?? null) === s.revisionOf('handoff-mapping', job.id), 'Mapping changed; reload Settings', 409)
  const field = schemaOf(job).find(f => f.id === b.customField && !f.restricted)
  requireThat(field, 'Choose an existing nonrestricted custom field')
  requireThat(b.fields && typeof b.fields === 'object' && !Array.isArray(b.fields), 'Declare destination fields')
  requireThat(Object.keys(b.fields).every(key => Object.hasOwn(MAPPING_FIELDS, key)), 'Unknown mapping source')
  const fields = Object.keys(MAPPING_FIELDS).map(key => ({ source: key, target: optionalText(b.fields[key], 'Destination field', 120) }))
  const targets = fields.map(f => f.target).filter(Boolean)
  requireThat(targets.length > 0 && new Set(targets).size === targets.length, 'Declare distinct destination fields')
  const result = s.put('handoff-mapping', job.id, { vacancy: job.id, destination: oneOf(b.destination, ['willow', 'bamboohr', 'adp'] as const, 'Destination'),
    tenant: optionalText(b.tenant, 'Employer-declared tenant', 200), fields, customField: field.id, configuredBy: a.email, configuredAt: now(), schemaValidated: false })
  s.audit(a, 'handoff-mapping-saved', 'vacancy:' + job.id)
  return result
}

async function snapshot(s: State, a: Actor, offerId: string, selected: string[]) {
  requireThat(!a.agent, 'Only a human prepares an employee mapping preview', 403)
  const evidence = await handoffEvidence(s, a, offerId)
  const offer = s.get('offer', offerId), app = s.get('application', evidence.application), job = s.get('vacancy', evidence.vacancy), person = s.get('candidate', evidence.candidate)
  const mapping = s.get('handoff-mapping', job.id, 'handoff mapping')
  const field = schemaOf(job).find(f => f.id === mapping.customField && !f.restricted)
  requireThat(field, 'The mapped custom field is unavailable or restricted', 409)
  requireThat(evidence.approved && offer.signature?.termsVersion === evidence.termsVersion, 'Current approved signed terms are required', 409)
  const sig = offer.signature, native = sig?.kind === 'native'
  requireThat(native || sig?.kind === 'outside', 'A native completion or attested outside signature is required', 409)
  requireThat(sig.document && (!native || sig.certificate), 'Signature artifacts are missing', 409)
  requireThat(evidence.signature.artifacts.length === (native ? 2 : 1) && evidence.signature.artifacts.every((d: Data) => d.intact), 'Signature artifacts are missing or changed', 409)
  requireThat(!evidence.issues.some((issue: string) => issue.startsWith('Native signature completion')), 'Native completion is stale', 409)
  const sources = [...evidence.sources, source(s, 'handoff-mapping', mapping.id)]
  requireThat(Array.isArray(selected) && selected.length <= 20 && selected.every(id => typeof id === 'string'), 'Select original documents')
  const ids = [...new Set([...evidence.signature.artifacts.map((d: Data) => d.document), ...selected])].sort()
  const documents: Data[] = []
  for (const id of ids) {
    const doc = s.get('document', id)
    requireThat(doc.candidate === person.id && (!doc.application || doc.application === app.id) && !doc.restricted && canSeeDocument(s, a, doc), 'Selected original not found', 404)
    const artifact = await s.artifactDigest(id)
    requireThat(artifact && artifact.sha256 === doc.sha256, 'Selected original bytes are missing or changed', 409)
    documents.push({ id, name: doc.name, sha256: artifact.sha256, revision: s.revisionOf('document', id), artifactRevision: artifact.revision })
    sources.push(source(s, 'document', id), { kind: 'blob', id, revision: artifact.revision })
  }
  const rows: Data = { candidate: person, application: app, vacancy: job }
  const values: Data = { name: person.name, email: person.email, role: offer.title, manager: job.manager,
    location: offer.location ?? '', employmentType: offer.employmentType ?? '', payAmount: offer.salary.amount,
    payCurrency: offer.salary.currency, payUnit: offer.salary.period, startDate: offer.startDate, documents,
    custom: rows[field.record].customValues?.[field.id] ?? null }
  requireThat(values.payCurrency === 'USD', 'Only approved USD compensation is supported', 409)
  const fields = mapping.fields.map((m: Data) => ({ ...m, label: MAPPING_FIELDS[m.source as keyof typeof MAPPING_FIELDS], value: values[m.source], missing: !m.target || missing(values[m.source]) }))
  // Permission definition edits invalidate review even when a grant stays present.
  for (const kind of ['permission-level', 'department']) for (const record of s.scan(kind)) sources.push(source(s, kind, record.id))
  const unique = [...new Map(sources.map(r => [r.kind + ':' + r.id, r])).values()].sort((x, y) => (x.kind + x.id).localeCompare(y.kind + y.id))
  return { offer: offer.id, application: app.id, candidate: person.id, vacancy: job.id, name: person.name, destination: mapping.destination,
    tenant: mapping.tenant, tenantVerified: false, schemaValidated: false, contingencies: { declared: offer.contingencies || '', status: 'unknown' },
    signature: evidence.signature, termsVersion: evidence.termsVersion, fields, missing: fields.filter((f: Data) => f.missing).map((f: Data) => f.label),
    customField: { id: field.id, name: field.name, record: field.record, type: field.type }, documents, sources: unique,
    complete: false, employeeCreated: false, creationAuthorized: false, destinationReadback: 'unknown' }
}
function visible(s: State, a: Actor, record: Data) {
  const offer = s.find('offer', record.offer), preparer = member(s, record.preparedBy)
  const readers = [a, preparer, ...(record.review ? [member(s, record.review.by)] : [])]
  if (!offer || a.agent || readers.some(reader => !reader || !handoffAllowed(s, reader, offer))) return false
  const app = s.find('application', offer.application), job = app && s.find('vacancy', app.vacancy)
  if (!job || !schemaOf(job).some(f => f.id === record.snapshot.customField.id && !f.restricted)) return false
  return record.snapshot.documents.every((d: Data) => { const doc = s.find('document', d.id); return doc && !doc.restricted && readers.every(reader => canSeeDocument(s, reader!, doc)) })
}
async function currentRecord(s: State, a: Actor, record: Data) {
  requireThat(visible(s, a, record), 'Handoff preview not found', 404)
  let fresh: Data | null = null
  try { fresh = await snapshot(s, a, record.offer, record.selected) } catch (error) { if (!(error instanceof Fault)) throw error }
  const sourceCurrent = !!fresh && same(fresh, record.snapshot)
  const preparerCurrent = record.preparedMemberRevision === s.revisionOf('member', record.preparedBy)
  const reviewerCurrent = !record.review || record.review.memberRevision === s.revisionOf('member', record.review.by)
  return { ...record, revision: s.revisionOf('handoff-preview', record.id), stale: !sourceCurrent || !preparerCurrent,
    reviewValid: !!record.review && sourceCurrent && preparerCurrent && reviewerCurrent, complete: false, employeeCreated: false, creationAuthorized: false }
}
export async function preparePreview(s: State, a: Actor, b: Data) {
  noExecution(b)
  const selected = b.documents ?? [], frozen = await snapshot(s, a, b.offer, selected)
  requireThat(b.mappingRevision === s.revisionOf('handoff-mapping', frozen.vacancy), 'Mapping changed; reload before preparing', 409)
  const preparedMemberRevision = source(s, 'member', a.email).revision
  const fingerprint = await sha256(canonical({ snapshot: frozen, preparedBy: a.email, preparedMemberRevision }))
  const previous = s.find('handoff-preview', fingerprint)
  if (previous) return currentRecord(s, a, previous)
  const record = s.put('handoff-preview', fingerprint, { offer: frozen.offer, application: frozen.application, candidate: frozen.candidate, vacancy: frozen.vacancy,
    fingerprint, snapshot: frozen, selected: frozen.documents.map((d: Data) => d.id), preparedBy: a.email, preparedMemberRevision, preparedAt: now(), review: null, history: [],
    complete: false, employeeCreated: false, creationAuthorized: false })
  s.audit(a, 'handoff-preview-prepared', 'handoff-preview:' + record.id, { application: frozen.application })
  return currentRecord(s, a, record)
}
export async function reviewPreview(s: State, a: Actor, b: Data) {
  noExecution(b)
  requireThat(!a.agent, 'Only a human reviews a mapping preview', 403)
  const record = s.get('handoff-preview', b.id), current = await currentRecord(s, a, record)
  requireThat(!current.stale && b.fingerprint === record.fingerprint, 'Sources or mapping changed; prepare a new preview', 409)
  requireThat(b.acknowledge === true, 'Acknowledge that this review authorizes no employee creation')
  if (current.reviewValid && record.review.by === a.email) return current
  const review = { by: a.email, memberRevision: source(s, 'member', a.email).revision, at: now(), reason: text(b.reason, 'Review reason', 2000), fingerprint: record.fingerprint }
  const result = s.put('handoff-preview', record.id, { ...record, review, history: [...record.history, review] })
  s.audit(a, 'handoff-preview-reviewed', 'handoff-preview:' + record.id, { application: record.application })
  return currentRecord(s, a, result)
}
export async function previewRead(s: State, a: Actor, id: string) { return currentRecord(s, a, s.get('handoff-preview', id)) }
export async function previewsView(s: State, a: Actor) {
  const mappings = s.all('handoff-mapping').filter(m => { const job = s.find('vacancy', m.vacancy); return job && mappingAccess(s, a, job) }).map(m => ({ ...m, revision: s.revisionOf('handoff-mapping', m.id) }))
  const records = []
  if (!a.agent) for (const record of s.all('handoff-preview').filter(r => visible(s, a, r))) records.push(await currentRecord(s, a, record))
  return { mappings, records, fields: MAPPING_FIELDS }
}
