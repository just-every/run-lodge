import type { State } from '../core/state'
import { can, canSeeApplication, canSeeContact, canSeeDocument, managesVacancy } from '../core/access'
import { blindFor } from '../core/blind'
import { canonical, now, oneOf, requireThat, scope, text, uid, type Actor, type Data } from '../core/types'
import { protectedTerm } from '../core/protected'
import { approvedNow, latestApproval, terms, versionOf } from '../records/approvals'
import { delayHuman } from '../views/delay-analysis'

export const HANDOFF_FIELDS = { phone: 'Candidate phone', location: 'Candidate location', department: 'Job department', manager: 'Job manager' }
const same = (x: unknown, y: unknown) => canonical(x) === canonical(y)
const source = (s: State, kind: string, id: string) => { s.get(kind, id); return { kind, id, revision: s.revisionOf(kind, id) } }
const human = (s: State, a: Actor) => a.agent ? delayHuman(s, scope(a)) : a

function allowed(s: State, a: Actor, offer: Data) {
  const app = s.find('application', offer.application), job = app && s.find('vacancy', app.vacancy), person = app && s.find('candidate', app.candidate)
  const reader = human(s, a)
  return !!reader && !!app && !!job && !!person && !person.deleted && !person.mergedInto && !app.imported && !job.imported
    && managesVacancy(reader, job) && canSeeApplication(s, reader, app) && !blindFor(s, reader, app)
    && can(s, reader, job, 'offers') && can(s, reader, job, 'contact') && canSeeContact(s, reader, person)
    && [offer.signature?.document, offer.signature?.certificate].filter(Boolean).every(id => {
      const doc = s.find('document', id)
      return !!doc && doc.candidate === person.id && doc.application === app.id && canSeeDocument(s, reader, doc) && !doc.restricted
    })
}

export function configureHandoff(s: State, a: Actor, b: Data) {
  requireThat(!a.agent, 'A human selects administrative handoff fields', 403)
  const job = s.get('vacancy', b.vacancy)
  requireThat(managesVacancy(a, job) && can(s, a, job, 'settings') && can(s, a, job, 'offers') && can(s, a, job, 'contact'), 'Handoff settings not found', 404)
  requireThat((b.revision ?? null) === s.revisionOf('handoff-policy', job.id), 'Handoff settings changed; reload Settings', 409)
  requireThat(Array.isArray(b.fields) && b.fields.length > 0, 'Select administrative fields')
  const fields = [...new Set(b.fields.map((field: unknown) => oneOf(field, Object.keys(HANDOFF_FIELDS), 'Administrative field')))].sort()
  const record = s.put('handoff-policy', job.id, { vacancy: job.id, fields, reviewedBy: a.email, reviewedAt: now() })
  s.audit(a, 'handoff-fields-reviewed', 'vacancy:' + job.id)
  return record
}

