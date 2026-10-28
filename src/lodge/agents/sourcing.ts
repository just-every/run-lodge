import type { State } from '../core/state'
import { can, canSeeCandidate, canSeeContact, canSeeDocument, isAdmin, managesVacancy, requireAdmin } from '../core/access'
import { canonical, now, oneOf, requireThat, scope, text, uid, type Actor, type Data } from '../core/types'
import { protectedTerm } from '../core/protected'
import { delayHuman } from '../views/delay-analysis'
import { approvedNow } from '../records/approvals'
import { poolTemplate } from '../records/message-templates'

function safe(value: unknown, label: string, max = 4000) {
  const result = text(value, label, max)
  requireThat(!protectedTerm(result), `${label} must exclude protected traits`)
  requireThat(!/\b(score\w*|rank\w*|suitability|recommend\w*|best candidate|worst candidate|hire them|reject them)\b/i.test(result), `${label} must exclude suitability scores, rankings and decisions`)
  return result
}
function keys(value: Data, allowed: string[]) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => allowed.includes(k)), 'Unsupported research field; use only cited facts and reviewed text')
}
const source = (s: State, kind: string, id: string) => { s.get(kind, id); return { kind, id, revision: s.revisionOf(kind, id) } }
const jobAccess = (s: State, a: Actor, job: Data) => isAdmin(a) && managesVacancy(a, job) && can(s, a, job, 'contact')

/** A human chooses a subset of the approved role's rubric, language and reviewed template. */
export async function sourcingBrief(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  requireThat(!a.agent, 'A human selects sourcing criteria', 403)
  const job = s.get('vacancy', b.vacancy)
  requireThat(jobAccess(s, a, job), 'Sourcing job not found', 404)
  requireThat(job.status === 'open' && !job.imported && await approvedNow(s, 'vacancy', job), 'Use a currently approved native role', 409)
  requireThat(Array.isArray(b.criteria) && b.criteria.length > 0 && b.criteria.length <= 8, 'Select one to eight job-related criteria')
  const criteria = [...new Set(b.criteria)].map(id => {
    const criterion = job.rubrics.at(-1)?.criteria.find((c: Data) => c.id === id)
    requireThat(criterion, 'Select criteria from this role’s current rubric')
    safe(criterion.name, 'Criterion'); safe(criterion.description, 'Criterion description')
    return { id: criterion.id, name: criterion.name, description: criterion.description }
  })
  const template = s.get('message-template', b.template)
  requireThat(template.vacancy === job.id, 'Choose a reviewed template for this role')
  const language = text(b.language, 'Reviewed language', 40), version = template.versions.filter((v: Data) => v.language === language).at(-1)
  requireThat(version?.reviewedBy, 'Review a template in the selected language first', 409)
  safe(version.subject, 'Reviewed subject'); safe(version.body, 'Reviewed message', 20000)
  requireThat(b.reviewed === true, 'Confirm the selected criteria, language and template')
  const record = s.put('sourcing-brief', uid(), { vacancy: job.id, criteria, language, template: source(s, 'message-template', template.id), job: source(s, 'vacancy', job.id), selectedBy: a.email, selectedAt: now() })
  s.audit(a, 'sourcing-criteria-selected', 'vacancy:' + job.id, { brief: record.id })
  return record
}

/** Consent is a current condition, not authority inherited from an old packet or archive. */
function poolAccess(s: State, a: Actor, c: Data) {
  return isAdmin(a) && !c.deleted && !c.mergedInto && !c.imported && c.consent?.talentPool === true
    && c.retainUntil >= now().slice(0, 10) && !!c.email && (!c.contactPreference || c.contactPreference.preference === 'email')
    && canSeeCandidate(s, a, c) && canSeeContact(s, a, c)
}

