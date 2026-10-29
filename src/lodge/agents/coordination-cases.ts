import type { State } from '../core/state'
import { can, canReview, canSeeApplication, managesVacancy } from '../core/access'
import { blindFor } from '../core/blind'
import { grantsOf } from '../core/store'
import { protectedTerm } from '../core/protected'
import { canonical, instant, now, oneOf, requireThat, ROLES, scope, sha256, text, uid, type Actor, type Data } from '../core/types'
import { latest } from '../records/scorecards'

const KIND = 'coordination-case'
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b)

/** Reconstruct live saved authority; a case never grants membership or assignment. */
function human(s: State, who: string): Actor | undefined {
  const m = s.find('member', who)
  if (!m?.active || m.agent) return
  return { id: '', email: m.email, name: m.name, session: '', version: 0, owner: m.owner === true, roles: m.owner ? [...ROLES] : m.roles, agent: false, seePrivate: m.seePrivate === true, grants: grantsOf(s, m) }
}

export function canCoordinate(s: State, a: Actor, application: string) {
  const app = s.find('application', application), person = app && s.find('candidate', app.candidate), job = app && s.find('vacancy', app.vacancy)
  return !!app && !!person && !person.deleted && !person.mergedInto && !!job && canSeeApplication(s, a, app) && managesVacancy(a, job) && can(s, a, job, 'scorecards') && !blindFor(s, a, app)
}

function ownsCurrently(s: State, who: string, application: string) {
  const actor = human(s, who)
  return !!actor && canCoordinate(s, actor, application)
}

function preparerCurrent(s: State, row: Data) {
  if (!row.preparedBy) return true
  const member = s.find('member', row.preparedBy)
  return !!member?.active && member.agent === true && member.actsFor === row.preparedFor && ownsCurrently(s, row.preparedFor, row.application)
}

function assignment(s: State, row: Data) {
  const app = s.get('application', row.application), iv = s.get('interview', row.interview)
  const job = s.get('vacancy', app.vacancy)
  return { rubricVersion: app.rubricVersion, reviewers: app.reviewers ?? [], participants: iv.participants, start: iv.start, planItem: iv.planItem, focus: job.plan.find((p: Data) => p.id === iv.planItem)?.criteria ?? [] }
}

/** Status only. Neither ratings nor notes leave the scorecard boundary. */
export function submittedFeedback(s: State, app: Data, iv: Data, panellist: string) {
  return latest(s.all('scorecard').filter(card => card.application === app.id && card.interview === iv.id && card.author === panellist && card.rubricVersion === app.rubricVersion))
    .find(card => card.status === 'submitted' && !!s.get('scorecard', card.id))
}

function stateOf(s: State, row: Data): Data {
  if (row.explicitStop) return { status: 'stopped', reason: 'Explicit human stop', confirmation: null }
  const app = s.find('application', row.application), iv = s.find('interview', row.interview), job = app && s.find('vacancy', app.vacancy)
  if (!app || !iv || !job || app.status !== 'active' || job.status === 'closed') return { status: 'stopped', reason: 'Application or job is closed', confirmation: null }
  if (iv.application !== app.id || iv.status !== 'scheduled' || !iv.participants.includes(row.panellist)) return { status: 'stopped', reason: 'Interview or panellist assignment ended', confirmation: null }
  const panelMember = human(s, row.panellist)
  if (!panelMember || !canReview(panelMember) || !canSeeApplication(s, panelMember, app)) return { status: 'review-required', reason: 'Responsible panellist lost authority', confirmation: null }
  if (!same(row.assignment, assignment(s, row))) return { status: 'review-required', reason: 'Interview, rubric or assignments changed', confirmation: null }
  if (!row.owner || !ownsCurrently(s, row.owner, app.id)) return { status: 'review-required', reason: row.owner ? 'Recruiter lost current authority' : 'Human ownership required', confirmation: null }
  if (!preparerCurrent(s, row)) return { status: 'review-required', reason: 'Preparing agent or principal lost authority', confirmation: null }
  const card = submittedFeedback(s, app, iv, row.panellist)
  if (card) return { status: 'completed', reason: 'Confirmed native feedback submission', confirmation: { scorecard: card.id, submittedAt: card.submittedAt } }
  return { status: 'open', reason: 'Required native feedback is not submitted', confirmation: null }
}