/** Read stored originals internally; return only authorized metadata and computed digests to agents. */
export async function handoffEvidence(s: State, a: Actor, id: string): Promise<Data> {
  const offer = s.find('offer', id)
  requireThat(offer && allowed(s, a, offer), 'Handoff preflight not found', 404)
  const app = s.get('application', offer.application), job = s.get('vacancy', app.vacancy), person = s.get('candidate', app.candidate)
  requireThat(offer.status === 'accepted' && app.status === 'hired', 'Choose a recorded accepted offer', 409)
  const policy = s.get('handoff-policy', job.id, 'handoff settings')
  const sources = [source(s, 'offer', offer.id), source(s, 'application', app.id), source(s, 'vacancy', job.id), source(s, 'candidate', person.id), source(s, 'handoff-policy', policy.id)]
  const version = await versionOf(s, 'offer', offer), approved = await approvedNow(s, 'offer', offer), approval = latestApproval(s, 'offer', offer.id)
  if (approval) sources.push(source(s, 'approval', approval.id))
  const values: Data = { phone: person.phone ?? '', location: person.location ?? '', department: job.department ?? '', manager: job.manager ?? '' }
  const fields = policy.fields.map((key: string) => ({ key, label: HANDOFF_FIELDS[key as keyof typeof HANDOFF_FIELDS], value: values[key], missing: !String(values[key] ?? '').trim() }))
  const issues: string[] = []
  if (!approved) issues.push('Current offer terms lack current approval')
  if (fields.some((f: Data) => f.missing)) issues.push('Missing administrative fields')
  const sig = offer.signature, artifacts: Data[] = []
  if (!sig) issues.push('Recorded acceptance is unsigned')
  if (sig && sig.termsVersion !== version) issues.push('Signature terms do not match current offer terms')
  for (const [role, docId, expected] of [['signed-original', sig?.document, sig?.sha256], ['completion-certificate', sig?.certificate, sig?.certificateSha256]]) {
    if (!docId) continue
    const doc = s.get('document', docId), artifact = await s.artifactDigest(doc.id)
    sources.push(source(s, 'document', doc.id))
    if (artifact) sources.push({ kind: 'blob', id: doc.id, revision: artifact.revision })
    const digest = artifact?.sha256 ?? null
    const intact = !!digest && digest === expected && digest === doc.sha256
    artifacts.push({ role, document: doc.id, name: doc.name, revision: s.revisionOf('document', doc.id), sha256: digest, recordedSha256: doc.sha256, intact })
    if (!intact) issues.push('Stored signature artifact is unavailable or differs from its recorded digest')
  }
  if (sig?.kind === 'native') {
    const envelope = s.get('esign-envelope', sig.envelope)
    sources.push(source(s, 'esign-envelope', envelope.id))
    if (envelope.status !== 'completed' || envelope.termsVersion !== version || sig.approvedSha256 !== offer.document?.sha256) issues.push('Native signature completion does not match the approved document')
  }
  if (sig?.kind === 'outside') issues.push('Outside signature is a human attestation, not provider verification')
  issues.push('Background checks and destination employee readback are unknown')
  const { document, ...approvedTerms } = terms(s, 'offer', offer)
  return { offer: offer.id, application: app.id, candidate: person.id, vacancy: job.id, name: person.name,
    offerRevision: s.revisionOf('offer', offer.id), termsVersion: version, approved, approvedDocumentSha256: offer.document?.sha256 ?? null,
    terms: approvedTerms, fields, signature: { kind: sig?.kind ?? 'unsigned', label: sig?.label ?? 'Recorded acceptance without signature', termsVersion: sig?.termsVersion ?? null,
      method: sig?.method ?? null, differences: sig?.differences ?? null, attestedBy: sig?.attestedBy ?? null, attestedAt: sig?.attestedAt ?? null, completedAt: sig?.completedAt ?? null, providerVerified: false, artifacts },
    issues: [...new Set(issues)], sources: sources.sort((x, y) => (x.kind + x.id).localeCompare(y.kind + y.id)), backgroundCheck: 'unknown', destinationReadback: 'unknown', employeeCreated: false, complete: false }
}

function provenance(s: State, a: Actor, p: Data) {
  const agent = s.find('member', p.proposedBy), principal = delayHuman(s, p.proposedFor), reviewer = delayHuman(s, p.approver), offer = s.find('offer', p.handoff.offer)
  return !!agent?.active && agent.agent && agent.actsFor === p.proposedFor && !!principal && !!reviewer && !!offer
    && [a, principal, reviewer].every(reader => allowed(s, reader, offer))
}
export const canSeeHandoffProposal = (s: State, a: Actor, p: Data) => provenance(s, a, p)
function ownership(s: State, b: Data, offer: Data) {
  const owner = text(b.owner, 'Named human owner').toLowerCase(), person = delayHuman(s, owner)
  requireThat(person && allowed(s, person, offer), 'The named human owner needs current offer, contact and document authority', 403)
  const deadline = text(b.deadline, 'Deadline', 40)
  requireThat(/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(deadline) && Number.isFinite(Date.parse(deadline)), 'Use an exact deadline with a time zone')
  const nextAction = text(b.nextAction, 'Next action', 2000)
  requireThat(!protectedTerm(nextAction), 'Protected-trait claims are not permitted')
  return { owner, deadline: new Date(deadline).toISOString(), nextAction }
}
function noCompletion(b: Data) {
  requireThat(!['complete', 'employeeCreated', 'corrections', 'changes', 'terms', 'salary', 'startDate'].some(key => Object.hasOwn(b, key)), 'This local workflow cannot change terms, create employees or complete a handoff')
}
async function current(s: State, a: Actor, old: Data) {
  const fresh = await handoffEvidence(s, a, old.offer)
  requireThat(same(fresh, old), 'Handoff sources changed; read a fresh preflight and request a new proposal', 409)
  return fresh
}

export async function proposeHandoff(s: State, a: Actor, b: Data) {
  requireThat(a.agent, 'A signed-in external agent authors handoff exception proposals', 403)
  noCompletion(b)
  const reviewer = delayHuman(s, text(b.approver, 'Human reviewer').toLowerCase())
  requireThat(reviewer, 'Choose a current human reviewer', 403)
  const evidence = await handoffEvidence(s, a, b.offer)
  requireThat(same(b.sources, evidence.sources) && same(b.comparison, { termsVersion: evidence.termsVersion, signature: evidence.signature, issues: evidence.issues }), 'Cite the exact current terms, signature artifacts and preflight findings', 409)
  await current(s, reviewer, evidence)
  const assignment = ownership(s, b, s.get('offer', evidence.offer))
  const packet = { workflow: 'handoff-exception', summary: 'Local handoff exception for ' + evidence.name, handoff: evidence, ...assignment, sources: evidence.sources, changes: [], citations: [], missing: [],
    proposedBy: a.email, proposedFor: scope(a), approver: reviewer.email, proposedAt: now(), status: 'proposed', model: null }
  requireThat(provenance(s, a, packet), 'Handoff proposal outside current authority', 404)
  const previous = s.scan('proposal').find(p => p.workflow === packet.workflow && p.handoff.offer === evidence.offer && same(p.sources, evidence.sources) && p.status === 'proposed')
  if (previous) { requireThat(provenance(s, a, previous), 'Handoff proposal not found', 404); return previous }
  const record = s.put('proposal', uid(), packet)
  s.audit(a, 'handoff-exception-proposed', 'proposal:' + record.id, { application: evidence.application })
  return record
}

