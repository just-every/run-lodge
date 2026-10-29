import { proposeCandidateUpdate, decideCandidateUpdate } from './candidate-updates'
import { proposeSourcing, decideSourcing } from './sourcing'
import { proposeCoordinationCase, decideCoordinationCase } from './coordination-cases'
import { proposeDelay, decideDelay } from './delays'
import { blindSourceStamp } from '../core/blind'
import type { State } from '../core/state'
import { isAdmin, requireMember } from '../core/access'
import { Fault, now, oneOf, optionalText, requireThat, scope, text, uid, ROLES, type Actor, type Data } from '../core/types'
import { missingTerms } from '../records/vacancies'
import { run } from '../commands'
import { workspaceRecords, type WorkspaceRecords } from '../views/workspace'
import { canSeeProposal, sourceFields, sourceRecord } from '../views/proposals'

// Agent-native workflows. An owner's coding agent signs in
// as its own Lodge member marked as an agent: its roles decide what it can read,
// and it can only propose. A proposal names the exact records and revisions it
// read, the typed commands it wants run, the person who will approve them, and
// for feedback drafts the passages it cites. It is dry-run with that approver's
// permissions; nothing changes until they approve, and approval re-checks every
// source revision and runs the commands as them. An interviewer's own agent may
// prepare that interviewer's feedback draft, which they accept themselves and
// still edit and submit. No model runs inside Lodge; nothing is shown as an AI result.

export const WORKFLOWS = {
  'prepare-vacancy': ['vacancy', 'vacancy-stages', 'rubric', 'interview-plan'],
  'feedback-packet': ['scorecard'],
  coordination: ['message', 'interview', 'schedule', 'cancel-interview'],
  rediscovery: ['apply'],
} as const
type Workflow = keyof typeof WORKFLOWS

const SOURCE_KINDS = ['vacancy', 'application', 'candidate', 'interview', 'interview-note', 'scorecard', 'document'] as const

function readable(s: State, view: WorkspaceRecords, kind: string, id: string) {
  const record = sourceRecord(view, kind, id)
  requireThat(record, 'Source outside your scope', 404)
  const originalId = kind === 'candidate' && record.blind ? s.get('application', id.slice('blind:'.length)).candidate : id
  s.get(kind, originalId) // Fence the original row while returning only its projection.
  return record
}

/** Replace {"$result": n} with the id of the n-th change's result, so one proposal can build a vacancy and then its rubric. */
function resolve(value: unknown, results: Data[]): unknown {
  if (Array.isArray(value)) return value.map(v => resolve(v, results))
  if (value && typeof value === 'object') {
    const v = value as Data
    if (Object.keys(v).length === 1 && Number.isInteger(v.$result)) { requireThat(results[v.$result]?.id, 'A change refers to a later or failed change'); return results[v.$result].id }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x, results)]))
  }
  return value
}

/** The approver as an actor, for the dry run: their saved roles, never the proposer's. */
function approverActor(s: State, emailAddress: string): Actor {
  const m = requireMember(s, emailAddress)
  requireThat(!m.agent, 'A person, not another agent, approves proposals')
  return { id: 'dry-run', email: m.email, name: m.name, session: '', version: 0, owner: m.owner === true, roles: m.owner ? [...ROLES] : m.roles, agent: false }
}

function checkFeedback(s: State, view: WorkspaceRecords, change: Data, citations: Data[]) {
  requireThat(change.input?.submit !== true, 'A feedback draft is never submitted for the interviewer')
  for (const [criterion, rating] of Object.entries(change.input?.ratings ?? {})) {
    if (rating === null || rating === undefined || rating === '') continue
    // A rating stands only on the interviewer's own words; otherwise it stays an open question.
    requireThat(citations.some(c => c.criterion === criterion), `Rating for ${criterion} has no cited passage; leave it unanswered`)
  }
  for (const c of citations) {
    const n = readable(s, view, 'interview-note', c.note)
    requireThat(n.application === change.input.application, 'Citations must come from notes on this application')
    requireThat(typeof c.quote === 'string' && c.quote.length >= 3 && n.text.includes(c.quote), 'Each citation must quote the interviewer’s notes exactly')
  }
}