function sources(s: State, row: Data) {
  return [['application', row.application], ['interview', row.interview], ['vacancy', row.vacancy], [KIND, row.id]].map(([kind, id]) => {
    s.get(kind, id)
    return { kind, id, revision: s.revisionOf(kind, id) }
  })
}

function history(s: State, a: Actor | null, row: Data, event: string, detail: Data = {}) {
  const entry = { at: now(), by: a?.email ?? null, event, ...detail }
  return s.put(KIND, row.id, { ...row, history: [...row.history, entry] })
}

/** Source mutations and authority changes record a factual transition in their own transaction. */
export function syncCoordinationCases(s: State) {
  for (const original of s.all(KIND)) {
    const next = stateOf(s, original)
    if (original.status !== next.status || original.reason !== next.reason || !same(original.confirmation, next.confirmation)) {
      history(s, null, { ...original, ...next }, next.status, { reason: next.reason, confirmation: next.confirmation })
    }
  }
}

export function coordinationCases(s: State, a: Actor) {
  return s.all(KIND).filter(row => canCoordinate(s, a, row.application)).map((row): Data => {
    const current = stateOf(s, row)
    const overdue = current.status === 'open' && row.deadline < now()
    const app = s.get('application', row.application), iv = s.get('interview', row.interview)
    return { ...row, ...current, overdue, candidateName: s.get('candidate', app.candidate).name, title: iv.title, sources: sources(s, row) }
  })
}

/** Deterministic key and an absence fence make duplicate discovery safe across restart and concurrent requests. */
export async function discoverCoordinationCase(s: State, a: Actor, b: Data) {
  requireThat(!a.agent && canCoordinate(s, a, b.application), 'Feedback case not found', 404)
  const app = s.get('application', b.application), iv = s.get('interview', b.interview)
  requireThat(app.status === 'active' && !app.imported && iv.application === app.id && iv.status === 'scheduled' && iv.start < now() && iv.participants.includes(b.panellist), 'Choose a current missing-feedback assignment', 409)
  const id = await sha256(canonical([app.id, iv.id, b.panellist]))
  const existing = s.find(KIND, id)
  if (existing) return coordinationCases(s, a).find(row => row.id === id)!
  requireThat(!submittedFeedback(s, app, iv, b.panellist), 'Feedback is already submitted', 409)
  const row = { id, application: app.id, vacancy: app.vacancy, interview: iv.id, panellist: b.panellist, owner: null, nextAction: '', deadline: null, assignment: assignment(s, { application: app.id, interview: iv.id }), createdAt: now(), createdBy: a.email, status: 'review-required', reason: 'Human ownership required', confirmation: null, history: [] }
  history(s, a, row, 'discovered')
  s.audit(a, 'feedback-case-discovered', 'application:' + app.id, { case: id })
  return coordinationCases(s, a).find(row => row.id === id)!
}

function safeText(value: unknown, label: string) {
  const result = text(value, label, 2000)
  requireThat(!protectedTerm(result), label + ' must exclude protected traits')
  return result
}

function actionInput(b: Data): Data {
  const action = oneOf(b.action, ['assign', 'progress', 'reconcile', 'stop'] as const, 'Feedback case action')
  const allowed = ['id', 'sources', 'action', ...(action === 'assign' ? ['owner', 'nextAction', 'deadline'] : action === 'progress' ? ['nextAction', 'deadline'] : action === 'stop' ? ['reason'] : [])]
  requireThat(Object.keys(b).every(key => allowed.includes(key)), 'Case actions accept no asserted status, completion, scorecard content or extra fields')
  if (action === 'assign' || action === 'progress') return { action, ...(action === 'assign' ? { owner: text(b.owner, 'Current human recruiter').toLowerCase() } : {}), nextAction: safeText(b.nextAction, 'Next action'), deadline: instant(b.deadline, 'Deadline') }
  return { action, ...(action === 'stop' ? { reason: safeText(b.reason, 'Stop reason') } : {}) }
}

function fresh(s: State, row: Data, expected: unknown) {
  requireThat(same(sources(s, row), expected), 'Case sources changed; reload and review current evidence', 409)
}

