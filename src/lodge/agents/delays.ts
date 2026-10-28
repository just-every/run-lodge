import type { State } from '../core/state'
import { protectedTerm } from '../core/protected'
import { now, oneOf, requireThat, scope, text, uid, type Actor, type Data } from '../core/types'
import { canSeeDelay, delayAnalysis, delayHuman } from '../views/delay-analysis'
import { workspaceRecords } from '../views/workspace'

function narrative(value: unknown, label: string) {
  const result = text(value, label, 4000)
  requireThat(!protectedTerm(result), `${label} must exclude protected traits`)
  requireThat(!/\b(suitability|rank\w*|best candidate|worst candidate|hire them|reject them)\b/i.test(result), `${label} must not rank or decide candidates`)
  requireThat(!/\b(caus\w*|because|due to|proves?|attribut\w*)\b/i.test(result), `${label} must describe observations or uncertain hypotheses, not assert a cause`)
  return result
}
const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y)

/** An external agent authors the interpretation. Lodge supplies facts and validates citations; no model is simulated. */
export async function proposeDelay(s: State, a: Actor, b: Data) {
  requireThat(a.agent, 'A signed-in agent member authors delay diagnosis drafts', 403)
  const approver = text(b.approver, 'Human reviewer').toLowerCase(), reviewer = delayHuman(s, approver)
  requireThat(reviewer, 'Choose a current human reviewer', 403)
  const report = delayAnalysis(s, a, await workspaceRecords(s, a), b.cohort ?? {})
  const reviewed = delayAnalysis(s, reviewer, await workspaceRecords(s, reviewer), report.cohort)
  requireThat(same(report.sources, reviewed.sources), 'Principal and reviewer must share the complete cohort evidence', 403)
  requireThat(report.cases.length > 0, 'A diagnosis needs observed cases')
  requireThat(same(b.sources, report.sources), 'Evidence changed or sources are incomplete; read a fresh delay analysis', 409)
  requireThat(Array.isArray(b.findings) && b.findings.length > 0 && b.findings.length <= 12, 'Write between 1 and 12 cited findings')
  const findings = b.findings.map((f: Data) => {
    const kind = oneOf(f.kind, ['observation', 'hypothesis'] as const, 'Finding kind')
    requireThat(Array.isArray(f.citations) && f.citations.length > 0 && f.citations.length <= 30, 'Every finding needs exact event or offer citations')
    const citations = f.citations.map((c: Data) => {
      const source = report.sources.find(x => ['stage-event', 'offer'].includes(x.kind) && x.kind === c?.kind && x.id === c.id && x.revision === c.revision)
      requireThat(source, 'Citation is fabricated, stale or outside current evidence', 409)
      return source
    })
    return { kind, text: narrative(f.text, 'Finding'), citations }
  })
  const record = {
    workflow: 'delay-diagnosis', summary: narrative(b.summary, 'Summary'), rationale: '', missing: [], changes: [], citations: [],
    sources: report.sources, delay: report, findings,
    uncertainty: narrative(b.uncertainty, 'Uncertainty'), sampleLimits: narrative(b.sampleLimits, 'Sample limits'),
    proposedChange: narrative(b.proposedChange, 'Proposed workflow change'), successCriterion: narrative(b.successCriterion, 'Measurable success criterion'),
    approver, proposedBy: a.email, proposedFor: scope(a), proposedByAgent: true, proposedAt: now(), status: 'proposed', model: null,
  }
  requireThat(canSeeDelay(s, a, record) && canSeeDelay(s, reviewer, record), 'Diagnosis outside current authority', 403)
  // Fence absence as well as revisions: a newly captured event cannot silently change the reviewed cohort.
  for (const kind of ['application', 'stage-event', 'offer']) s.scan(kind)
  const result = s.put('proposal', uid(), record)
  s.audit(a, 'delay-diagnosis-proposed', 'proposal:' + result.id)
  return result
}

/** Review records only a draft decision. Activation and sandbox trials have separate doors and authority. */
export async function decideDelay(s: State, a: Actor, p: Data, b: Data) {
  requireThat(!a.agent && a.email === p.approver, 'Only the named human reviewer decides this draft', 403)
  requireThat(canSeeDelay(s, a, p), 'Diagnosis not found', 404)
  requireThat(p.status === 'proposed', 'This diagnosis was already reviewed', 409)
  const decision = oneOf(b.decision, ['accepted', 'rejected'] as const, 'Draft decision')
  const reason = text(b.reason, 'Review reason', 2000)
  if (decision === 'accepted') {
    const current = delayAnalysis(s, a, await workspaceRecords(s, a), p.delay.cohort)
    requireThat(same(current.sources, p.sources), 'Evidence changed; request a fresh diagnosis before accepting', 409)
    for (const kind of ['application', 'stage-event', 'offer']) s.scan(kind)
  }
  const result = s.put('proposal', p.id, { ...p, status: decision, decidedBy: a.email, decidedAt: now(), reason })
  s.audit(a, 'delay-diagnosis-' + decision, 'proposal:' + p.id)
  return result
}