/** Minimal authorized source passages. Unlisted fields and restricted originals never enter the agent boundary. */
export function sourcingEvidence(s: State, a: Actor, briefId: unknown, candidateId: unknown) {
  requireAdmin(a)
  const brief = s.get('sourcing-brief', briefId), job = s.get('vacancy', brief.vacancy), candidate = s.get('candidate', candidateId)
  requireThat(jobAccess(s, a, job) && poolAccess(s, a, candidate), 'Sourcing evidence not found', 404)
  requireThat(job.status === 'open' && brief.job.revision === s.revisionOf('vacancy', job.id), 'Role changed; select current criteria again', 409)
  requireThat(brief.template.revision === s.revisionOf('message-template', brief.template.id), 'Template changed; select current reviewed text again', 409)
  const cSource = source(s, 'candidate', candidate.id), sources = [source(s, 'sourcing-brief', brief.id), source(s, 'vacancy', job.id), source(s, 'business', 'main'), cSource, source(s, 'message-template', brief.template.id)]
  const passages: Data[] = []
  for (const field of ['headline', 'skills', 'location']) if (candidate[field]) passages.push({ ...cSource, field, text: candidate[field], label: field })
  for (const d of s.all('document').filter(d => d.candidate === candidate.id && d.kind === 'resume' && !d.restricted && canSeeDocument(s, a, d))) {
    const ref = source(s, 'document', d.id), content = s.resumeTexts.get(d.id)
    sources.push(ref)
    if (content) passages.push({ ...ref, field: 'resumeText', text: content, label: d.name })
    for (const r of s.all('resume-extraction').filter(r => r.candidate === candidate.id && r.document === d.id && (!r.application || r.application === d.application))) {
      const extraction = source(s, 'resume-extraction', r.id)
      sources.push(extraction)
      if (r.sourceText) passages.push({ ...extraction, field: 'sourceText', text: r.sourceText, label: d.name, document: d.id })
    }
  }
  const template = poolTemplate(s, a, brief.template, candidate, job, brief.language)
  return { brief: brief.id, vacancy: job.id, job: job.title, candidate: candidate.id, name: candidate.name, criteria: brief.criteria, language: brief.language,
    permission: { ...candidate.consent, retainUntil: candidate.retainUntil, contactPreference: candidate.contactPreference?.preference ?? 'email' },
    template, passages, sources: sources.sort((x, y) => (x.kind + x.id).localeCompare(y.kind + y.id)),
    boundary: 'Native prior-pool evidence only. Licensed sources, mailbox replies, Slack and calendar availability are unconnected. Draft review creates no application, campaign, booking or send.' }
}

export function sourcingBriefs(s: State, a: Actor) {
  if (!isAdmin(a)) return []
  return s.all('sourcing-brief').filter(b => { const job = s.find('vacancy', b.vacancy); return job && jobAccess(s, a, job) }).map(b => ({ ...b, revision: s.revisionOf('sourcing-brief', b.id) }))
}

/** Every reader, the original principal and the named reviewer must still hold the entire source grant. */
export function canSeeSourcing(s: State, a: Actor, p: Data) {
  const agent = s.find('member', p.proposedBy), principal = delayHuman(s, p.proposedFor), reviewer = delayHuman(s, p.approver)
  if (!agent?.active || !agent.agent || agent.actsFor !== p.proposedFor || !principal || !reviewer) return false
  if (![p.proposedBy, p.proposedFor, p.approver].includes(a.email) && !a.owner) return false
  const candidate = s.find('candidate', p.candidate), job = s.find('vacancy', p.vacancy)
  if (!candidate || !job) return false
  for (const actor of [a, principal, reviewer]) {
    if (!jobAccess(s, actor, job) || !poolAccess(s, actor, candidate)) return false
    for (const ref of p.sources) {
      const record = s.find(ref.kind, ref.id)
      if (!record) return false
      if (ref.kind === 'document' && (record.restricted || !canSeeDocument(s, actor, record))) return false
      if (ref.kind === 'resume-extraction') {
        const doc = s.find('document', record.document)
        if (!doc || doc.restricted || !canSeeDocument(s, actor, doc)) return false
      }
    }
  }
  return true
}
export const staleSourcing = (s: State, p: Data) => p.sources.some((ref: Data) => s.revisionOf(ref.kind, ref.id) !== ref.revision)