export function coordinationCaseAction(s: State, a: Actor, b: Data, proposal?: Data) {
  const row = s.get(KIND, b.id)
  requireThat(!a.agent && canCoordinate(s, a, row.application), 'Feedback case not found', 404)
  fresh(s, row, b.sources)
  const input = actionInput(b), current = stateOf(s, row)
  let next: Data = { ...row, ...current }
  if (input.action === 'assign') {
    requireThat(current.status !== 'stopped' && current.status !== 'completed', 'This case cannot be assigned', 409)
    requireThat(ownsCurrently(s, input.owner!, row.application), 'Choose a current human recruiter with this application’s authority', 403)
    const app = s.get('application', row.application), iv = s.get('interview', row.interview)
    requireThat(iv.participants.includes(row.panellist) && canReview(human(s, row.panellist) ?? { owner: false, roles: [] }), 'Panellist needs current authority', 409)
    next = { ...next, owner: input.owner, nextAction: input.nextAction, deadline: input.deadline, assignment: assignment(s, row), preparedBy: proposal?.proposedBy ?? null, preparedFor: proposal?.proposedFor ?? null }
    next = { ...next, ...stateOf(s, next) }
    requireThat(app.status === 'active' && next.status !== 'review-required', 'Review the changed assignment or authority first', 409)
  } else if (input.action === 'progress') {
    requireThat(current.status === 'open', 'Only an unresolved current case can record progress', 409)
    next = { ...next, nextAction: input.nextAction, deadline: input.deadline }
  } else if (input.action === 'stop') {
    next = { ...next, explicitStop: true, status: 'stopped', reason: 'Explicit human stop', confirmation: null }
  }
  history(s, a, next, input.action, { reason: input.reason ?? next.reason, owner: next.owner, nextAction: next.nextAction, deadline: next.deadline, confirmation: next.confirmation })
  s.audit(a, 'feedback-case-' + input.action, 'application:' + row.application, { case: row.id })
  return coordinationCases(s, a).find(item => item.id === row.id)!
}

export function canSeeCoordinationProposal(s: State, a: Actor, p: Data) {
  const row = s.find(KIND, p.case), agent = s.find('member', p.proposedBy)
  if (!row || !agent?.active || !agent.agent || agent.actsFor !== p.proposedFor) return false
  return [a.email, scope(a)].some(who => [p.proposedBy, p.proposedFor, p.approver].includes(who)) || a.owner
    ? canCoordinate(s, a, row.application) && ownsCurrently(s, p.proposedFor, row.application) && ownsCurrently(s, p.approver, row.application)
    : false
}

export function proposeCoordinationCase(s: State, a: Actor, b: Data) {
  requireThat(a.agent, 'An authenticated agent authors feedback case proposals', 403)
  const row = s.get(KIND, b.case), reviewer = human(s, b.approver)
  requireThat(canCoordinate(s, a, row.application) && reviewer && canCoordinate(s, reviewer, row.application), 'Feedback case not found', 404)
  fresh(s, row, b.sources)
  const input = actionInput({ ...b.input, id: row.id, sources: b.sources })
  const summary = safeText(b.summary, 'Proposal summary')
  const proposal = { workflow: 'feedback-coordination', case: row.id, application: row.application, summary, input, sources: b.sources, missing: [], changes: [], citations: [], approver: reviewer.email, proposedBy: a.email, proposedFor: scope(a), proposedAt: now(), status: 'proposed', model: null }
  requireThat(canSeeCoordinationProposal(s, a, proposal), 'Feedback case not found', 404)
  coordinationCaseAction(s.clone(), reviewer, { ...input, id: row.id, sources: b.sources }, proposal)
  const result = s.put('proposal', uid(), proposal)
  s.audit(a, 'feedback-case-proposed', 'application:' + row.application, { proposal: result.id })
  return result
}

export function decideCoordinationCase(s: State, a: Actor, p: Data, b: Data) {
  requireThat(canSeeCoordinationProposal(s, a, p), 'Feedback proposal not found', 404)
  requireThat(!a.agent && a.email === p.approver, 'Only the named human reviewer decides', 403)
  requireThat(p.status === 'proposed', 'This proposal was already decided', 409)
  const decision = oneOf(b.decision, ['approved', 'rejected'] as const, 'Decision'), reason = safeText(b.reason, 'Review reason')
  if (decision === 'approved') coordinationCaseAction(s, a, { ...p.input, id: p.case, sources: p.sources }, p)
  const result = s.put('proposal', p.id, { ...p, status: decision === 'approved' ? 'applied' : 'rejected', decidedAt: now(), decidedBy: a.email, reason })
  s.audit(a, 'feedback-case-proposal-' + decision, 'application:' + p.application)
  return result
}