export async function propose(s: State, a: Actor, b: Data) {
  if (b.workflow === 'candidate-update') return proposeCandidateUpdate(s, a, b)
  if (b.workflow === 'sourcing-research') return proposeSourcing(s, a, b)
  if (b.workflow === 'feedback-coordination') return proposeCoordinationCase(s, a, b)
  if (b.workflow === 'delay-diagnosis') return proposeDelay(s, a, b)
  requireThat(a.roles.length || a.owner, 'Lodge membership required', 403)
  const workflow = oneOf(b.workflow, Object.keys(WORKFLOWS) as Workflow[], 'Workflow')
  const approver = text(b.approver ?? (workflow === 'feedback-packet' ? scope(a) : ''), 'Approver').toLowerCase()
  requireThat(approver !== a.email || workflow === 'feedback-packet', 'Name a different person to approve this proposal')
  if (workflow === 'feedback-packet') requireThat(approver === scope(a), 'Feedback drafts are for your own principal', 403)
  const reviewer = approverActor(s, approver)
  const intake = optionalText(b.intake, 'Intake', 20000)
  const view = await workspaceRecords(s, a), reviewerView = await workspaceRecords(s, reviewer)
  const rawSources = Array.isArray(b.sources) ? b.sources : []
  requireThat(rawSources.length <= 50, 'At most 50 source records')
  requireThat(rawSources.length > 0 || (workflow === 'prepare-vacancy' && intake), 'Name the records this proposal was prepared from (or, for a new vacancy, the owner’s intake)')
  const sources = rawSources.map((x: Data) => {
    const kind = oneOf(x?.kind, SOURCE_KINDS, 'Source kind')
    const source = readable(s, view, kind, x.id)
    // Keep the actual source field grant used to prepare the packet. Neither
    // its recipient nor a later reader may lose any part of that grant.
    const fields = sourceFields(source)
    const blindApplication = source.blind ? (kind === 'candidate' ? source.id.slice('blind:'.length) : source.id) : view.applications.find(app => app.blind && app.id === source.application)?.id ?? null
    const id = kind === 'candidate' && source.blind ? s.get('application', blindApplication).candidate : x.id as string
    return { kind, id, viewId: x.id as string, revision: s.revisionOf(kind, id), fields, blindApplication, blindStamp: blindApplication ? blindSourceStamp(s, blindApplication) : null }
  })
  requireThat(Array.isArray(b.changes) && b.changes.length > 0 && b.changes.length <= 20, 'Propose between 1 and 20 changes')
  const changes = b.changes.map((c: Data) => ({ op: oneOf(c?.op, WORKFLOWS[workflow] as readonly string[], 'Change for this workflow'), input: c?.input ?? {} }))
  const citations = Array.isArray(b.citations) ? b.citations.slice(0, 100) : []
  for (const citation of citations) requireThat(sources.some(source => source.kind === 'interview-note' && source.id === citation.note), 'Every cited note must be a versioned source')
  if (workflow === 'feedback-packet') for (const c of changes) checkFeedback(s, view, c, citations)
  if (workflow === 'rediscovery') {
    requireThat(isAdmin(a), 'Only the owner, a hiring admin or their agent searches the talent pool', 403)
    for (const c of changes) {
      const person = s.get('candidate', c.input.candidate)
      requireThat(person.consent?.talentPool === true && !person.deleted && person.retainUntil >= now().slice(0, 10), 'This person has not given current permission to be contacted about other roles', 409)
    }
  }
  const packet = {
    workflow, summary: text(b.summary, 'Summary', 2000), rationale: optionalText(b.rationale, 'Rationale', 8000), intake, sources, changes, citations,
    approver, proposedBy: a.email, proposedFor: scope(a), proposedByAgent: a.agent, proposedAt: now(), status: 'proposed', model: null,
  }
  // Check both actors before the trial can read targets as the approving person.
  // Even a failing trial must not disclose hidden target state to its proposer.
  requireThat(canSeeProposal(s, a, packet, view) && canSeeProposal(s, reviewer, packet, reviewerView), 'Proposal outside current source or change permissions', 403)
  // Dry run on a copy, with the approver's permissions, so what they approve can actually apply.
  const trial = s.clone(), results: Data[] = []
  for (const c of changes) {
    try { results.push(await run(trial, reviewer, c.op, resolve(c.input, results) as Data)) }
    catch (error) { throw new Fault(400, `Change ${results.length + 1} (${c.op}) would fail for ${approver}: ${(error as Error).message}`) }
  }
  const missing = workflow === 'prepare-vacancy' && results[0]?.id ? missingTerms(trial.get('vacancy', results[0].id)) : []
  const record = s.put('proposal', uid(), { ...packet, missing })
  s.audit(a, 'proposal-created', 'proposal:' + record.id, { workflow, approver })
  return record
}

export async function decideProposal(s: State, a: Actor, b: Data) {
  const p = s.get('proposal', b.id)
  if (p.workflow === 'candidate-update') return decideCandidateUpdate(s, a, p, b)
  if (p.workflow === 'sourcing-research') return decideSourcing(s, a, p, b)
  if (p.workflow === 'feedback-coordination') return decideCoordinationCase(s, a, p, b)
  if (p.workflow === 'delay-diagnosis') return decideDelay(s, a, p, b)
  requireThat(canSeeProposal(s, a, p, await workspaceRecords(s, a)), 'Proposal not found', 404)
  requireThat(p.status === 'proposed', 'This proposal was already decided', 409)
  requireThat(p.approver === a.email || (a.owner && p.proposedBy !== a.email), 'This proposal is for ' + p.approver + ' to decide', 403)
  const decision = oneOf(b.decision, ['approved', 'rejected'] as const, 'Decision')
  const reason = text(b.reason, 'Reason', 2000)
  if (decision === 'rejected') {
    const record = s.put('proposal', p.id, { ...p, status: 'rejected', decidedBy: a.email, decidedAt: now(), reason })
    s.audit(a, 'proposal-rejected', 'proposal:' + p.id)
    return record
  }
  for (const src of p.sources) {
    s.find(src.kind, src.id)
    requireThat(s.revisionOf(src.kind, src.id) === src.revision, 'Records changed after this proposal was prepared; ask for a fresh proposal', 409)
  }
  const results: Data[] = []
  for (const c of p.changes) results.push(await run(s, a, c.op, resolve(c.input, results) as Data))
  const record = s.put('proposal', p.id, { ...p, status: 'applied', decidedBy: a.email, decidedAt: now(), reason, results: results.map(r => r.id ?? null) })
  s.audit(a, 'proposal-applied', 'proposal:' + p.id, { workflow: p.workflow })
  return record
}