/** External agents select evidence; factual prose must be an exact passage, never an unverified paraphrase. */
export function proposeSourcing(s: State, a: Actor, b: Data) {
  requireThat(a.agent, 'A signed-in external agent authors sourcing packets', 403)
  keys(b, ['workflow', 'brief', 'candidate', 'sources', 'claims', 'outreach', 'approver'])
  const approver = text(b.approver, 'Human reviewer').toLowerCase(), reviewer = delayHuman(s, approver)
  requireThat(reviewer && isAdmin(reviewer), 'Choose a current human pool administrator', 403)
  const report = sourcingEvidence(s, a, b.brief, b.candidate)
  const reviewed = sourcingEvidence(s, reviewer, b.brief, b.candidate)
  requireThat(canonical(report.sources) === canonical(reviewed.sources) && canonical(b.sources) === canonical(report.sources), 'Sources changed or are incomplete; read current evidence', 409)
  requireThat(Array.isArray(b.claims) && b.claims.length > 0 && b.claims.length <= 12, 'Supply one to twelve exact cited facts')
  const claims = b.claims.map((claim: Data) => {
    keys(claim, ['criterion', 'text', 'source']); keys(claim.source, ['kind', 'id', 'revision', 'field', 'quote'])
    const criterion = report.criteria.find((c: Data) => c.id === claim.criterion)
    requireThat(criterion, 'Use only the human-selected job criteria')
    const citation = claim.source, passage = report.passages.find(p => p.kind === citation.kind && p.id === citation.id && p.revision === citation.revision && p.field === citation.field)
    const quote = safe(citation.quote, 'Quoted passage')
    requireThat(passage && quote.length >= 8 && passage.text.includes(quote), 'Quote the authorized native source exactly; fabricated or stale passages are refused', 409)
    requireThat(claim.text === quote, 'Unsupported claim: factual text must equal its exact cited passage')
    return { criterion: criterion.id, criterionName: criterion.name, text: quote, source: { kind: passage.kind, id: passage.id, revision: passage.revision, field: passage.field, quote, label: passage.label } }
  })
  // An agent chooses the cited personalization; the surrounding text is the exact human-reviewed language version.
  const outreach = { subject: report.template.subject, body: report.template.body + '\n\n' + claims.map((c: Data) => '“' + c.text + '”').join('\n') }
  keys(b.outreach, ['subject', 'body'])
  requireThat(canonical(b.outreach) === canonical(outreach), 'Outreach must use the exact reviewed template and cited passages; unsupported claims are refused')
  const record = { workflow: 'sourcing-research', summary: report.job + ': ' + report.name, candidate: report.candidate, vacancy: report.vacancy,
    research: report, sources: report.sources, claims, outreach, changes: [], missing: [], citations: [], model: null,
    approver, proposedBy: a.email, proposedFor: scope(a), proposedByAgent: true, proposedAt: now(), status: 'proposed' }
  requireThat(canSeeSourcing(s, a, record) && canSeeSourcing(s, reviewer, record), 'Packet outside current source or contact authority', 403)
  for (const kind of ['application', 'document', 'resume-extraction']) s.scan(kind)
  const result = s.put('proposal', uid(), record)
  s.audit(a, 'sourcing-research-proposed', 'proposal:' + result.id)
  return result
}

export function decideSourcing(s: State, a: Actor, p: Data, b: Data) {
  requireThat(canSeeSourcing(s, a, p), 'Sourcing packet not found', 404)
  requireThat(!a.agent && a.email === p.approver, 'Only the named human reviewer decides this draft', 403)
  requireThat(p.status === 'proposed', 'This packet was already reviewed', 409)
  const decision = oneOf(b.decision, ['kept', 'rejected'] as const, 'Draft decision')
  if (decision === 'kept') {
    const report = sourcingEvidence(s, a, p.research.brief, p.candidate)
    requireThat(canonical(report.sources) === canonical(p.sources) && !staleSourcing(s, p), 'Sources changed; request a fresh packet before keeping it', 409)
    for (const kind of ['application', 'document', 'resume-extraction']) s.scan(kind)
  }
  const record = s.put('proposal', p.id, { ...p, status: decision, decidedBy: a.email, decidedAt: now(), reason: text(b.reason, 'Review reason', 2000) })
  s.audit(a, 'sourcing-research-' + decision, 'proposal:' + p.id)
  return record
}