export async function decideHandoff(s: State, a: Actor, p: Data, b: Data) {
  noCompletion(b)
  requireThat(!a.agent && a.email === p.approver, 'Only the named human reviewer decides this proposal', 403)
  requireThat(provenance(s, a, p), 'Handoff proposal not found', 404)
  const decision = oneOf(b.decision, ['accepted', 'rejected'] as const, 'Decision'), reason = text(b.reason, 'Review reason', 2000)
  if (p.status !== 'proposed') { requireThat(p.status === decision, 'This proposal was already decided', 409); return p }
  if (decision === 'accepted') {
    const evidence = await current(s, a, p.handoff)
    await current(s, delayHuman(s, p.proposedFor)!, p.handoff)
    const assignment = ownership(s, p, s.get('offer', evidence.offer)), previous = s.find('handoff-exception', evidence.offer)
    const event = { ...assignment, by: a.email, at: now(), reason, proposal: p.id, status: 'owned', sources: evidence.sources }
    s.put('handoff-exception', evidence.offer, { offer: evidence.offer, application: evidence.application, candidate: evidence.candidate, vacancy: evidence.vacancy, ...assignment, provenance: p, evidence, status: 'owned',
      history: [...(previous?.history ?? []), event], complete: false, employeeCreated: false, destinationReadback: 'unknown' })
  }
  const result = s.put('proposal', p.id, { ...p, status: decision, reason, decidedBy: a.email, decidedAt: now() })
  s.audit(a, 'handoff-exception-' + decision, 'proposal:' + p.id, { application: p.handoff.application })
  return result
}

export async function updateHandoff(s: State, a: Actor, b: Data) {
  noCompletion(b)
  const record = s.get('handoff-exception', b.id)
  requireThat(!a.agent && provenance(s, a, record.provenance), 'Handoff exception not found', 404)
  requireThat(b.revision === s.revisionOf('handoff-exception', record.id), 'Exception changed; reload before recording progress', 409)
  const evidence = await handoffEvidence(s, a, record.offer)
  requireThat(same(b.sources, evidence.sources), 'Preflight changed; reload before recording progress', 409)
  const status = oneOf(b.status, ['owned', 'stopped'] as const, 'Local case status'), assignment = ownership(s, b, s.get('offer', record.offer)), reason = text(b.reason, 'Progress reason', 2000)
  const event = { ...assignment, status, by: a.email, at: now(), reason, sources: evidence.sources }
  const result = s.put('handoff-exception', record.id, { ...record, ...assignment, evidence, status, history: [...record.history, event] })
  s.audit(a, 'handoff-exception-progress', 'handoff-exception:' + record.id, { application: record.application })
  return result
}

export async function handoffView(s: State, a: Actor) {
  const jobs = s.all('vacancy').filter(job => managesVacancy(a, job) && can(s, a, job, 'offers') && can(s, a, job, 'contact'))
  const policies: Data[] = jobs.flatMap(job => { const p = s.find('handoff-policy', job.id); return p ? [{ ...p, revision: s.revisionOf('handoff-policy', p.id) }] : [] })
  const preflights: Data[] = []
  for (const offer of s.all('offer').filter(o => o.status === 'accepted' && allowed(s, a, o))) {
    const app = s.get('application', offer.application)
    if (policies.some(p => p.vacancy === app.vacancy)) preflights.push(await handoffEvidence(s, a, offer.id))
  }
  const cases = s.all('handoff-exception').filter(c => provenance(s, a, c.provenance)).map(c => {
    const fresh = preflights.find(p => p.offer === c.offer), owner = delayHuman(s, c.owner)
    return { ...c, revision: s.revisionOf('handoff-exception', c.id), stale: !fresh || !same(fresh, c.evidence),
      reviewRequired: !owner || !allowed(s, owner, s.get('offer', c.offer)), overdue: c.status === 'owned' && c.deadline <= now() }
  })
  return { policies, preflights, cases, fields: HANDOFF_FIELDS }
}
