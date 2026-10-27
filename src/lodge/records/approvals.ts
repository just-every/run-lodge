import type { State } from '../core/state'
import { requireCan, requireMember, requireRole } from '../core/access'
import { canonical, now, oneOf, requireThat, sha256, text, uid, type Actor, type Data } from '../core/types'
import { kickoffTerms } from './kickoffs'
import { settleOpenings } from './openings'
import { notifyApproval, notifyOffer } from '../notify/emit'

// Approvals bind a person's decision to the exact version of what they saw.
// Changing the subject afterwards makes the approval stale: it no longer
// authorises publication, an offer outcome or a message download.

export type Subject = 'vacancy' | 'offer' | 'message'

/** The terms each kind of approval covers; anything else may change freely. */
export function terms(s: State, kind: Subject, record: Data): Data {
  if (kind === 'vacancy') {
    const rubric = (record.rubrics ?? []).at(-1) ?? null
    return { title: record.title, department: record.department, departmentId: record.departmentId, officeId: record.officeId, locations: record.locations?.length ? record.locations : undefined, location: record.location, workMode: record.workMode, employmentType: record.employmentType, description: record.description, compensation: record.compensation, payRanges: record.payRanges?.length ? record.payRanges : undefined, benefits: record.benefits || undefined, headcount: record.headcount, manager: record.manager, stages: record.stages, rubric: rubric && { version: rubric.version, criteria: rubric.criteria }, plan: record.plan, approvalRouting: Object.keys(record.approvalRouting ?? {}).length ? record.approvalRouting : undefined, kickoff: record.kickoff ? kickoffTerms(s.find('kickoff', record.kickoff)) : undefined }
  }
  if (kind === 'offer') return { application: record.application, title: record.title, salary: record.salary, startDate: record.startDate, terms: record.terms, opening: record.opening, ...(record.conditional ? { conditional: true } : {}), ...(record.document ? { document: record.document, location: record.location, employmentType: record.employmentType, bonus: record.bonus, equity: record.equity, contingencies: record.contingencies } : {}) }
  return { to: record.to, subject: record.subject, body: record.body, application: record.application ?? null }
}

export const versionOf = async (s: State, kind: Subject, record: Data) => sha256(canonical(terms(s, kind, record)))

export function latestApproval(s: State, kind: Subject, id: string) {
  // A refused extra opening (REQ-001) leaves the job's earlier approval in force.
  return s.all('approval').filter(x => x.subjectKind === kind && x.subjectId === id && !(x.purpose === 'extra-opening' && x.status === 'rejected')).sort((x, y) => x.requestedAt.localeCompare(y.requestedAt)).at(-1)
}

/** True only when the newest approval is approved and still matches the current terms. */
export async function approvedNow(s: State, kind: Subject, record: Data) {
  const approval = latestApproval(s, kind, record.id)
  if (!approval || approval.status !== 'approved') return false
  // Read the approval through the tracked path so the save fences it.
  s.get('approval', approval.id)
  return approval.version === await versionOf(s, kind, record)
}

export async function requestApproval(s: State, a: Actor, kind: Subject, record: Data, approverEmail: unknown, purpose?: 'extra-opening') {
  // A reviewed single-approver route selects a person; all existing role and exact-term checks still apply.
  const job = kind === 'vacancy' ? record : record.application ? s.get('vacancy', s.get('application', record.application).vacancy) : null
  // OFFER-001 binds its reviewed document's normal/exception approver, ahead of a general job route.
  const routed = kind === 'offer' && record.document ? undefined : job?.approvalRouting?.[kind]
  requireThat(!routed || !approverEmail || String(approverEmail).toLowerCase() === routed, `This workflow routes ${kind} approval to ${routed}`, 409)
  approverEmail = routed ?? approverEmail
  // Messages are approved by a hiring manager; vacancies and offers by someone holding the approver role.
  const approver = requireMember(s, text(approverEmail, 'Approver').toLowerCase(), kind === 'message' ? 'manager' : 'approver')
  const pending = latestApproval(s, kind, record.id)
  if (pending?.status === 'pending') s.put('approval', pending.id, { ...s.get('approval', pending.id), status: 'superseded', decidedAt: now() })
  const approval = s.put('approval', uid(), { subjectKind: kind, subjectId: record.id, version: await versionOf(s, kind, record), terms: terms(s, kind, record), requestedBy: a.email, approver: approver.email, status: 'pending', requestedAt: now(), purpose })
  s.audit(a, 'approval-requested', `${kind}:${record.id}`, { approval: approval.id, approver: approver.email })
  notifyApproval(s, approval, a.email)
  return approval
}

export async function decide(s: State, a: Actor, b: Data) {
  const approval = s.get('approval', b.id)
  requireThat(approval.approver === a.email || a.owner, 'This approval is assigned to someone else', 403)
  requireRole(a, approval.subjectKind === 'message' ? 'manager' : 'approver')
  requireThat(approval.requestedBy !== a.email || a.owner, 'You cannot approve your own request', 403)
  requireThat(approval.status === 'pending', 'This approval request is no longer open', 409)
  const decision = oneOf(b.decision, ['approved', 'rejected'] as const, 'Decision')
  const reason = text(b.reason, 'Reason', 2000)
  const subject = s.get(approval.subjectKind, approval.subjectId)
  // OPS-004: deciding a job's terms or an offer needs "approve" on that job.
  const job = approval.subjectKind === 'vacancy' ? subject : approval.subjectKind === 'offer' ? s.get('vacancy', s.get('application', subject.application).vacancy) : null
  if (job) requireCan(s, a, job, 'approve')
  if (approval.subjectKind === 'offer' && subject.document && subject.createdBy === a.email) {
    const independent = s.scan('member').some(m => m.active && !m.agent && (m.owner || m.roles.includes('approver')) && m.email !== subject.createdBy)
    requireThat(!independent, 'The preparer cannot approve this offer while an independent approver exists', 403)
  }
  const current = await versionOf(s, approval.subjectKind, subject)
  // The approver must have reviewed the version that is current now.
  requireThat(b.version === current, 'This changed since you opened it; review the current version', 409)
  requireThat(approval.version === current, 'The subject changed after approval was requested; request approval again', 409)
  const result = s.put('approval', approval.id, { ...approval, status: decision, reason, decidedBy: a.email, decidedAt: now() })
  s.audit(a, 'approval-' + decision, `${approval.subjectKind}:${approval.subjectId}`, { approval: approval.id, reason })
  if (approval.subjectKind === 'offer') notifyOffer(s, subject, a.email, decision === 'approved' ? 'approved' : 'not approved')
  // REQ-001: a headcount decision opens (or refuses) the job's openings.
  if (approval.subjectKind === 'vacancy') settleOpenings(s, a, subject, decision)
  return result
}
